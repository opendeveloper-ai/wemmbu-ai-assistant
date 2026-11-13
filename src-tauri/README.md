# Wemmbu AI Assistant — Tauri desktop shell

This is a Tauri 2 desktop wrapper for the existing React/Three.js frontend and the local Node.js API.

## Windows x64 release build

Requirements:
- Windows 10/11 x64
- Node.js 24.15.0 x64
- Rust stable MSVC toolchain and Visual Studio C++ Build Tools
- Tauri CLI 2.12.4 (`cargo install tauri-cli --version 2.12.4 --locked`)
- NSIS
- WebView2 Runtime (the installer uses Tauri's WebView2 bootstrapper if it is missing)

Run from the repository root:

```powershell
cargo install tauri-cli --version 2.12.4 --locked
npm ci
npm run test:memory
npm run tauri:build:windows
```

The installer is written to:

```text
src-tauri/target/release/bundle/nsis/
```

The script stages a minimal backend resource set, embeds the current Node.js executable, and includes its license notice. The Rust app starts and supervises the API process, stores settings/memory under the OS app-data directory, waits for the loopback API to become ready, and stops the API when the desktop app exits. No terminal window is shown in release mode.

## Development

```powershell
npm ci
npm run tauri:dev
```

Development uses the Node.js executable on PATH and Vite on `127.0.0.1:1420`. The local API listens on `127.0.0.1:8787`.

## Packaging notes

- Release output is NSIS (`*-setup.exe`), per-user install by default; it does not require administrator rights.
- WebView2 uses the online bootstrapper mode to keep installer size lower. Internet access may be required on machines without WebView2 already installed.
- The API backend has no npm runtime dependencies; Node built-ins (including `node:sqlite`) are used.
- The installer contains the Node runtime, API modules, frontend build, and original GLB assets.
- API data is written to Tauri's application data directory rather than the installation folder.
- The Rust release profile uses full LTO, one codegen unit, native optimization, and symbol stripping.
- Code signing is not configured. A production-distributed installer should be signed with an organisation/publisher certificate to reduce Windows SmartScreen warnings.
