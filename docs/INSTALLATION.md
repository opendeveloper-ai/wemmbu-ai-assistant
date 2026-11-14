# Installation and native desktop build guide

This guide covers the browser-based development app and the native Tauri desktop application. The browser development launchers work on Windows, Linux and macOS; native Tauri builds additionally require platform-specific system tools.

## 1. Browser development prerequisites

- Windows 10/11, a Linux desktop distribution, or macOS.
- Node.js `24.15.0` or newer, with npm.
- Git, if cloning the repository.
- Internet access for the initial npm dependency installation.

You do **not** need Rust, Visual Studio, NSIS, Xcode or Linux WebKit development packages just to run the browser development app.

## 2. Clone the repository

```bash
git clone https://github.com/opendeveloper-ai/wemmbu-ai-assistant.git
cd wemmbu-ai-assistant
node --version
npm --version
```

The Node.js version must satisfy the `engines` entry in `package.json` (`>=24.15.0`). Node.js 24.15.0 or newer is required because the backend uses Node's built-in SQLite support.

## 3. Start the app using your operating system's launcher

The launchers all delegate to `scripts/start-dev.mjs`, so startup checks and port handling stay consistent across platforms.

### Windows

Double-click `start.bat`, or run it from PowerShell:

```powershell
.\start.bat
```

### Linux

From the repository root, make the launcher executable and run it:

```bash
chmod +x ./start.sh
./start.sh
```

If you do not want to change its executable permission, run it through Bash:

```bash
bash ./start.sh
```

### macOS

From Terminal, make the launcher executable and run it:

```bash
chmod +x ./start.command
./start.command
```

You can also double-click `start.command` in Finder; macOS opens it in Terminal. If Finder does not launch it, open Terminal, `cd` into the repository, and use the commands above. `bash ./start.command` is an alternative when the executable bit is not set.

Only run scripts from a repository you trust. Do not bypass macOS security prompts for an unknown or untrusted file.

## 4. What the launcher does

On all three platforms, the launcher:

1. Checks that Node.js 24.15.0 or newer and npm are available.
2. Runs `npm ci` when dependencies are not installed (or the required `concurrently` dependency is missing).
3. Checks the API health endpoint at `http://127.0.0.1:8787/api/health`.
4. Reuses a healthy existing Wemmbu API rather than starting a duplicate process.
5. If port `8787` is occupied by another service, selects an available fallback from `8788` through `8827`.
6. Starts the Vite frontend and local Node API, or only the frontend when it can reuse the existing healthy API.

Keep the terminal open while using the app. Press `Ctrl+C` in that terminal to stop the development services.

The Vite frontend is available at [http://127.0.0.1:1420](http://127.0.0.1:1420). The API normally uses `http://127.0.0.1:8787`; if a fallback is selected, the terminal prints the chosen port. Open the Vite address in your browser. The launcher does not automatically open a browser window.

The Vite port `1420` must be free. If another process is using it, stop that process and rerun the launcher.

## 5. Start manually with npm

You can bypass the launcher and start the development services directly:

```bash
npm ci
npm run dev
```

This direct npm command does not perform the launcher's API health reuse or fallback-port selection. For the guided startup experience, use `start.bat`, `start.sh` or `start.command`.

## 6. Production frontend build

On any platform with the supported Node.js version:

```bash
npm run build
```

This runs `vite build` and verifies the expected character, skin, armour and equipment assets in `dist`.

## 7. Native Tauri development prerequisites

Running the browser development app does not require these packages. Install the appropriate platform tools only if you want to run `npm run tauri:dev` or build a native installer locally.

### Windows

- Node.js 24.15.0 or newer and npm.
- Rust stable and the MSVC Windows target.
- Visual Studio C++ Build Tools.
- WebView2 Runtime.
- Tauri CLI 2.12.4.
- NSIS for the Windows installer.

### Linux (Ubuntu/Debian example)

- Node.js 24.15.0 or newer and npm.
- Rust stable and the `x86_64-unknown-linux-gnu` target for x64 builds.
- Tauri CLI 2.12.4.
- Tauri's GTK/WebKit and packaging dependencies. On Ubuntu 22.04, the CI workflow installs:

```bash
sudo apt-get update
sudo apt-get install --yes \
  libwebkit2gtk-4.1-dev \
  build-essential curl wget file libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2
```

Package names can differ across Linux distributions. Consult the distribution-specific Tauri prerequisites before installing native build dependencies.

### macOS

- A supported macOS version and Xcode Command Line Tools.
- Node.js 24.15.0 or newer and npm.
- Rust stable and the target architecture for the Mac you are building on.
- Tauri CLI 2.12.4.

Install the Xcode Command Line Tools with:

```bash
xcode-select --install
```

## 8. Run the native Tauri development window

After installing the native prerequisites for your platform:

```bash
npm ci
npm run tauri:dev
```

Tauri starts the native application window and the local Node API. The platform launcher scripts described earlier start the browser-based development app, not the Tauri window.

## 9. Build a native installer locally

The package scripts are platform-specific and must be run on the matching operating system:

### Windows NSIS installer

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

Output:

```text
src-tauri/target/release/bundle/nsis/*-setup.exe
```

### Linux DEB and AppImage installers

```bash
npm ci
npm run test:all
npm run tauri:build:linux
```

Outputs:

```text
src-tauri/target/release/bundle/deb/*.deb
src-tauri/target/release/bundle/appimage/*.AppImage
```

### macOS DMG installer

```bash
npm ci
npm run test:all
npm run tauri:build:macos
```

Output:

```text
src-tauri/target/release/bundle/dmg/*.dmg
```

The local build script stages a native Node.js runtime for the build machine's operating system and architecture. Cross-platform builds are also configured in GitHub Actions; see [Cross-platform build workflows](CROSS_PLATFORM_BUILDS.md).

## 10. Troubleshooting

### Node.js is missing or too old

Install Node.js 24.15.0 or newer, make sure npm is included, close and reopen the terminal, and check `node --version` and `npm --version`.

### Dependencies do not install

Check your internet connection, then run `npm ci` manually from the repository root. If the lockfile and `package.json` were changed intentionally, commit the matching lockfile update too.

### Port 1420 is already in use

Stop the other frontend development server and rerun the launcher. Vite uses strict port binding on `127.0.0.1:1420`.

### API port 8787 is already in use

The shared launcher first checks whether the service on port `8787` is a healthy Wemmbu API. If it is, the launcher reuses it. If another application owns the port, the launcher searches ports `8788`–`8827`. If none are free, stop the conflicting service and try again.

### The app does not start

Run the launcher from a terminal so its error output remains visible. Check the Node.js version, npm installation, and whether ports `1420` and `8787` (or the selected fallback) are available.

### Settings do not connect

Confirm that the local API is running and that the frontend was started by the launcher or `npm run dev`. Recheck the provider key in Settings and review the provider-specific error message.

### Packaged desktop startup fails

For the packaged desktop application, inspect `desktop-startup.log` in the operating-system-specific application data directory. On Windows, the log is typically under `%APPDATA%\com.wemmbu.assistant\logs\desktop-startup.log`.

For Tauri resource staging and runtime layout, see [README-TAURI-INSTALLER.md](../README-TAURI-INSTALLER.md) and [Cross-platform build workflows](CROSS_PLATFORM_BUILDS.md).
