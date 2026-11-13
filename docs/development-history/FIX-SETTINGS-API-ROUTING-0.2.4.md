# Wemmbu Assistant 0.2.4 — Settings API routing fix

## Root cause

`SettingsPanel.jsx` issued requests such as `fetch('/api/settings')` directly. In the packaged Tauri WebView, those relative URLs target the WebView origin rather than the separately managed local Node API at `http://127.0.0.1:8787`. The WebView can return the frontend HTML document, and attempting `response.json()` then raises `Unexpected token '<'`.

## Change

- Imported `apiUrl` from `src/api.js` in `SettingsPanel.jsx`.
- Routed every SettingsPanel API request through `apiUrl`, including settings load/save, OpenRouter test, key removal, and Fish Audio TTS test.
- Browser development continues to use relative `/api/...` paths through the Vite proxy; Tauri WebView uses the managed loopback API.
- Added a regression test that checks all three SettingsPanel API endpoint families use `apiUrl` and that no raw relative `/api/` fetch remains.
- Bumped frontend, lockfile, Cargo, and Tauri app versions to 0.2.4.

## Verification

`npm run test:all` passed:
- Memory/application suite: 61 passed
- Desktop API routing suite: 5 passed (includes new SettingsPanel regression)
- Asset/integration suite: 9 passed
- Total: 75 passed

A production Vite build and Windows NSIS installer were not run in this environment (Vite dependencies are not installed here and Windows/MSVC is unavailable). Build the Windows installer from this source on Windows with `npm ci` followed by `npm run tauri:build:windows`.
