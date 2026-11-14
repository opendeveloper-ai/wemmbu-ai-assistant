# Installation and Windows desktop build

## Development prerequisites

- Windows 10/11 x64.
- Node.js 24.15.0 or newer.
- npm (bundled with Node.js).
- Git (if cloning).
- WebView2 runtime for the Tauri desktop shell.

## Run locally

```powershell
npm ci
npm run dev
```

The Vite frontend uses `127.0.0.1:1420`. The local Node API uses `127.0.0.1:8787`. Keep the terminal open while running the app.

On Windows, `start.bat` can perform the version check, install dependencies if required, and launch the services.

## Production frontend build

```powershell
npm run build
```

This runs `vite build` and then verifies the expected character, skin, armour, and equipment assets in `dist`.

## Build the Windows installer

The Tauri build requires:
- Node.js 24.15.0 or newer.
- Rust stable with the MSVC Windows target.
- Visual Studio C++ Build Tools.
- NSIS.
- Tauri CLI 2.12.4.

Install the CLI if it is not already installed:

```powershell
cargo install tauri-cli --version 2.12.4 --locked
```

Then run:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

The NSIS installer is generated under:

```text
src-tauri/target/release/bundle/nsis/
```

The app bundles a Node runtime for the local API; end users do not need to install Node.js separately.

## Troubleshooting

### The app does not start
- Check that Node.js is 24.15.0 or newer for development.
- Check the terminal output for the Vite or API startup failure.
- Confirm ports `1420` and `8787` are available.
- For the packaged Windows application, inspect `%APPDATA%\\com.wemmbu.assistant\\logs\\desktop-startup.log`.

### The character or equipment is missing
- Run `npm run build` and make sure the asset verification step passes.
- Confirm that all required files listed by `scripts/verify-dist-character-assets.mjs` exist under `public/models`.
- Check the browser/WebView console for GLTFLoader or texture errors.

### Settings do not connect
- Confirm the local API is running on `127.0.0.1:8787`.
- Recheck the provider key in Settings.
- Review the provider-specific error message and current provider status.

For the Tauri resource layout and runtime staging notes, see `README-TAURI-INSTALLER.md`.
