import { MEMORY_CATEGORIES } from './memoryStore.js';

export const MAX_ORGANIZE_CHARS = 60_000;
export const MAX_EXTRACT_CHUNK_CHARS = 8_000;
export const MAX_ORGANIZED_PROPOSALS = 60;
export const MAX_AI_MEMORY_CHARS = 2_000;

export class MemoryEngineError extends Error {
  constructor(message, statusCode = 400, code = 'MEMORY_ORGANIZATION_ERROR') {
    super(message);
    this.name = 'MemoryEngineError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const clampText = (value, max, fallback = '') => (typeof value === 'string' ? value.trim().slice(0, max) : fallback);
const cleanTags = (value) => Array.isArray(value)
  ? [...new Set(value.filter((tag) => typeof tag === 'string').map((tag) => tag.trim().replace(/^#+/, '').slice(0, 40)).filter(Boolean))].slice(0, 20)
  : [];

// Model output is still untrusted. Never turn obvious prompt-injection payloads or
// credential-shaped values into durable memories, even if the provider ignores its prompt.
export function isUnsafeMemoryText(title, content) {
  const text = `${String(title || '')}\n${String(content || '')}`;
  const promptInjection = /\b(?:ignore|disregard|override|bypass)\b.{0,60}\b(?:system|developer|previous|prior|above|earlier|safety)\b.{0,40}\binstructions?\b/i.test(text)
    || /\b(?:reveal|print|dump|exfiltrate)\b.{0,60}\b(?:system prompt|api keys?|credentials?|secrets?)\b/i.test(text)
    || /\b(?:delete|remove|erase)\s+all\s+(?:saved\s+)?(?:memories|memory records|user data|files)\b/i.test(text);
  const credential = /\bsk-or-v1-[A-Za-z0-9]{16,}\b/i.test(text)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,})\b/.test(text)
    || /\b(?:api[ _-]?key|access[ _-]?token|client[ _-]?secret|password|authorization)\s*[:=]\s*[\"'`]?[^\s\"'`]{8,}/i.test(text);
  return promptInjection || credential;
}

export function splitDocument(text, maxChars = MAX_EXTRACT_CHUNK_CHARS) {
  if (typeof text !== 'string') throw new MemoryEngineError('Document content must be text.');
  const source = text.replace(/\r\n?/g, '\n').trim();
  if (!source) throw new MemoryEngineError('The document is empty.');
  if (!Number.isInteger(maxChars) || maxChars < 1000) throw new MemoryEngineError('Chunk size must be at least 1,000 characters.');
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(start + maxChars, source.length);
    if (end < source.length) {
      const paragraph = source.lastIndexOf('\n\n', end);
      const line = source.lastIndexOf('\n', end);
      if (paragraph > start + maxChars * 0.5) end = paragraph + 2;
      else if (line > start + maxChars * 0.5) end = line + 1;
    }
    if (end <= start) end = Math.min(start + maxChars, source.length);
    chunks.push(source.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

export function parseJsonResponse(responseText) {
  if (typeof responseText !== 'string') throw new MemoryEngineError('The AI returned an empty response.', 502, 'INVALID_AI_RESPONSE');
  let text = responseText.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
    return value;
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const value = JSON.parse(text.slice(first, last + 1));
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch { /* Report a clear structured-output error below. */ }
    }
    throw new MemoryEngineError('The AI response was not valid JSON. Nothing was saved; try again or use raw import.', 502, 'INVALID_AI_RESPONSE');
  }
}

export function normalizeExtractedCandidates(rawItems, prefix = 'candidate') {
  if (!Array.isArray(rawItems)) throw new MemoryEngineError('The AI response did not contain a memories array.', 502, 'INVALID_AI_RESPONSE');
  const candidates = [];
  for (const raw of rawItems.slice(0, MAX_ORGANIZED_PROPOSALS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const title = clampText(raw.title, 160);
    if (typeof raw.content !== 'string' || raw.content.trim().length > MAX_AI_MEMORY_CHARS) continue;
    const content = clampText(raw.content, MAX_AI_MEMORY_CHARS);
    if (!title || !content || isUnsafeMemoryText(title, content)) continue;
    const category = MEMORY_CATEGORIES.includes(raw.category) ? raw.category : 'general';
    const importanceNum = Number(raw.importance);
    const importance = Number.isInteger(importanceNum) ? Math.max(1, Math.min(5, importanceNum)) : 3;
    const confidenceNum = Number(raw.confidence);
    const confidence = Number.isFinite(confidenceNum) ? Math.max(0, Math.min(1, confidenceNum)) : 0.65;
    candidates.push({
      candidateId: `${prefix}-${candidates.length + 1}`,
      title,
      content,
      category,
      tags: cleanTags(raw.tags),
      importance,
      confidence
    });
  }
  return candidates;
}

function normalizeForMatch(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[`*_~#>|]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function tokens(value) {
  return new Set(normalizeForMatch(value).split(' ').filter((token) => token.length > 1));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function mergeTags(a, b) {
  return [...new Set([...a, ...b].map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export function deduplicateCandidates(candidates) {
  const result = [];
  for (const candidate of candidates) {
    const titleKey = normalizeForMatch(candidate.title);
    const contentKey = normalizeForMatch(candidate.content);
    const titleTokens = tokens(candidate.title);
    const contentTokens = tokens(candidate.content);
    const match = result.find((prior) => {
      const priorTitleKey = normalizeForMatch(prior.title);
      const priorContentKey = normalizeForMatch(prior.content);
      const titleScore = jaccard(titleTokens, tokens(prior.title));
      const contentScore = jaccard(contentTokens, tokens(prior.content));
      return (titleKey && titleKey === priorTitleKey)
        || (contentKey && contentKey === priorContentKey)
        || (titleScore >= 0.85 && contentScore >= 0.72);
    });
    if (!match) {
      result.push({ ...candidate, tags: [...candidate.tags] });
      continue;
    }
    match.tags = mergeTags(match.tags, candidate.tags);
    match.importance = Math.max(match.importance, candidate.importance);
    match.confidence = Math.max(match.confidence, candidate.confidence);
    const oldContentKey = normalizeForMatch(match.content);
    if (contentKey && oldContentKey && !oldContentKey.includes(contentKey) && !contentKey.includes(oldContentKey)) {
      const merged = `${match.content}\n\n${candidate.content}`;
      if (merged.length <= MAX_AI_MEMORY_CHARS) match.content = merged;
    } else if (candidate.content.length > match.content.length && contentScoreSimilar(candidate.content, match.content) > 0.8) {
      match.content = candidate.content;
    }
  }
  return result.slice(0, MAX_ORGANIZED_PROPOSALS).map((item, index) => ({ ...item, candidateId: `candidate-${index + 1}` }));
}

function contentScoreSimilar(a, b) {
  return jaccard(tokens(a), tokens(b));
}

export function classifyCandidateFallback(candidate, existingMemories = []) {
  let best = null;
  let bestScore = 0;
  for (const current of existingMemories) {
    const titleKey = normalizeForMatch(candidate.title);
    const existingTitleKey = normalizeForMatch(current.title);
    const titleScore = titleKey && titleKey === existingTitleKey ? 1 : jaccard(tokens(candidate.title), tokens(current.title));
    const contentScore = jaccard(tokens(candidate.content), tokens(current.content));
    const score = titleScore * 0.68 + contentScore * 0.32;
    if (score > bestScore) { best = current; bestScore = score; }
  }
  if (!best || bestScore < 0.38) return { ...candidate, action: 'add', existingMemoryId: null, existingTitle: '', reason: 'No sufficiently similar saved memory was found.', decision: 'add', comparisonConfidence: 0.55 };
  const titleExact = normalizeForMatch(candidate.title) === normalizeForMatch(best.title);
  const contentExact = normalizeForMatch(candidate.content) === normalizeForMatch(best.content);
  if (contentExact || (titleExact && jaccard(tokens(candidate.content), tokens(best.content)) > 0.82)) {
    return { ...candidate, action: 'duplicate', existingMemoryId: best.id, existingTitle: best.title, reason: 'This appears to repeat an existing memory.', decision: 'skip', comparisonConfidence: Math.max(0.65, bestScore) };
  }
  if (titleExact || bestScore >= 0.55) {
    return { ...candidate, action: 'conflict', existingMemoryId: best.id, existingTitle: best.title, reason: 'A related memory exists; review whether this adds new information or contradicts it.', decision: 'review', comparisonConfidence: Math.min(0.75, bestScore) };
  }
  return { ...candidate, action: 'add', existingMemoryId: null, existingTitle: '', reason: 'No sufficiently similar saved memory was found.', decision: 'add', comparisonConfidence: 0.55 };
}

export function normalizeComparisonResponse(rawItems, candidates, existingMemories) {
  if (!Array.isArray(rawItems)) throw new MemoryEngineError('The AI comparison did not contain an items array.', 502, 'INVALID_AI_RESPONSE');
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const existingById = new Map(existingMemories.map((memory) => [memory.id, memory]));
  const responseById = new Map();
  for (const item of rawItems) {
    if (!item || typeof item !== 'object' || !candidateById.has(item.candidateId)) continue;
    let action = ['add', 'update', 'duplicate', 'conflict'].includes(item.action) ? item.action : 'add';
    let existingId = ['update', 'duplicate', 'conflict'].includes(action) && typeof item.existingMemoryId === 'string' && existingById.has(item.existingMemoryId) ? item.existingMemoryId : null;
    if (action === 'update' && !existingId) action = 'add';
    if (['duplicate', 'conflict'].includes(action) && !existingId) action = 'add';
    const original = candidateById.get(item.candidateId);
    let decision = action === 'duplicate' ? 'skip' : action === 'conflict' ? 'review' : action;
    const proposedTitle = clampText(item.title, 160, original.title) || original.title;
    const withinContentLimit = typeof item.content === 'string' && item.content.trim().length <= MAX_AI_MEMORY_CHARS;
    const proposedContent = withinContentLimit ? clampText(item.content, MAX_AI_MEMORY_CHARS, original.content) || original.content : original.content;
    const safeModelText = withinContentLimit && !isUnsafeMemoryText(proposedTitle, proposedContent);
    responseById.set(item.candidateId, {
      ...original,
      title: safeModelText ? proposedTitle : original.title,
      content: safeModelText ? proposedContent : original.content,
      category: MEMORY_CATEGORIES.includes(item.category) ? item.category : original.category,
      tags: item.tags === undefined ? original.tags : cleanTags(item.tags),
      importance: Number.isInteger(item.importance) ? Math.max(1, Math.min(5, item.importance)) : original.importance,
      action,
      existingMemoryId: existingId,
      existingTitle: existingId ? existingById.get(existingId).title : '',
      reason: clampText(item.reason, 400, 'Suggested by AI comparison.') || 'Suggested by AI comparison.',
      decision,
      comparisonConfidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : original.confidence
    });
  }
  return candidates.map((candidate) => responseById.get(candidate.candidateId) || classifyCandidateFallback(candidate, existingMemories));
}

export function buildFallbackProposals(candidates, existingMemories) {
  return candidates.map((candidate) => classifyCandidateFallback(candidate, existingMemories));
}
