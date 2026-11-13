import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
const stageSource = await readFile(new URL('./CharacterStage.jsx', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
const queueSource = await readFile(new URL('./speechPlaybackQueue.js', import.meta.url), 'utf8');

 test('LLM text tokens enter the speech queue before the chat stream completes', () => {
  assert.match(appSource, /speechQueue\?\.pushText\(payload\.token\)/);
  assert.match(appSource, /speechQueue\?\.finish\(\)/);
  const streamStart = appSource.indexOf('const speechQueue = voiceEnabled ? createSpeechSession()');
  const streamEnd = appSource.indexOf('}, [input, chatBusy', streamStart);
  assert.ok(streamStart >= 0 && streamEnd > streamStart);
  assert.doesNotMatch(appSource.slice(streamStart, streamEnd), /speak\(reply, false\);/);
});

test('Fish audio chunks are prefetched with bounded concurrency and played in source order', () => {
  assert.match(appSource, /maxConcurrentGenerations:\s*2/);
  assert.match(queueSource, /maxBufferedSegments:\s*3/);
  assert.match(appSource, /targetWords:\s*18/);
  assert.match(appSource, /maxWords:\s*30/);
  assert.match(appSource, /minChunkWords:\s*12/);
  assert.match(appSource, /maxBufferedSegments:\s*3/);
  assert.match(appSource, /speechAudioController\.attachAudio\(audio\)/);
});

test('AI character tool contract supplies duration and speech-hold metadata', () => {
  assert.match(serverSource, /duration_ms:\s*\{ type: 'integer', minimum: 500, maximum: 30000/);
  assert.match(serverSource, /hold_during_speech:\s*\{ type: 'boolean'/);
  assert.match(serverSource, /args\.hold_during_speech === true \? \{ holdDuringSpeech: true \} : \{\}/);
  assert.match(serverSource, /PERFORMANCE TIMING:/);
});

test('speech-linked gestures begin at audio playback and are held until the speech session ends', () => {
  assert.match(appSource, /if \(pendingGesture\?\.holdDuringSpeech\)/);
  assert.match(appSource, /setAction\(pendingGesture\.action\)/);
  assert.match(appSource, /speechAudioController\.endSpeech\(\)/);
  assert.match(stageSource, /holdActionRef\.current === true && speechTimelineRef\?\.current\?\.sessionActive !== false/);
  assert.match(stageSource, /actionElapsedMs >= currentActionDurationMs/);
});


test('Fish Audio generation propagates client cancellation to the upstream request', () => {
  assert.match(serverSource, /async function generateFishAudio\(text, \{ signal: clientSignal \} = \{\}\)/);
  assert.match(serverSource, /AbortSignal\.any\(\[clientSignal, AbortSignal\.timeout\(120000\)\]\)/);
  assert.match(serverSource, /request\.once\('aborted', abortIfDisconnected\)/);
  assert.match(serverSource, /response\.once\('close', abortIfResponseClosed\)/);
  assert.match(serverSource, /provider\.fish_audio\.request\.cancelled/);
});
