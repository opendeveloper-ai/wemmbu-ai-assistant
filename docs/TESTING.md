# Testing and release checks

## Full regression suite

```powershell
npm run test:all
```

The suite includes:
- Memory storage, migration, retrieval, and chat-tool tests.
- Local API, CORS, and Settings integration tests.
- Character action, avatar asset, and equipment regression tests.
- Speech queue and speech integration tests.

## Production build verification

```powershell
npm run build
```

The build runs Vite and the post-build character asset verifier.

## Release verification

```powershell
npm run verify:release
```

This runs all regression tests followed by the production build. Run it with the Node.js version declared in `package.json`.

## Windows installer verification

```powershell
npm run tauri:build:windows
```

Install the generated NSIS package on a clean Windows test account and verify:
- First launch and API startup.
- OpenRouter settings and connection test.
- Memory create/search/update/delete and app restart persistence.
- Fish Audio configuration and system-voice fallback.
- Model, skin, armour, mace, and Totem loading.
- Gestures, equipment attachment, and character rotation.
- Light/dark theme and chat resizing.

Do not label a release as Windows-verified until the installed package has been launched and these checks have been completed.


## Cross-platform development launcher checks

The shared launcher has unit coverage for the Node.js minimum version check, reuse of a healthy API, default-port selection, fallback-port selection and the no-free-port error path. Run those tests with:

```bash
node --test scripts/start-dev.test.mjs
```

On each target operating system, also smoke-test its entry point: `start.bat` on Windows, `./start.sh` on Linux, and `./start.command` on macOS. Verify that the terminal reports the frontend URL, that the API health endpoint responds, and that `Ctrl+C` stops the development processes.
