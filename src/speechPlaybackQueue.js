/**
 * Incremental, ordered speech queue.
 *
 * Text is accepted as LLM tokens arrive. Completed sentence/phrase segments are
 * sent to TTS immediately, with at most `maxConcurrentGenerations` requests in
 * flight. Audio is always played in original text order, even when a later TTS
 * request finishes first. The queue is deliberately provider-agnostic.
 */

const DEFAULTS = Object.freeze({
  targetWords: 18,
  maxWords: 30,
  minChunkWords: 12,
  maxConcurrentGenerations: 2,
  maxBufferedSegments: 3,
});

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function splitAtWordBoundary(value, maxWords) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [String(value || '').trim(), ''];

  // Prefer a natural clause boundary close to the requested size.
  const lower = Math.max(10, Math.floor(maxWords * 0.62));
  let splitIndex = maxWords;
  for (let index = Math.min(maxWords, words.length - 1); index >= lower; index -= 1) {
    if (/[,:;—–-]$/.test(words[index - 1])) {
      splitIndex = index;
      break;
    }
  }
  return [words.slice(0, splitIndex).join(' '), words.slice(splitIndex).join(' ')];
}

/**
 * Pull complete speech segments from a streaming text buffer.
 * Short sentences are combined until targetWords; long sentences are split at
 * clause/word boundaries. The uncompleted suffix stays buffered until more text
 * arrives or `final` is true.
 */
export function extractSpeechSegments(buffer, options = {}) {
  const targetWords = Math.max(6, Number(options.targetWords) || DEFAULTS.targetWords);
  const maxWords = Math.max(targetWords, Number(options.maxWords) || DEFAULTS.maxWords);
  const minChunkWords = Math.max(6, Math.min(targetWords, Number(options.minChunkWords) || DEFAULTS.minChunkWords));
  const final = options.final === true;
  let source = String(buffer || '');
  const segments = [];
  let carry = '';

  const flushOversized = (value) => {
    let remaining = value.trim();
    while (wordCount(remaining) > maxWords) {
      const [head, tail] = splitAtWordBoundary(remaining, maxWords);
      if (!head) break;
      segments.push(head);
      remaining = tail;
    }
    return remaining;
  };

  // Keep punctuation attached to each sentence. This works across token
  // boundaries because `source` retains the final incomplete sentence.
  const sentencePattern = /[^.!?]+[.!?]+["')\]]*(?:\s+|$)/g;
  const completeSentences = [];
  let match;
  let consumed = 0;
  while ((match = sentencePattern.exec(source)) !== null) {
    completeSentences.push(match[0].trim());
    consumed = sentencePattern.lastIndex;
  }
  let remainder = source.slice(consumed);

  for (const sentence of completeSentences) {
    const combined = [carry, sentence].filter(Boolean).join(' ').trim();
    carry = flushOversized(combined);
    if (wordCount(carry) >= targetWords || (segments.length === 0 && wordCount(carry) >= minChunkWords)) {
      segments.push(carry);
      carry = '';
    }
  }

  if (final) {
    const allRemaining = [carry, remainder].filter(Boolean).join(' ').trim();
    let pending = allRemaining;
    while (wordCount(pending) > maxWords) {
      const [head, tail] = splitAtWordBoundary(pending, maxWords);
      if (!head) break;
      segments.push(head);
      pending = tail;
    }
    if (pending) segments.push(pending);
    remainder = '';
    carry = '';
  } else {
    const combinedRemainder = [carry, remainder].filter(Boolean).join(' ').trim();
    let pending = combinedRemainder;
    while (wordCount(pending) > maxWords) {
      const [head, tail] = splitAtWordBoundary(pending, maxWords);
      if (!head) break;
      segments.push(head);
      pending = tail;
    }
    remainder = pending;
    carry = '';
  }

  return { segments: segments.filter(Boolean), remainder: remainder.trim() };
}

export class SpeechPlaybackQueue {
  constructor({
    generateAudio,
    playAudio,
    playFallback,
    onPlaybackStart = () => {},
    onPlaybackFinish = () => {},
    onError = () => {},
    maxConcurrentGenerations = DEFAULTS.maxConcurrentGenerations,
    maxBufferedSegments = DEFAULTS.maxBufferedSegments,
    targetWords = DEFAULTS.targetWords,
    maxWords = DEFAULTS.maxWords,
    minChunkWords = DEFAULTS.minChunkWords,
  }) {
    if (typeof generateAudio !== 'function' || typeof playAudio !== 'function') {
      throw new TypeError('SpeechPlaybackQueue requires generateAudio and playAudio functions.');
    }
    this.generateAudio = generateAudio;
    this.playAudio = playAudio;
    this.playFallback = playFallback;
    this.onPlaybackStart = onPlaybackStart;
    this.onPlaybackFinish = onPlaybackFinish;
    this.onError = onError;
    this.maxConcurrentGenerations = Math.max(1, Math.min(3, Number(maxConcurrentGenerations) || 2));
    this.chunkOptions = { targetWords, maxWords, minChunkWords };
    this.maxBufferedSegments = Math.max(2, Math.min(6, Number(maxBufferedSegments) || DEFAULTS.maxBufferedSegments));

    this.buffer = '';
    this.items = [];
    this.pendingSegments = [];
    this.controllers = new Set();
    this.activeGenerations = 0;
    this.playIndex = 0;
    this.playing = false;
    this.started = false;
    this.closed = false;
    this.cancelled = false;
    this.finished = false;
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
  }

  pushText(token) {
    if (this.closed || this.cancelled || typeof token !== 'string' || !token) return;
    this.buffer += token;
    const extracted = extractSpeechSegments(this.buffer, this.chunkOptions);
    this.buffer = extracted.remainder;
    extracted.segments.forEach((segment) => this.#enqueue(segment));
  }

  finish() {
    if (this.closed || this.cancelled) return this.done;
    this.closed = true;
    const extracted = extractSpeechSegments(this.buffer, { ...this.chunkOptions, final: true });
    this.buffer = '';
    extracted.segments.forEach((segment) => this.#enqueue(segment));
    this.#pumpGenerators();
    this.#drainPlayback();
    this.#maybeFinish();
    return this.done;
  }

  cancel() {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.pendingSegments.length = 0;
    this.buffer = '';
    this.resolveDone({ cancelled: true });
  }

  #enqueue(text) {
    this.pendingSegments.push(text);
    this.#pumpGenerators();
    this.#drainPlayback();
  }

  #pumpGenerators() {
    // Bound the number of generated/in-flight clips waiting ahead of playback.
    // Extra text stays as small strings and is promoted only as a clip finishes.
    while (!this.cancelled
      && this.activeGenerations < this.maxConcurrentGenerations
      && this.pendingSegments.length
      && (this.items.length - this.playIndex) < this.maxBufferedSegments) {
      const text = this.pendingSegments.shift();
      const controller = new AbortController();
      this.controllers.add(controller);
      let resolveResult;
      const result = new Promise((resolve) => { resolveResult = resolve; });
      const item = { text, controller, result, resolveResult };
      this.items.push(item);
      this.activeGenerations += 1;
      Promise.resolve()
        .then(() => this.generateAudio(item.text, item.controller.signal))
        .then((audio) => item.resolveResult({ audio }))
        .catch((error) => item.resolveResult({ error }))
        .finally(() => {
          this.controllers.delete(item.controller);
          this.activeGenerations -= 1;
          this.#pumpGenerators();
          this.#drainPlayback();
          this.#maybeFinish();
        });
    }
  }

  #signalStart() {
    if (this.started) return;
    this.started = true;
    this.onPlaybackStart();
  }

  async #drainPlayback() {
    if (this.playing || this.cancelled) return;
    this.playing = true;
    try {
      while (!this.cancelled && this.playIndex < this.items.length) {
        const item = this.items[this.playIndex];
        const result = await item.result;
        if (this.cancelled) break;
        if (result.error) {
          if (result.error?.name === 'AbortError') break;
          this.onError(result.error, { text: item.text, phase: 'generate' });
          if (typeof this.playFallback === 'function') {
            try {
              await this.playFallback(item.text, () => this.#signalStart());
            } catch (fallbackError) {
              this.onError(fallbackError, { text: item.text, phase: 'fallback' });
            }
          }
        } else if (result.audio != null) {
          try {
            await this.playAudio(result.audio, item.text, () => this.#signalStart());
          } catch (error) {
            if (error?.name !== 'AbortError' && !this.cancelled) {
              this.onError(error, { text: item.text, phase: 'playback' });
              if (typeof this.playFallback === 'function') {
                try { await this.playFallback(item.text, () => this.#signalStart()); }
                catch (fallbackError) { this.onError(fallbackError, { text: item.text, phase: 'fallback' }); }
              }
            }
          }
        }
        item.result = null;
        item.controller = null;
        this.playIndex += 1;
        this.#pumpGenerators();
      }
    } finally {
      this.playing = false;
      this.#maybeFinish();
      if (!this.cancelled && this.playIndex < this.items.length) this.#drainPlayback();
    }
  }

  #maybeFinish() {
    if (this.finished || this.cancelled || !this.closed || this.playing) return;
    if (this.activeGenerations > 0 || this.pendingSegments.length > 0 || this.playIndex < this.items.length) return;
    this.finished = true;
    this.onPlaybackFinish({ started: this.started, segmentCount: this.items.length });
    this.items.length = 0;
    this.resolveDone({ cancelled: false, started: this.started });
  }
}
