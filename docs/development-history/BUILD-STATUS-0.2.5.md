# Build status — Wemmbu Assistant 0.2.5

- Settings CORS now allows `PUT` for Tauri WebView preflight, retaining the restricted Tauri/loopback-origin allow-list.
- Private Network Access is acknowledged only when the already-allowed local origin asks for it.
- Metadata-only logs now cover settings saves, requests, OpenRouter and Fish Audio network outcomes, and HTTP statuses. Credential values and request bodies are deliberately excluded.
- SettingsPanel displays a useful local API diagnostic message when fetch fails or the server returns non-JSON.
- `npm run test:all`: **81 passed, 0 failed** (61 memory/application + 11 desktop/CORS including live-server integration + 9 asset/equipment checks).
- JavaScript syntax checks passed for the Node server, CORS module, and integration test.
- Vite production build / Windows MSVC / NSIS installer: not executed here. The package must be rebuilt on Windows.

Build on Windows:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

Installer output:

`src-tauri\target\release\bundle\nsis\`

Log location:

`%APPDATA%\com.wemmbu.assistant\logs\desktop-startup.log`
