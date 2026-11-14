# Wemmbu AI Assistant v0.2.7 — Explain Gesture + Answer in Parallel

## Reported behavior
A user asked “Explain Quantum Mechanics.” The avatar moved into the Explain pose, but the chat response was only a generic character-action acknowledgement.

## Root cause
OpenRouter can return a tool-only assistant message containing a `character_action` call and no natural-language content. The earlier server implementation returned app-owned commands to the UI but only continued the model conversation when a memory tool was also called. As a result, the model was not asked to produce the actual explanation.

## Changes
- When OpenRouter's first streamed response contains character/equipment commands, the Node API immediately emits an SSE `commands` event before starting the text continuation request.
- The React chat client applies these commands as soon as that event arrives, so the avatar gesture starts while the follow-up answer is being generated and streamed.
- The server then sends the successful action result back to OpenRouter and requests a normal written answer.
- Continuation requests expose only memory tools when a memory operation is still pending; otherwise no tools are passed, so the model cannot call the same character action again.
- The system instructions now explicitly say that avatar actions supplement an answer and never replace it.
- The final client fallback no longer claims “Done — I updated Wemmbu” when there is no written answer; it reports that the action occurred but the model did not return text.
- The client tracks already-applied commands so the final completion payload does not restart an animation that started from the earlier SSE event.
- Package/app version metadata updated to 0.2.7.

## Regression coverage
An integration test reproduces the exact sequence: OpenRouter first returns only `character_action: explain`; the API emits the command SSE event; the continuation request returns a Quantum Mechanics explanation; the final response includes both the Explain command and substantive answer. The test verifies the command event arrives before the first answer token.

## Test results
`npm run test:all`: PASS, 82 tests, 0 failures (62 memory/application, 11 desktop/CORS, 9 asset/equipment).

## Build limitations
Tests ran under Node.js v22.16.0; this project requires Node.js >=24.15.0. Vite is not installed in this environment, so the frontend production build and Windows Tauri/NSIS installer were not built here. Run the supplied Windows build commands after `npm ci` using Node.js >=24.15 and the configured Rust/MSVC toolchain.
