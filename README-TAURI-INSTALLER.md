# Wemmbu AI Assistant — Tauri Windows installer

The desktop target uses Tauri 2 (WebView2) rather than Electron. The frontend remains React + Vite + Three.js; the local Node API is launched as a managed child process using an embedded Node.js 24 runtime. The installer does not require users to install Node.js separately.

## Build a Windows installer

Open PowerShell in the project root on Windows 10/11 x64 with Node.js 24.15.0, Rust stable/MSVC, Visual Studio C++ Build Tools, NSIS, and Tauri CLI 2.12.4 installed:

```powershell
cargo install tauri-cli --version 2.12.4 --locked
npm ci
npm run test:memory
npm run tauri:build:windows
```

Installer path:

```text
src-tauri/target/release/bundle/nsis/*-setup.exe
```

The generated setup is per-user by default and uses the WebView2 bootstrapper to minimize package size. It can be published as a GitHub Actions artifact using `.github/workflows/windows-tauri-installer.yml` (Actions → Build Wemmbu Windows installer → Run workflow).

## Architecture and performance

- Native Rust/Tauri host with the system WebView2 runtime; no Electron/Chromium bundle.
- Vite production build with lazy-loaded React panels and existing Three.js chunk splitting.
- Release Rust build with `opt-level=3`, full LTO, one codegen unit, and symbol stripping.
- Minimal Node API runtime resources; no server-side npm packages are bundled.
- API starts on loopback only and is restricted to loopback/Tauri webview origins.
- Persistent settings, sessions, and SQLite memory live in the OS app-data folder, not Program Files.
- The Windows installer contains the supplied GLBs and application assets through the Vite production bundle.

## Security and distribution

The local API binds only to `127.0.0.1:8787`. CORS accepts loopback development origins and the Tauri WebView origin; arbitrary remote origins remain blocked. No API keys are embedded in the installer. The user configures service keys inside the app, and they remain in the local app-data folder.

This build is unsigned. Configure a trusted Windows code-signing certificate before broad public distribution to reduce SmartScreen warnings and establish publisher identity.


### Fix for `ENOENT ... D:\\node.js\\LICENSE` while staging the runtime

The Windows resource-preparation script no longer assumes that Node.js is installed at a fixed path or that `LICENSE` sits beside `node.exe`. It searches the active Node installation, common parent locations, `NODE_HOME`, and `NVM_SYMLINK`. If the binary is present but the full license bundle is not, staging continues with an explicit notice instead of failing.

For a release build, preferably point `NODE_LICENSE_FILE` at the full `LICENSE` file from the same official Node.js 24.15+ Windows x64 distribution before running the installer build:

```powershell
$env:NODE_LICENSE_FILE = 'C:\path\to\node-v24.15.0-win-x64\LICENSE'
npm run tauri:build:windows
```

If you do not have that file, the build can proceed; the staged notice records the upstream Node.js license location and explains how to include the complete license bundle.
