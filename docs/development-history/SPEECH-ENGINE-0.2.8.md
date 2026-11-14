# Wemmbu speech and gesture engine — v0.2.8

## Implemented flow

1. OpenRouter continues to stream text tokens to the UI.
2. Each arriving token is appended to a sentence-aware speech buffer immediately; TTS is not delayed until the completed answer is saved.
3. The first completed sentence is eligible for early release at 12 words. Normal segments target about 18 words and are capped at 30 words. Punctuation and clause boundaries are retained where possible.
4. Fish Audio generates individual MP3 segments through the existing local Node API. At most two generation requests are in flight, and no more than three segments are generated/in-flight/ready ahead of playback. Pending text is held as text only.
5. TTS may finish out of order, but audio playback is strictly in original response order.
6. Each MP3 segment is played through the existing Web Audio analyser. The playback timeline records the actual media element's current time, duration and playing state. The mouth uses the real output amplitude envelope (RMS-based), not an unrelated fixed clock.
7. A speech-linked `explain` action starts on the first actual playback event and is held until the full speech queue completes. The AI tool contract also accepts `duration_ms` (500–30,000 ms) and `hold_during_speech` for other timed actions. Speech duration takes precedence for a held pose; `duration_ms` is a fallback estimate.
8. System/browser speech remains the fallback for a segment if Fish Audio generation or playback fails.
9. User interruption cancels queued generation and playback. The TTS route propagates the client abort to the upstream Fish Audio request and records a metadata-only cancellation log.

## Tuning defaults

- First complete-sentence release threshold: 12 words
- Normal target: 18 words
- Maximum segment: 30 words
- Concurrent Fish Audio generation requests: 2
- Buffered/generated segments ahead of playback: 3

These are initial defaults. Fish Audio response time, voice model and network conditions affect actual first-audio latency. The tests verify scheduling and ordering, not provider latency.

## Synchronization limits

The voice, mouth and speech-bound gesture share the same speech session and actual audio playback events. Lip movement remains amplitude-based, so it is sound-envelope synchronization, not phoneme/viseme-level lip sync. Word/phoneme alignment and per-word facial shapes are not claimed in this release.

The TTS transport is sentence-sized REST MP3 requests with bounded prefetch, not a persistent Fish Audio WebSocket byte stream. This keeps each clip independently playable and allows deterministic ordered fallback. If inter-segment gaps remain noticeable on the target machine, a subsequent improvement can adopt Fish Audio's live WebSocket/timestamp streaming path and schedule decoded audio buffers on one Web Audio clock.

## Run and test

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

Expected installer output:

`src-tauri\target\release\bundle\nsis\`

The installed application stores user memory/settings in `%APPDATA%\com.wemmbu.assistant`; do not delete that folder when replacing the installer.
