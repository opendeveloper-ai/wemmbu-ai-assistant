# Installation and Windows desktop build

This guide covers running the app from source, opening the native Tauri development window and producing the Windows NSIS installer.

## 1. Browser development prerequisites

For the React/Vite app and local API:

- Windows 10 or 11, x64.
- Node.js `24.15.0` or newer.
- npm (included with Node.js).
- Git, if cloning the repository.

Check the installed versions in PowerShell:

```powershell
node --version
npm --version
git --version
```

## 2. Clone and install dependencies

```powershell
git clone https://github.com/opendeveloper-ai/wemmbu-ai-assistant.git
cd wemmbu-ai-assistant
npm ci
```

Use `npm ci` for a clean installation that follows `package-lock.json`.

## 3. Run the browser development app

```powershell
npm run dev
```

The command starts the Node API and Vite frontend together:

| Service | Address | Purpose |
|---|---|---|
| Vite | `http://127.0.0.1:1420` | React development UI |
| Node API | `http://127.0.0.1:8787` | Chat, settings, memory and provider routes |

Open the Vite address in a browser and keep the terminal open. Stop both services with `Ctrl+C`.

On Windows, `start.bat` can check the Node version, install dependencies when needed and start the development services.

## 4. Build the frontend

```powershell
npm run build
```

This runs `vite build` and then `scripts/verify-dist-character-assets.mjs`. The verifier checks that the expected character, skin, armour and equipment assets are present in the production output under `dist/`.

To preview the built frontend locally:

```powershell
npm run preview
```

The preview server is bound to loopback. This command previews the frontend build; it does not start the Tauri desktop host or the local API.

## 5. Requirements for the native Tauri window

The native desktop shell uses Tauri 2 and Rust. On Windows x64, install:

1. Node.js `24.15.0` or newer and npm.
2. Rust stable with the `x86_64-pc-windows-msvc` target, installed through [rustup](https://rustup.rs/).
3. Visual Studio 2022 Build Tools (or Visual Studio) with **Desktop development with C++**, the MSVC toolchain and a Windows SDK.
4. NSIS, for producing the Windows installer.
5. Tauri CLI `2.12.4`.
6. WebView2 Runtime for development. The packaged installer is configured to use the WebView2 bootstrapper for end-user installation.

After installing Rust, make sure the MSVC target is active. From PowerShell:

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustc --version
cargo --version
```

Install the repository's documented Tauri CLI version:

```powershell
cargo install tauri-cli --version 2.12.4 --locked
cargo tauri --version
```

Tauri's official Windows prerequisite guide is available at [v2.tauri.app/start/prerequisites](https://v2.tauri.app/start/prerequisites/).

## 6. How the Tauri window is assembled

The desktop window is configured in `src-tauri/tauri.conf.json`:

- Product/window title: `Wemmbu AI Assistant`.
- Window label: `main`.
- Initial size: `1440 × 920`.
- Minimum size: `1024 × 700`.
- Resizable and centred on startup.
- Development URL: `http://127.0.0.1:1420`.
- Production frontend directory: `../dist`.

The relevant build settings are:

```json
{
  "build": {
    "beforeDevCommand": "npm run dev:ui:tauri",
    "devUrl": "http://127.0.0.1:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  }
}
```

When Tauri starts in development mode, its `beforeDevCommand` launches Vite on port `1420`. The Rust entry point in `src-tauri/src/main.rs` launches the local Node API using the development machine's `node` executable and waits for `GET /api/health` to respond successfully before the app is ready.

In a production build, Tauri loads the compiled Vite files from `dist/`. The build-preparation script `scripts/prepare-tauri-resources.mjs` stages the server files into `src-tauri/resources/app/`. For the Windows installer it also copies the active Node.js executable to `src-tauri/resources/runtime/node.exe`. The Rust host starts that bundled runtime as a child process and stops it when the app exits.

Application data is written to Tauri's OS application-data directory, not to the install directory. The app's API listens on `127.0.0.1:8787`.

## 7. Run the Tauri desktop app in development

From the repository root, with the prerequisites installed:

```powershell
npm ci
npm run tauri:dev
```

This runs the resource preparation script and then `cargo tauri dev`. Tauri runs its configured Vite command and opens the native desktop window.

**Do not start `npm run dev` in a second terminal at the same time.** `npm run tauri:dev` starts the Vite frontend itself, and the Rust desktop host starts the API process. Running both paths together can cause port conflicts on `1420` or `8787`.

## 8. Build the Windows installer

The installer build is intended to run on Windows x64. It requires the Node, Rust/MSVC, Visual Studio C++ Build Tools, NSIS and Tauri CLI prerequisites listed above.

Run:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

The `tauri:build:windows` script:

1. Runs `scripts/prepare-tauri-resources.mjs --windows`.
2. Copies the small set of API source files needed by the packaged app into `src-tauri/resources/app/`.
3. Stages the active Node.js Windows x64 executable into `src-tauri/resources/runtime/node.exe`.
4. Runs `cargo tauri build --bundles nsis`; Tauri runs `npm run build` before packaging.
5. Creates the NSIS installer.

The expected installer output directory is:

```text
src-tauri/target/release/bundle/nsis/
```

Look for a `*-setup.exe` file in that directory.

The installed app includes its Node.js runtime; end users do not need to install Node.js separately. Tauri is configured to use the WebView2 bootstrapper during installation. The installer is not code-signed by default, so Windows may display publisher or SmartScreen warnings. Configure a trusted code-signing certificate before broad distribution.

### Node.js licence file during staging

The preparation script attempts to locate the Node.js licence file automatically. For a release build, you can explicitly provide the licence file from the same official Node.js Windows distribution:

```powershell
$env:NODE_LICENSE_FILE = 'C:\path\to\node-v24.15.0-win-x64\LICENSE'
npm run tauri:build:windows
```

If the file is not found, staging writes a licence notice and continues; for a distributable installer, prefer including the complete licence bundle from the matching Node.js distribution.

## 9. Tests and validation

```powershell
npm run test:memory
npm run test:desktop
npm run test:assets
npm run test:voice
npm run test:all
npm run verify:release
```

`npm run verify:release` runs the complete test suite followed by the production frontend build and asset verification. See [docs/TESTING.md](TESTING.md) for the test groups.

## 10. Troubleshooting

### Port already in use

Check that no earlier development process is still running. The browser development and Tauri development paths both use ports `1420` and `8787`. Stop duplicate Node/Vite processes before restarting.

### Tauri cannot find Rust or the linker

Confirm that the MSVC Rust target is installed and that Visual Studio Build Tools includes the C++ workload and Windows SDK. Open a new terminal after changing the Rust or Visual Studio installation.

### Character or equipment is missing

Run `npm run build` and confirm that the character asset verifier passes. Check that the expected files exist under `public/models/` and inspect the browser/WebView console for GLTFLoader or texture errors.

### Packaged app does not start

Check the startup log at:

```text
%APPDATA%\com.wemmbu.assistant\logs\desktop-startup.log
```

The log records process startup and resource resolution details. Do not post logs publicly without checking them for local paths or other private information.

### Settings or provider requests fail

Confirm that the local API is running on `127.0.0.1:8787`. Check the provider key and selected model in Settings, then review the provider's current service status and error response.

## Related files

- `src-tauri/tauri.conf.json` — window, dev URL, frontend directory and installer settings.
- `src-tauri/src/main.rs` — native startup, Node process lifecycle, health check and app-data location.
- `src-tauri/Cargo.toml` — Rust/Tauri dependencies and release optimisation.
- `scripts/prepare-tauri-resources.mjs` — runtime/API staging for desktop builds.
- `README-TAURI-INSTALLER.md` — concise installer and distribution notes.
