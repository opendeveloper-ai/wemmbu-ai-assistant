import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDownToLine, Brain, Check, ChevronLeft, ChevronRight, Download,
  FileText, Filter, LoaderCircle, Pencil, Pin, Plus, RefreshCw, RotateCcw, Search,
  Star, Trash2, Upload, X, Sparkles, GitMerge, AlertTriangle, CheckCheck, ShieldCheck
} from 'lucide-react';
import MarkdownMessage from './MarkdownMessage.jsx';
import { apiUrl } from './api.js';

const PAGE_SIZE = 50;
const MAX_MEMORY_CHARS = 8_000;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_FILES = 25;
const MAX_IMPORT_BATCH_BYTES = 10 * 1024 * 1024;
const MAX_MEMORY_RECORDS = 10_000;
const MAX_MEMORY_STORE_BYTES = 32 * 1024 * 1024;
const MAX_AI_IMPORT_CHARS = 60_000;
const CATEGORIES = [
  { value: 'general', label: 'General' }, { value: 'about', label: 'About me' },
  { value: 'preference', label: 'Preferences' }, { value: 'project', label: 'Projects' },
  { value: 'instruction', label: 'Instructions' }, { value: 'fact', label: 'Facts' },
  { value: 'note', label: 'Notes / imported' },
];
const EMPTY_FORM = { title: '', content: '', category: 'general', tagsText: '', importance: 3, pinned: false };

async function apiRequest(url, options = {}) {
  const response = await fetch(apiUrl(url), {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* Non-JSON error response. */ }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function formFromMemory(memory) {
  return { title: memory.title || '', content: memory.content || '', category: memory.category || 'general', tagsText: (memory.tags || []).join(', '), importance: memory.importance || 3, pinned: Boolean(memory.pinned) };
}

function formatBytes(bytes) {
  const safe = Math.max(0, Number(bytes) || 0);
  return safe >= 1024 * 1024 ? `${(safe / (1024 * 1024)).toFixed(1)} MiB` : `${Math.round(safe / 1024)} KiB`;
}

function titleFromImport(filename, content) {
  const heading = String(content).match(/^\s{0,3}#{1,2}\s+(.+?)\s*#*\s*(?:\r?\n|$)/m)?.[1]?.trim();
  const basename = filename.replace(/\.(?:md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
  return (heading || basename || 'Imported memory').slice(0, 160);
}

function formatDate(timestamp) {
  if (!timestamp) return 'Unknown date';
  try { return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return 'Unknown date'; }
}

function downloadText(filename, content, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MemoryPanel() {
  const [memories, setMemories] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState({ count: 0, deletedCount: 0, revision: 0 });
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [trashOnly, setTrashOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [applyingReview, setApplyingReview] = useState(false);
  const [organizedReview, setOrganizedReview] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const fileInputRef = useRef(null);
  const rawFileInputRef = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setOffset(0); setQuery(searchInput.trim()); }, 220);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadMemories = useCallback(async (signal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (query) params.set('q', query);
      if (category) params.set('category', category);
      if (trashOnly) params.set('deletedOnly', 'true');
      const result = await apiRequest(`/api/memories?${params}`, { signal });
      if (signal?.aborted) return;
      setMemories(Array.isArray(result.items) ? result.items : []);
      setTotal(Number(result.total) || 0);
      if (result.status) setStatus(result.status);
      setError('');
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'Could not load local memories.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [offset, query, category, trashOnly, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMemories(controller.signal);
    return () => controller.abort();
  }, [loadMemories]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const matchesCurrentView = (memory) => {
    if (trashOnly ? !memory.deletedAt : Boolean(memory.deletedAt)) return false;
    if (category && memory.category !== category) return false;
    const tokens = query.toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const haystack = `${memory.title} ${memory.content} ${memory.category} ${(memory.tags || []).join(' ')}`.normalize('NFKC').toLocaleLowerCase('en-US');
    return tokens.every((token) => haystack.includes(token));
  };

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setEditorOpen(true); setError(''); setNotice(''); };
  const openEdit = (memory) => { setEditingId(memory.id); setForm(formFromMemory(memory)); setEditorOpen(true); setError(''); setNotice(''); };
  const closeEditor = () => { if (!saving) { setEditorOpen(false); setEditingId(null); } };

  const saveMemory = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) { setError('A memory needs both a title and content.'); return; }
    if (form.title.trim().length > 160 || form.content.trim().length > MAX_MEMORY_CHARS) { setError('Title limit is 160 characters and content limit is 8,000 characters.'); return; }
    const tags = form.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (tags.length > 20) { setError('Add no more than 20 tags.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { title: form.title.trim(), content: form.content.trim(), category: form.category, tags, importance: Number(form.importance), pinned: Boolean(form.pinned) };
      const result = await apiRequest(editingId ? `/api/memories/${encodeURIComponent(editingId)}` : '/api/memories', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      if (result.status) setStatus(result.status);
      const saved = result.memory;
      if (editingId) {
        const wasVisible = memories.some((memory) => memory.id === saved.id);
        if (wasVisible && matchesCurrentView(saved)) setMemories((current) => current.map((memory) => memory.id === saved.id ? saved : memory));
        else if (wasVisible) { setMemories((current) => current.filter((memory) => memory.id !== saved.id)); setTotal((current) => Math.max(0, current - 1)); }
      } else if (matchesCurrentView(saved)) {
        setTotal((current) => current + 1);
        if (offset === 0) setMemories((current) => [saved, ...current.filter((memory) => memory.id !== saved.id)].slice(0, PAGE_SIZE));
      }
      setNotice(editingId ? 'Memory updated and saved locally.' : 'Memory saved locally.');
      setEditorOpen(false); setEditingId(null);
      if (!editingId && (trashOnly || offset !== 0)) { setTrashOnly(false); setOffset(0); refresh(); }
    } catch (saveError) { setError(saveError.message || 'Could not save memory.'); }
    finally { setSaving(false); }
  };

  const moveToTrash = async (memory) => {
    if (!window.confirm(`Move “${memory.title}” to Memory trash? You can restore it later.`)) return;
    try { const result = await apiRequest(`/api/memories/${encodeURIComponent(memory.id)}`, { method: 'DELETE' }); if (result.status) setStatus(result.status); setMemories((current) => current.filter((item) => item.id !== memory.id)); setTotal((current) => Math.max(0, current - 1)); setNotice('Memory moved to trash.'); setError(''); }
    catch (requestError) { setError(requestError.message || 'Could not delete memory.'); }
  };

  const restoreMemory = async (memory) => {
    try { const result = await apiRequest(`/api/memories/${encodeURIComponent(memory.id)}/restore`, { method: 'POST', body: JSON.stringify({}) }); if (result.status) setStatus(result.status); setMemories((current) => current.filter((item) => item.id !== memory.id)); setTotal((current) => Math.max(0, current - 1)); setNotice('Memory restored.'); setError(''); }
    catch (requestError) { setError(requestError.message || 'Could not restore memory.'); }
  };

  const permanentlyDelete = async (memory) => {
    if (!window.confirm(`Permanently delete “${memory.title}”? This cannot be undone.`)) return;
    try { const result = await apiRequest(`/api/memories/${encodeURIComponent(memory.id)}?permanent=true`, { method: 'DELETE' }); if (result.status) setStatus(result.status); setMemories((current) => current.filter((item) => item.id !== memory.id)); setTotal((current) => Math.max(0, current - 1)); setNotice('Memory permanently deleted.'); setError(''); }
    catch (requestError) { setError(requestError.message || 'Could not permanently delete memory.'); }
  };

  const togglePin = async (memory) => {
    try { const result = await apiRequest(`/api/memories/${encodeURIComponent(memory.id)}`, { method: 'PATCH', body: JSON.stringify({ pinned: !memory.pinned }) }); if (result.status) setStatus(result.status); if (result.memory) setMemories((current) => current.map((item) => item.id === memory.id ? result.memory : item)); setNotice(memory.pinned ? 'Memory unpinned.' : 'Memory pinned.'); setError(''); }
    catch (requestError) { setError(requestError.message || 'Could not update memory.'); }
  };

  const loadAllMemories = async (includeDeleted) => {
    const all = [];
    let nextOffset = 0;
    let totalCount = Infinity;
    while (all.length < totalCount) {
      const params = new URLSearchParams({ limit: '100', offset: String(nextOffset) });
      if (includeDeleted) params.set('includeDeleted', 'true');
      const result = await apiRequest(`/api/memories?${params}`);
      const items = Array.isArray(result.items) ? result.items : [];
      totalCount = Number(result.total) || 0;
      all.push(...items);
      if (!items.length || all.length >= totalCount) break;
      nextOffset += items.length;
    }
    return all;
  };

  const exportMemories = async (format) => {
    setExporting(true); setError('');
    try {
      const all = await loadAllMemories(format === 'json');
      if (!all.length) { setNotice('There are no memories to export.'); return; }
      const date = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        downloadText(`wemmbu-memories-${date}.json`, JSON.stringify({ format: 'wemmbu-memory-export', version: 1, exportedAt: new Date().toISOString(), memories: all }, null, 2), 'application/json;charset=utf-8');
      } else {
        const sections = all.filter((memory) => !memory.deletedAt).map((memory) => {
          const details = [`Category: ${memory.category}`, `Importance: ${memory.importance}/5`, `Tags: ${(memory.tags || []).join(', ') || 'none'}`, `Pinned: ${memory.pinned ? 'yes' : 'no'}`, `Updated: ${new Date(memory.updatedAt).toISOString()}`];
          return `## ${memory.title}\n\n${details.map((line) => `- ${line}`).join('\n')}\n\n${memory.content}`;
        });
        downloadText(`wemmbu-memories-${date}.md`, `# Wemmbu Memory Export\n\n${sections.join('\n\n---\n\n')}\n`, 'text/markdown;charset=utf-8');
      }
      setNotice(`Memory export prepared (${format.toUpperCase()}).`);
    } catch (requestError) { setError(requestError.message || 'Could not export memories.'); }
    finally { setExporting(false); }
  };

  const updateProposal = (proposalId, key, value) => {
    setOrganizedReview((current) => current ? ({
      ...current,
      proposals: current.proposals.map((proposal) => proposal.proposalId === proposalId ? { ...proposal, [key]: value } : proposal)
    }) : current);
  };

  const organizeFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (files.length > MAX_IMPORT_FILES) { setError(`Select no more than ${MAX_IMPORT_FILES} files per batch.`); return; }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_IMPORT_BATCH_BYTES) { setError('Selected files exceed the 10 MiB combined import limit. Split them into smaller batches.'); return; }
    const unsupported = files.find((file) => !/\.(?:md|markdown|txt)$/i.test(file.name));
    if (unsupported) { setError(`Unsupported file: ${unsupported.name}. Choose .txt, .md or .markdown.`); return; }
    const tooLarge = files.find((file) => file.size > MAX_IMPORT_BYTES);
    if (tooLarge) { setError(`${tooLarge.name} exceeds the 2 MB per-file import limit.`); return; }
    if (!window.confirm('AI organization sends the selected document text to the OpenRouter model configured in Settings. Extracted changes remain a draft until you review and apply them. Continue?')) return;
    setOrganizing(true); setError(''); setNotice(''); setOrganizedReview(null);
    let proposals = [];
    const sourceNames = [];
    try {
      for (const file of files) {
        const content = await file.text();
        if (!content.trim()) continue;
        if (content.length > MAX_AI_IMPORT_CHARS) {
          throw new Error(`${file.name} has ${content.length.toLocaleString()} characters. AI organization currently supports ${MAX_AI_IMPORT_CHARS.toLocaleString()} characters per file. Use “Raw notes” for the full document or split it into smaller files.`);
        }
        const result = await apiRequest('/api/memories/organize', { method: 'POST', body: JSON.stringify({ filename: file.name, content }) });
        sourceNames.push(file.name);
        const mapped = (result.proposals || []).map((proposal, index) => ({
          ...proposal,
          proposalId: `${sourceNames.length}-${index + 1}-${proposal.proposalId || 'proposal'}`,
          sourceLabel: file.name,
          tagsText: (proposal.tags || []).join(', '),
          decision: proposal.decision || (proposal.action === 'duplicate' ? 'skip' : proposal.action === 'conflict' ? 'review' : proposal.action || 'add')
        }));
        if (proposals.length + mapped.length > 60) throw new Error('This selection produced more than 60 proposals. Review up to 60 at a time; import the remaining files separately.');
        proposals.push(...mapped);
      }
      if (!proposals.length) {
        setNotice('No durable memories were identified in the selected files. Nothing was saved.');
        return;
      }
      setOrganizedReview({ filename: sourceNames.join(', '), proposals, createdAt: Date.now(), warnings: [] });
      setTrashOnly(false); setCategory(''); setSearchInput(''); setQuery(''); setOffset(0);
      setNotice(`AI proposed ${proposals.length} memory changes for review. Nothing has been saved yet.`);
    } catch (requestError) {
      setError(requestError.message || 'AI organization failed. Nothing from this import was saved automatically.');
      if (proposals.length) setOrganizedReview({ filename: sourceNames.join(', '), proposals, createdAt: Date.now(), warnings: [requestError.message || 'A selected file could not be processed.'] });
    } finally { setOrganizing(false); }
  };

  const importRawFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (files.length > MAX_IMPORT_FILES) { setError(`Select no more than ${MAX_IMPORT_FILES} files per batch.`); return; }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_IMPORT_BATCH_BYTES) { setError('Selected files exceed the 10 MiB combined import limit. Split them into smaller batches.'); return; }
    const unsupported = files.find((file) => !/\.(?:md|markdown|txt)$/i.test(file.name));
    if (unsupported) { setError(`Unsupported file: ${unsupported.name}. Choose .txt, .md or .markdown.`); return; }
    const tooLarge = files.find((file) => file.size > MAX_IMPORT_BYTES);
    if (tooLarge) { setError(`${tooLarge.name} exceeds the 2 MiB per-file import limit.`); return; }
    setImporting(true); setError(''); let created = 0; let duplicateCount = 0;
    try {
      for (const file of files) {
        const content = await file.text();
        if (!content.trim()) continue;
        const result = await apiRequest('/api/memories/import/raw', { method: 'POST', body: JSON.stringify({ filename: file.name, content }) });
        if (result.duplicate) duplicateCount += 1;
        else created += Number(result.created) || 0;
        if (result.status) setStatus(result.status);
      }
      setTrashOnly(false); setCategory(''); setSearchInput(''); setQuery(''); setOffset(0);
      setNotice(`${created} memory ${created === 1 ? 'record' : 'records'} imported; ${duplicateCount} duplicate ${duplicateCount === 1 ? 'file' : 'files'} skipped. Use “Import & organize” to extract and review durable facts.`);
      refresh();
    } catch (requestError) { setError(`${requestError.message || 'Import failed.'}${created ? ` ${created} record(s) were already saved and have been kept.` : ''}`); }
    finally { setImporting(false); }
  };

  const applyOrganizedReview = async () => {
    if (!organizedReview) return;
    const unresolved = organizedReview.proposals.filter((proposal) => proposal.decision === 'review');
    if (unresolved.length) { setError(`Resolve ${unresolved.length} conflict(s) by choosing Add, Update, or Skip before applying.`); return; }
    const items = organizedReview.proposals.map((proposal) => ({
      decision: proposal.decision,
      existingMemoryId: proposal.existingMemoryId,
      sourceLabel: proposal.sourceLabel || organizedReview.filename,
      memory: {
        title: proposal.title,
        content: proposal.content,
        category: proposal.category,
        tags: String(proposal.tagsText ?? (proposal.tags || []).join(', ')).split(',').map((tag) => tag.trim()).filter(Boolean),
        importance: Number(proposal.importance || 3),
        pinned: false
      }
    }));
    setApplyingReview(true); setError('');
    try {
      const result = await apiRequest('/api/memories/apply-organized', { method: 'POST', body: JSON.stringify({ items }) });
      setOrganizedReview(null);
      setTrashOnly(false); setCategory(''); setSearchInput(''); setQuery(''); setOffset(0);
      setNotice(`Memory review complete: ${result.created || 0} added, ${result.updated || 0} updated, ${result.skipped || 0} skipped. Changes saved locally in one transaction.`);
      if (result.status) setStatus(result.status);
      refresh();
    } catch (requestError) { setError(requestError.message || 'Could not apply reviewed memories. No partial batch should have been saved.'); }
    finally { setApplyingReview(false); }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;

  return <div className="memory-page">
    <header className="memory-header">
      <div className="memory-header-icon"><Brain size={21} /></div>
      <div className="memory-header-copy"><span className="memory-eyebrow">LOCAL KNOWLEDGE</span><h2>Memory</h2><p>Your long-term notes, stored on this computer.</p></div>
      <button className="memory-icon-button" type="button" title="Refresh memories" onClick={refresh} disabled={loading}><RefreshCw size={16} /></button>
    </header>
    <div className="memory-stats-row"><div><strong>{status.count}</strong><span>saved</span></div><span className="memory-stat-divider" /><div><strong>{status.deletedCount}</strong><span>in trash</span></div><span className="memory-local-badge"><span /> Stored locally</span></div>
    <div className="memory-capacity-row"><div className="memory-capacity-label"><span>Memory capacity</span><span>{(status.count + status.deletedCount).toLocaleString()} / {MAX_MEMORY_RECORDS.toLocaleString()} records · {formatBytes(status.storageBytes)} / 32 MiB</span></div><progress className="memory-capacity-bar" value={Math.max((status.count + status.deletedCount) / MAX_MEMORY_RECORDS, (Number(status.storageBytes) || 0) / MAX_MEMORY_STORE_BYTES)} max={1} aria-label="Memory store capacity" /></div>
    <div className="memory-action-row">
      <button className="memory-primary-button" type="button" onClick={openCreate}><Plus size={15} /> New memory</button>
      <button className="memory-secondary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={organizing || importing}><Sparkles size={15} /> {organizing ? 'Organizing…' : 'Import & organize'}</button>
      <input ref={fileInputRef} className="memory-hidden-file" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple onChange={organizeFiles} />
      <button className="memory-secondary-button" type="button" onClick={() => rawFileInputRef.current?.click()} disabled={importing || organizing}><Upload size={14} /> {importing ? 'Importing…' : 'Raw notes'}</button>
      <input ref={rawFileInputRef} className="memory-hidden-file" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple onChange={importRawFiles} />
      <div className="memory-export-actions"><button className="memory-secondary-button" type="button" onClick={() => exportMemories('md')} disabled={exporting}><Download size={14} /> Markdown</button><button className="memory-secondary-button memory-export-json" type="button" onClick={() => exportMemories('json')} disabled={exporting}><ArrowDownToLine size={14} /> JSON</button></div>
    </div>
    {(error || notice) && <div className={`memory-feedback ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error ? <AlertCircle size={15} /> : <Check size={15} />}<span>{error || notice}</span><button type="button" title="Dismiss" onClick={() => { setError(''); setNotice(''); }}><X size={13} /></button></div>}

    {editorOpen && <form className="memory-editor-card" onSubmit={saveMemory}>
      <div className="memory-editor-heading"><div><span className="memory-eyebrow">{editingId ? 'EDIT RECORD' : 'NEW RECORD'}</span><h3>{editingId ? 'Edit memory' : 'Create a memory'}</h3></div><button className="memory-icon-button" type="button" aria-label="Close editor" onClick={closeEditor} disabled={saving}><X size={16} /></button></div>
      <label className="memory-field"><span>Title</span><input maxLength={160} value={form.title} onChange={(event) => updateForm('title', event.target.value)} placeholder="A short, clear title" required /></label>
      <div className="memory-form-grid"><label className="memory-field"><span>Category</span><select value={form.category} onChange={(event) => updateForm('category', event.target.value)}>{CATEGORIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label className="memory-field"><span>Importance</span><select value={form.importance} onChange={(event) => updateForm('importance', Number(event.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option value={n} key={n}>{n} / 5</option>)}</select></label></div>
      <label className="memory-field"><span>Content <small>Markdown supported</small></span><textarea maxLength={MAX_MEMORY_CHARS} rows={7} value={form.content} onChange={(event) => updateForm('content', event.target.value)} placeholder="Write the useful detail you want Wemmbu to remember…" required /></label>
      <label className="memory-field"><span>Tags <small>comma-separated</small></span><input value={form.tagsText} onChange={(event) => updateForm('tagsText', event.target.value)} placeholder="project, preference, important" /></label>
      <label className="memory-pin-option"><input type="checkbox" checked={form.pinned} onChange={(event) => updateForm('pinned', event.target.checked)} /><span><Pin size={14} /> Pin this memory for easier access</span></label>
      <div className="memory-editor-footer"><span>{form.content.length.toLocaleString()} / {MAX_MEMORY_CHARS.toLocaleString()} characters</span><div><button type="button" className="memory-secondary-button" onClick={closeEditor} disabled={saving}>Cancel</button><button type="submit" className="memory-primary-button" disabled={saving}>{saving ? <LoaderCircle className="memory-spinner" size={15} /> : <Check size={15} />}{saving ? 'Saving…' : 'Save memory'}</button></div></div>
    </form>}

    <div className="memory-toolbar"><label className="memory-search"><Search size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search titles, notes, tags…" aria-label="Search memories" /><kbd>/</kbd></label><label className="memory-category-filter"><Filter size={14} /><select value={category} onChange={(event) => { setCategory(event.target.value); setOffset(0); }} aria-label="Filter by category"><option value="">All categories</option>{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
    <div className="memory-view-tabs" role="tablist" aria-label="Memory views"><button type="button" role="tab" aria-selected={!trashOnly} className={!trashOnly ? 'active' : ''} onClick={() => { setTrashOnly(false); setOffset(0); }}>All memories <span>{status.count}</span></button><button type="button" role="tab" aria-selected={trashOnly} className={trashOnly ? 'active' : ''} onClick={() => { setTrashOnly(true); setOffset(0); }}>Trash <span>{status.deletedCount}</span></button><span className="memory-view-count">{total} {total === 1 ? 'record' : 'records'}</span></div>

    <div className="memory-list-scroll">
      {organizedReview ? <section className="memory-review-panel">
        <div className="memory-review-header"><div className="memory-review-mark"><GitMerge size={18} /></div><div><span className="memory-eyebrow">AI ORGANIZATION · REVIEW REQUIRED</span><h3>Review proposed memories</h3><p>{organizedReview.proposals.length} proposals from {organizedReview.filename}. Nothing is saved until you apply the review.</p></div><button className="memory-icon-button" type="button" onClick={() => setOrganizedReview(null)} disabled={applyingReview} title="Discard proposals"><X size={16} /></button></div>
        {organizedReview.warnings?.map((warning, index) => <div className="memory-review-warning" key={index}><AlertTriangle size={14} />{warning}</div>)}
        <div className="memory-review-legend"><span className="review-add">Add</span><span className="review-update">Update</span><span className="review-duplicate">Duplicate</span><span className="review-conflict">Conflict needs a decision</span></div>
        <div className="memory-proposal-list">{organizedReview.proposals.map((proposal) => <article className={`memory-proposal-card proposal-${proposal.action}`} key={proposal.proposalId}>
          <div className="memory-proposal-top"><div><h4>{proposal.title}</h4><div className="memory-record-meta"><span className={`memory-proposal-badge ${proposal.action}`}>{proposal.action}</span><span>Confidence {Math.round((proposal.comparisonConfidence ?? proposal.confidence ?? 0.6) * 100)}%</span><span>{CATEGORIES.find((item) => item.value === proposal.category)?.label || proposal.category}</span></div></div></div>
          <p className="memory-proposal-reason">{proposal.reason}</p>
          {proposal.existingMemoryId && <div className="memory-existing-match"><strong>Related saved memory:</strong> {proposal.existingTitle || proposal.existingMemoryId}</div>}
          <label className="memory-field"><span>Decision</span><select value={proposal.decision} onChange={(event) => updateProposal(proposal.proposalId, 'decision', event.target.value)}><option value="review">Choose action…</option><option value="add">Add as new memory</option>{proposal.existingMemoryId && <option value="update">Update related memory</option>}<option value="skip">Skip this proposal</option></select></label>
          <label className="memory-field"><span>Memory title</span><input maxLength={160} value={proposal.title} onChange={(event) => updateProposal(proposal.proposalId, 'title', event.target.value)} /></label>
          <label className="memory-field"><span>Memory content <small>Markdown supported</small></span><textarea rows={3} maxLength={MAX_MEMORY_CHARS} value={proposal.content} onChange={(event) => updateProposal(proposal.proposalId, 'content', event.target.value)} /></label>
          <div className="memory-form-grid"><label className="memory-field"><span>Category</span><select value={proposal.category} onChange={(event) => updateProposal(proposal.proposalId, 'category', event.target.value)}>{CATEGORIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label className="memory-field"><span>Importance</span><select value={proposal.importance} onChange={(event) => updateProposal(proposal.proposalId, 'importance', Number(event.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option value={n} key={n}>{n} / 5</option>)}</select></label></div>
          <label className="memory-field"><span>Tags <small>comma-separated</small></span><input value={proposal.tagsText ?? (proposal.tags || []).join(', ')} onChange={(event) => updateProposal(proposal.proposalId, 'tagsText', event.target.value)} /></label>
        </article>)}</div>
        <div className="memory-review-footer"><span>{organizedReview.proposals.filter((item) => item.decision === 'review').length ? `${organizedReview.proposals.filter((item) => item.decision === 'review').length} decision(s) required` : `${organizedReview.proposals.filter((item) => ['add', 'update'].includes(item.decision)).length} change(s) selected`}</span><div><button className="memory-secondary-button" type="button" onClick={() => setOrganizedReview(null)} disabled={applyingReview}>Discard</button><button className="memory-primary-button" type="button" onClick={applyOrganizedReview} disabled={applyingReview || organizing || organizedReview.proposals.some((item) => item.decision === 'review')}>{applyingReview ? <LoaderCircle className="memory-spinner" size={14} /> : <CheckCheck size={14} />}{applyingReview ? 'Saving…' : 'Apply reviewed changes'}</button></div></div>
      </section> : loading ? <div className="memory-state"><LoaderCircle className="memory-spinner" size={24} /><strong>Loading memories…</strong></div> : memories.length === 0 ? <div className="memory-state"><div className="memory-empty-icon"><Brain size={25} /></div><strong>{error ? 'Memory storage unavailable' : query || category ? 'No matching memories' : trashOnly ? 'Trash is empty' : 'Your memory starts here'}</strong><p>{error || (query || category ? 'Try a different search or category.' : trashOnly ? 'Deleted memories appear here and can be restored.' : 'Save a preference, project detail, instruction, or useful note.')}</p>{error ? <button className="memory-secondary-button" type="button" onClick={refresh}>Retry</button> : !trashOnly && <button className="memory-primary-button" type="button" onClick={openCreate}><Plus size={15} /> Create your first memory</button>}</div> : <div className="memory-record-list">
        {memories.map((memory) => <article className={`memory-record-card ${memory.pinned ? 'is-pinned' : ''} ${memory.deletedAt ? 'is-deleted' : ''}`} key={memory.id}>
          <div className="memory-record-top"><div className="memory-record-symbol">{memory.pinned ? <Pin size={15} /> : <FileText size={15} />}</div><div className="memory-record-title"><h3>{memory.title}</h3><div className="memory-record-meta"><span className="memory-category-pill">{CATEGORIES.find((item) => item.value === memory.category)?.label || memory.category}</span><span>{formatDate(memory.updatedAt)}</span>{memory.deletedAt && <span className="memory-trash-pill">In trash</span>}</div></div>{!memory.deletedAt && <button className={`memory-record-icon ${memory.pinned ? 'active' : ''}`} type="button" title={memory.pinned ? 'Unpin memory' : 'Pin memory'} onClick={() => togglePin(memory)}><Pin size={15} /></button>}</div>
          <div className="memory-record-preview"><MarkdownMessage text={memory.content} /></div>
          {memory.tags?.length > 0 && <div className="memory-record-tags">{memory.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
          <div className="memory-record-footer"><span><Star size={12} /> Importance {memory.importance}/5 <span className="memory-revision">· r{memory.revision}</span></span><div className="memory-record-actions">{memory.deletedAt ? <><button type="button" onClick={() => restoreMemory(memory)}><RotateCcw size={13} /> Restore</button><button className="danger" type="button" onClick={() => permanentlyDelete(memory)}><Trash2 size={13} /> Delete forever</button></> : <><button type="button" onClick={() => openEdit(memory)}><Pencil size={13} /> Edit</button><button className="danger" type="button" onClick={() => moveToTrash(memory)}><Trash2 size={13} /> Delete</button></>}</div></div>
          {memory.source?.label && <div className="memory-source-note">Source: {memory.source.label}</div>}
        </article>)}
      </div>}
    </div>
    {!organizedReview && <footer className="memory-pagination"><span>{total ? `${offset + 1}–${Math.min(offset + memories.length, total)} of ${total}` : 'No records'}</span><div><button className="memory-icon-button" type="button" aria-label="Previous page" disabled={offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}><ChevronLeft size={16} /></button><span>Page {pageNumber} / {pageCount}</span><button className="memory-icon-button" type="button" aria-label="Next page" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset((value) => value + PAGE_SIZE)}><ChevronRight size={16} /></button></div></footer>}
    <div className="memory-footnote"><ShieldCheck size={13} /> Local storage · Imported documents are analyzed by OpenRouter only when you choose Import & organize. Review proposals before saving; Raw notes stores source text directly.</div>
  </div>;
}
