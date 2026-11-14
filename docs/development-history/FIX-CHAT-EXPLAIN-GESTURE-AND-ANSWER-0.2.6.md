# Wemmbu AI Assistant v0.2.6 — Chat Action + Answer Fix

## User-visible issue
When the user asked an informational question such as “Explain Quantum Mechanics”, OpenRouter sometimes returned only a `character_action` tool call (`explain`). The server returned the action command to the UI but did not request a follow-up text response unless a memory tool was also present. The client then substituted a generic “Done — I updated Wemmbu’s character…” reply.

## Root cause
`server/index.js` only entered its server-side tool continuation loop when `initialCalls.some(isMemoryToolCall)` was true. Character actions and equipment calls were treated as UI-only commands and skipped the model continuation. A tool-only model response therefore contained no written answer.

## Fix
- Detect app-owned `character_action` and `set_equipment` tool calls.
- When an app action is returned without any text, append a tool result indicating that the action has been queued for the desktop UI.
- Make a follow-up OpenRouter request to obtain the actual user-facing answer.
- When no memory operation is pending, omit function tools from the continuation request so the model must produce text and cannot repeat the gesture.
- When memory tools are also present, expose only `MEMORY_TOOL_DEFINITIONS` on follow-up rounds, preventing duplicate character-action calls while preserving memory workflows.
- Strengthen server system instructions: avatar actions supplement the answer and never replace it.
- Replace the generic “Done — I updated...” client fallback with an honest diagnostic sentence if a model still returns no written answer.
- Add an integration test reproducing the exact scenario: `Explain Quantum Mechanics.` produces both an `explain` command and a substantive answer.

## Tests
`npm run test:all` passed: 82 tests total (62 memory/application, 11 desktop/CORS, 9 assets/equipment).

## Build limitations
The source test suites ran successfully under the available Node.js 22.16.0 runtime. The project requires Node.js >=24.15.0. Vite dependencies are not installed in this environment, so the Vite production build and Windows Tauri/NSIS installer were not run here. Build the Windows installer on the user's Windows machine after `npm ci` with the required Node and Rust toolchains.
