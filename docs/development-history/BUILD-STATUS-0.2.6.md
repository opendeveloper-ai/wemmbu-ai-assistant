# Build status — Wemmbu AI Assistant v0.2.6

- Package/application version metadata aligned to 0.2.6.
- Regression test for character action + natural-language response added.
- `npm run test:all`: PASS, 82 tests, 0 failures.
- Node.js used for tests: v22.16.0 (project engine requirement is >=24.15.0).
- Vite production build: NOT RUN; `node_modules/.bin/vite` is not installed in this environment.
- Windows Rust compile / NSIS installer: NOT RUN; must be built on Windows.

Recommended Windows build commands:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```
