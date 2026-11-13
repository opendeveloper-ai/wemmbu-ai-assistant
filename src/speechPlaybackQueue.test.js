import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpeechSegments, SpeechPlaybackQueue } from './speechPlaybackQueue.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('speech segmenter combines short sentences and splits long speech near target words', () => {
  const first = extractSpeechSegments('One short sentence. Another short sentence.', { targetWords: 6 });
  assert.equal(first.segments.length, 1);
  assert.match(first.segments[0], /One short sentence\..*Another short sentence\./);

  const long = Array.from({ length: 72 }, (_, index) => `word${index + 1}`).join(' ');
  const extracted = extractSpeechSegments(long, { targetWords: 20, maxWords: 28, final: true });
  assert.ok(extracted.segments.length >= 2);
  assert.ok(extracted.segments.every((part) => part.split(/\s+/).length <= 28));
  assert.ok(extracted.remainder.split(/\s+/).length <= 28);
});

test('queue generates incrementally with a bounded concurrency and plays in text order', async () => {
  const generated = [];
  const played = [];
  const starts = [];
  const gates = [];
  let active = 0;
  let peakActive = 0;
  const queue = new SpeechPlaybackQueue({
    targetWords: 6,
    maxWords: 8,
    maxConcurrentGenerations: 2,
    generateAudio: async (text) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      const gate = deferred();
      gates.push(gate);
      generated.push(text);
      const audio = await gate.promise;
      active -= 1;
      return audio;
    },
    playAudio: async (audio, text, onStart) => {
      onStart();
      played.push(`${audio}:${text}`);
    },
    onPlaybackStart: () => starts.push('start'),
  });

  queue.pushText('One complete sentence has enough words. Another complete sentence has enough words.');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(generated.length, 2);
  assert.equal(peakActive, 2);
  // Resolve the second clip first; playback must still wait for the first.
  gates[1].resolve('audio-2');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(played, []);
  gates[0].resolve('audio-1');
  queue.finish();
  const result = await queue.done;
  assert.equal(result.cancelled, false);
  assert.deepEqual(played.map((entry) => entry.slice(0, 7)), ['audio-1', 'audio-2']);
  assert.equal(starts.length, 1);
});

test('queue flushes final unterminated text and completes once', async () => {
  let played = 0;
  let finished = 0;
  const queue = new SpeechPlaybackQueue({
    generateAudio: async (text) => ({ text }),
    playAudio: async (audio, text, onStart) => { onStart(); played += 1; },
    onPlaybackFinish: () => { finished += 1; },
  });
  queue.pushText('This final thought has no punctuation');
  await queue.finish();
  assert.equal(played, 1);
  assert.equal(finished, 1);
});

test('queue cancellation aborts pending generation and does not complete as success', async () => {
  let aborted = false;
  const queue = new SpeechPlaybackQueue({
    targetWords: 6,
    generateAudio: (_text, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }),
    playAudio: async () => {},
  });
  queue.pushText('This sentence has enough words to be sent. ');
  await new Promise((resolve) => setImmediate(resolve));
  queue.cancel();
  const result = await queue.done;
  assert.equal(result.cancelled, true);
  assert.equal(aborted, true);
});


test('queue bounds prefetched audio while the current clip is playing', async () => {
  let releaseFirstPlayback;
  const firstPlaybackGate = new Promise((resolve) => { releaseFirstPlayback = resolve; });
  const generated = [];
  const played = [];
  let first = true;
  const queue = new SpeechPlaybackQueue({
    targetWords: 6,
    maxWords: 8,
    maxConcurrentGenerations: 2,
    maxBufferedSegments: 3,
    generateAudio: async (text) => {
      generated.push(text);
      await new Promise((resolve) => setImmediate(resolve));
      return `audio-${generated.length}`;
    },
    playAudio: async (audio, text, onStart) => {
      onStart();
      played.push(text);
      if (first) { first = false; await firstPlaybackGate; }
    },
  });

  const sentences = Array.from({ length: 9 }, (_, index) => `Wemmbu speaks clearly while the avatar moves.`).join(' ');
  queue.pushText(sentences);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(generated.length, 3, 'only three audio segments may be generated or waiting ahead of playback');
  assert.equal(played.length, 1, 'the first clip should be the only clip playing while its playback is held');

  releaseFirstPlayback();
  await queue.finish();
  assert.equal(played.length, 9);
});


test('first complete natural sentence is released early for lower first-audio latency', () => {
  const sentence = 'Quantum mechanics describes matter and energy at very small scales in ways classical physics cannot explain.';
  const extracted = extractSpeechSegments(`${sentence} The next sentence adds a little more context.`, { targetWords: 18, maxWords: 30, minChunkWords: 12 });
  assert.equal(extracted.segments[0], sentence);
});
