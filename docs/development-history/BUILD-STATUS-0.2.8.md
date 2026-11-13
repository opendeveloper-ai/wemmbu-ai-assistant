# Build status — Wemmbu AI Assistant v0.2.8

## Completed

- Incremental text-to-speech queue connected to OpenRouter streamed text tokens.
- Sentence-aware segments: early first sentence at 12+ words, target 18 words, maximum 30 words.
- Two concurrent Fish Audio segment-generation requests.
- Maximum three generated/in-flight segments ahead of playback.
- Original playback order retained even when generation finishes out of order.
- Explain gesture begins on actual audio playback and remains active through the response; AI gesture metadata supports duration_ms and hold_during_speech.
- Shared speech session/playback timeline drives the audio mouth analyser and speech-held pose lifecycle.
- System voice fallback at segment level.
- TTS cancellation is propagated from the WebView through the local API to Fish Audio.
- Package, lockfile, Cargo manifest and Tauri config versions are aligned at 0.2.8.

## Verification

`npm run test:all`: **93 tests passed, 0 failed**.

Breakdown:
- Memory/chat/application: 62 passed
- Desktop API/CORS: 11 passed
- Asset/equipment: 9 passed
- Speech queue/integration: 11 passed

Additional checks:
- `node --check` passed for server, shared and script JavaScript files.
- TypeScript parser JSX syntax check passed for all six `src/**/*.jsx` files.
- Package, lockfile and Tauri config versions match at 0.2.8.
- ZIP integrity checked after packaging.

## Not completed in this environment

- Vite production build and Windows NSIS installer were not generated.
- `npm ci --offline` could not complete because `yargs-parser@21.1.1` was absent from the local npm cache.
- Online `npm ci` timed out.
- The available Node runtime here is v22.16.0; the project requires Node >=24.15.0.
- Actual Fish Audio provider latency, Windows WebView2 playback and visual pose/lip sync could not be measured here.

Build the installer on the user's Windows machine with Node 24.15+ and the existing Rust/MSVC/NSIS toolchain:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

The resulting NSIS installer should be under `src-tauri\target\release\bundle\nsis\`.
