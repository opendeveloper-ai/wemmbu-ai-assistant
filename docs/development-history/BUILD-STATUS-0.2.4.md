# Build status — Wemmbu Assistant 0.2.4

- Settings API routing fixed by using `apiUrl()` for all requests in `SettingsPanel.jsx`.
- Regression test added.
- `npm run test:all`: **75 passed, 0 failed**.
- Production frontend build: not run in this environment (Vite dependencies unavailable).
- Windows Tauri/NSIS build: not run here; build on Windows using the commands in `README-TAURI-INSTALLER.md`.
