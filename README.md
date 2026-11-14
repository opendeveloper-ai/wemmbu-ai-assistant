<div align="center">
  <img src="docs/media/github-social-preview.png" alt="Wemmbu AI Assistant — interactive 3D desktop AI companion" width="100%">

  <h1>Wemmbu AI Assistant</h1>

  <p>A cross-platform desktop AI companion featuring an interactive 3D character, AI chat, voice, character actions, equipment and persistent local memory.</p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-2F81F7?style=for-the-badge&logo=gnu&logoColor=white" alt="GNU General Public License v3.0"></a>
    <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/Contributions-Welcome-2F81F7?style=for-the-badge&logo=github&logoColor=white" alt="Contributions welcome"></a>
    <a href="SECURITY.md"><img src="https://img.shields.io/badge/Security-Policy-2F81F7?style=for-the-badge&logo=shield&logoColor=white" alt="Security policy"></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Version-0.2.9-2F81F7?style=for-the-badge" alt="Version 0.2.9">
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-2F81F7?style=for-the-badge&logo=windows&logoColor=white" alt="Windows, Linux and macOS build targets">
    <img src="https://img.shields.io/badge/Desktop-Tauri%202-2F81F7?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri 2 desktop app">
    <img src="https://img.shields.io/badge/Frontend-React%2018-2F81F7?style=for-the-badge&logo=react&logoColor=white" alt="React 18 frontend">
    <img src="https://img.shields.io/badge/3D-Three.js-2F81F7?style=for-the-badge&logo=threedotjs&logoColor=white" alt="Three.js 3D scene">
    <img src="https://img.shields.io/badge/Backend-Node.js-2F81F7?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js backend">
  </p>
</div>

> **Unofficial fan project.** This is an independently developed project. It is not affiliated with, endorsed by, sponsored by, or operated by Wemmbu, the Unstable SMP, Mojang Studios or Microsoft. It does not represent or speak for the person whose character is depicted.

## Screenshots

The screenshots below show the application's current interface. Select any image to view it at full resolution.

<table>
  <tr>
    <td width="50%">
      <a href="docs/media/home.png"><img src="docs/media/home.png" alt="Wemmbu AI Assistant home screen with the 3D character stage" width="100%"></a>
      <p align="center"><strong>Home</strong><br>Interactive character stage and companion workspace</p>
    </td>
    <td width="50%">
      <a href="docs/media/chat.png"><img src="docs/media/chat.png" alt="Wemmbu AI Assistant chat interface" width="100%"></a>
      <p align="center"><strong>Chat</strong><br>AI conversations, voice and character interaction</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="docs/media/memory.png"><img src="docs/media/memory.png" alt="Wemmbu AI Assistant persistent memory interface" width="100%"></a>
      <p align="center"><strong>Memory</strong><br>Manage and search locally stored memories</p>
    </td>
    <td width="50%">
      <a href="docs/media/settings.png"><img src="docs/media/settings.png" alt="Wemmbu AI Assistant settings and provider configuration" width="100%"></a>
      <p align="center"><strong>Settings</strong><br>Configure AI providers, models and application preferences</p>
    </td>
  </tr>
</table>

<details>
  <summary><strong>Table of contents</strong></summary>

  - [Overview](#overview)
  - [Project status](#project-status)
  - [Features](#features)
    - [3D character and actions](#3d-character-and-actions)
    - [AI chat and integrations](#ai-chat-and-integrations)
    - [Voice](#voice)
    - [Persistent memory](#persistent-memory)
  - [Architecture](#architecture)
  - [Repository layout](#repository-layout)
  - [Development setup (Windows, Linux and macOS)](#development-setup-windows-linux-and-macos)
  - [Build and test](#build-and-test)
  - [Build the native Tauri desktop app and platform installers](#build-the-native-tauri-desktop-app-and-platform-installers)
  - [Provider configuration](#provider-configuration)
  - [Local data and privacy](#local-data-and-privacy)
  - [Licence](#licence)
  - [Contributing](#contributing)
  - [Related documentation](#related-documentation)
</details>

## Overview

Wemmbu AI Assistant is a cross-platform desktop AI companion built with **React, Three.js, Node.js and Tauri 2**. It combines an animated 3D character with AI chat, voice output, character actions, equipment interactions, image generation and persistent local memory.

The application is designed as a desktop experience: the React interface runs inside the Tauri window, while a local Node.js service handles provider integrations, application data and memory.

## Project status

| Item | Current implementation |
|---|---|
| Application version | `0.2.9` |
| Frontend | React 18 + Vite |
| 3D scene | Three.js + GLTFLoader |
| Local backend | Node.js HTTP API |
| Desktop host | Tauri 2 + Rust |
| Platform webview | WebView2 (Windows), WebKitGTK (Linux), WKWebView (macOS) |
| Required Node.js for development/build | `24.15.0` or newer |

The repository includes separate GitHub Actions workflows for Windows, Linux and macOS packaging. Windows uses the tested NSIS installer workflow; Linux and macOS installers are newly added CI targets and must complete their first hosted builds and platform-specific smoke tests before being treated as validated releases. A local development run, a frontend production build and a packaged desktop installer are separate checks.

## Features

### 3D character and actions

- Renders the character and equipment models in a Three.js scene.
- Supports character rotation and camera elevation controls.
- Includes gestures such as Wave, Explain, Nod/Agree, Shake Head, Think, Point, Present, Shrug, Cheer, Salute, Facepalm and Stop/Wait.
- Uses a shared action registry for UI actions, local parsing and AI tool definitions.
- Supports armor overlays and held equipment, including a mace and Totem of Undying.

### AI chat and integrations

- Sends chat requests through the local Node API to OpenRouter.
- Exposes character-action and equipment controls to the assistant through local tools.
- Stores chat sessions locally.
- Supports optional web-search and image-generation flows where the configured provider and selected model support them.

### Voice

- Integrates Fish Audio text-to-speech.
- Provides browser/system speech fallback where available.
- Queues speech in chunks and supports interruption.
- Drives mouth animation from audio playback activity.
- Uses browser speech recognition when supported by the environment.

Fish Audio requires an API key and a voice/reference ID that you are permitted to use. The application does not ship with a creator-specific reference ID preconfigured.

### Persistent memory

- Creates, searches, updates, archives, restores and deletes local memories.
- Uses SQLite-backed storage with migration, validation and backup support.
- Makes relevant memory available to chat through memory tools.

## Architecture

The desktop app is **not** an Electron application. Tauri creates the native application window and hosts the React interface in WebView2. A local Node process provides the application API.

```text
Desktop window
└── Tauri 2 host (Rust: src-tauri/)
    ├── Platform-native webview (WebView2 / WebKitGTK / WKWebView)
    │   └── React + Vite frontend (src/ and public/)
    │       └── Three.js character scene and GLB assets
    └── Managed Node.js child process
        └── Local HTTP API (server/index.js)
            ├── OpenRouter chat
            ├── Fish Audio speech
            ├── Google AI Studio image generation
            ├── Settings and chat sessions
            └── SQLite-backed memory
```

The frontend calls the API at `127.0.0.1:8787`. The API binds to loopback rather than acting as a public network server. In a packaged desktop build, Tauri starts the platform-native bundled Node.js runtime and the staged API files. Settings, chat sessions and memory are stored in the operating-system application-data directory. In a development run, project data is stored under `data/` by default.

More detail: [Architecture overview](docs/ARCHITECTURE.md).

## Repository layout

```text
wemmbu-ai-assistant/
├── .github/
│   └── workflows/
│       ├── windows-tauri-installer.yml   # Windows NSIS installer workflow
│       ├── linux-tauri-installers.yml    # Linux DEB and AppImage workflows
│       └── macos-tauri-installers.yml    # macOS Apple Silicon and Intel DMGs
├── data/                                 # Local development data; not committed
├── docs/
│   ├── media/
│   │   ├── github-social-preview.png     # README hero and GitHub social preview
│   │   ├── home.png                      # Home screenshot
│   │   ├── chat.png                      # Chat screenshot
│   │   ├── memory.png                    # Memory screenshot
│   │   └── settings.png                  # Settings screenshot
│   ├── ARCHITECTURE.md                   # Runtime and component boundaries
│   ├── CONFIGURATION.md                  # Provider setup and local data
│   ├── CROSS_PLATFORM_BUILDS.md          # Linux/macOS CI builds and packaging notes
│   ├── FUNDING.md                        # Funding setup notes
│   ├── INSTALLATION.md                   # Development and Tauri build guide
│   ├── LAUNCH.md                         # Community launch notes
│   ├── ROADMAP.md                        # Planned work
│   ├── TESTING.md                        # Test and release commands
│   ├── THIRD_PARTY_AND_RELEASE_RIGHTS.md # Asset/licence notes
│   └── development-history/              # Earlier implementation notes
├── public/
│   ├── assets/                           # Static images and public assets
│   └── models/                           # Character, armour and item models/textures
├── scripts/                              # Build preparation, dev launcher, asset checks and diagnostics
│   ├── start-dev.mjs                     # Shared cross-platform development launcher
│   └── start-dev.test.mjs                # Development launcher tests
├── server/
│   ├── index.js                          # Local HTTP API and provider routes
│   ├── httpCors.js                       # Local-origin/CORS checks
│   ├── memoryEngine.js                   # Memory import/organise logic
│   ├── memorySqliteStore.js              # SQLite memory persistence
│   ├── memoryStore.js                    # Memory storage utilities and compatibility
│   ├── memoryTools.js                     # Chat memory tools/context
│   └── *.test.js                         # Backend and integration tests
├── shared/
│   ├── characterActions.js               # Shared action/gesture registry
│   └── characterAnimation.js             # Shared animation definitions
├── src/
│   ├── App.jsx                           # Main React application and navigation
│   ├── CharacterStage.jsx                # Three.js character stage
│   ├── MarkdownMessage.jsx               # Chat message rendering
│   ├── MemoryPanel.jsx                   # Memory interface
│   ├── SettingsPanel.jsx                 # Provider and application settings
│   ├── api.js                             # Frontend API client
│   ├── speechAudioController.js          # Speech playback/audio integration
│   └── speechPlaybackQueue.js             # Speech chunk queue and playback
├── src-tauri/
│   ├── capabilities/                     # Tauri v2 permissions
│   ├── gen/schemas/                      # Generated Tauri schemas
│   ├── icons/                            # Windows, macOS and Linux application icons
│   ├── src/main.rs                       # Native app entry point and API process host
│   ├── Cargo.toml                        # Rust/Tauri dependencies and release profile
│   └── tauri.conf.json                   # Window, dev URL, frontend and bundle settings
├── verification/                         # Character/model fit reference images
├── CONTRIBUTING.md
├── LICENSE                              # GNU GPL v3.0
├── SECURITY.md
├── THIRD_PARTY_ASSETS.md
├── README-TAURI-INSTALLER.md
├── package.json                         # npm scripts and dependency definitions
├── package-lock.json
├── vite.config.js
├── start.bat                             # Windows development launcher
├── start.sh                              # Linux/macOS terminal launcher
└── start.command                         # macOS Finder/Terminal launcher
```

The tree shows the main areas, not every test, generated schema or asset file. Keep runtime data (credentials, sessions, databases and backups) out of commits.

## Development setup (Windows, Linux and macOS)

### Requirements

- Windows 10/11, a supported Linux desktop distribution, or macOS.
- Git.
- Node.js `24.15.0` or newer, with npm included.
- A working internet connection for the first dependency installation.

Rust, the Tauri CLI and platform webview development packages are **not** required to run the browser-based development app. They are required only when launching or building the native Tauri desktop shell; see [Installation and native desktop builds](docs/INSTALLATION.md).

### Clone the repository

```bash
git clone https://github.com/opendeveloper-ai/wemmbu-ai-assistant.git
cd wemmbu-ai-assistant
node --version
npm --version
```

The Node.js version must satisfy the `engines` entry in `package.json` (`>=24.15.0`). The platform launchers install the locked npm dependencies automatically on first run. You can also install them manually with `npm ci`.

### Start with the platform launcher

| Platform | Launcher | How to run |
|---|---|---|
| Windows | `start.bat` | Double-click it or run `./start.bat` in PowerShell. |
| Linux | `start.sh` | Run `chmod +x ./start.sh` once, then `./start.sh`. Alternatively, use `bash ./start.sh`. |
| macOS | `start.command` | Run `chmod +x ./start.command` once, then `./start.command`; you can also double-click it in Finder to open it in Terminal. Alternatively, use `bash ./start.command`. |

All three launchers use the same `scripts/start-dev.mjs` startup routine. It checks the Node.js version, installs dependencies when needed, checks whether a Wemmbu API is already healthy on port `8787`, selects an available fallback API port (`8788`–`8827`) if another application owns the default port, and starts the frontend and API without intentionally launching a duplicate API process. Keep the terminal open while using the app; press `Ctrl+C` to stop it.

On macOS, the first launch of a downloaded or untrusted `.command` file may be restricted by macOS security settings. Prefer cloning the repository from GitHub and launching it from Terminal; do not bypass macOS security prompts for files whose source you cannot verify.

### Open the development app

The launcher starts:

- Vite frontend: [http://127.0.0.1:1420](http://127.0.0.1:1420)
- Local Node API: `http://127.0.0.1:8787` (or the fallback port reported in the terminal)

Open the frontend address in your browser. The launcher does not automatically open a browser window. Configure provider keys and model options in **Settings**; see [Provider configuration](docs/CONFIGURATION.md).

### Start manually with npm

The same development services can be started on any platform with:

```bash
npm ci       # first run, or after a clean checkout
npm run dev
```

`npm run dev` starts the API and Vite directly. Use `npm run start` or the operating-system launcher for the guided startup checks, first-run dependency installation and API-port collision handling.

## Build and test

Run these from the repository root:

```bash
# Production frontend build, including character asset verification
npm run build

# Full automated test suite
npm run test:all

# Tests plus the production frontend build
npm run verify:release
```

Useful focused checks:

```bash
npm run test:memory
npm run test:desktop
npm run test:assets
npm run test:voice
npm run check:build-chunks
```

The script definitions in `package.json` are the source of truth for available commands. See [Testing](docs/TESTING.md).

## Build the native Tauri desktop app and platform installers

The native window is created by Tauri, not by a separate React window component:

- `src-tauri/tauri.conf.json` defines the `main` window, title, initial size (`1440 × 920`), minimum size (`1024 × 700`) and resize behaviour.
- In development, Tauri starts Vite at `http://127.0.0.1:1420` using `devUrl` and `beforeDevCommand`.
- In a production build, Tauri loads the Vite output from `dist/` (`frontendDist`).
- `src-tauri/src/main.rs` starts the local Node API as a managed child process, waits for its health endpoint and stops it when the desktop app exits.
- `scripts/prepare-tauri-resources.mjs` stages the API source and the native Node.js runtime under `src-tauri/resources/` for the matching build OS (Windows, Linux or macOS).

For a native Tauri development window, install the desktop build prerequisites and run:

```powershell
npm ci
npm run tauri:dev
```

For a Windows NSIS installer, install the Windows build prerequisites and run:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

The installer is written to:

```text
src-tauri/target/release/bundle/nsis/*-setup.exe
```

The installed app includes the Node runtime used by its local API, so end users do not need to install Node.js separately. The WebView2 bootstrapper is configured in the Tauri bundle settings. The installer is currently unsigned unless a code-signing setup is added.

The Windows NSIS wizard uses custom Wemmbu-branded header/sidebar artwork; the GPL-3.0 licence file is included in the platform bundles. Linux packages use the generated application icons, and the macOS DMG uses a custom branded background. See [cross-platform build and installer branding notes](docs/CROSS_PLATFORM_BUILDS.md).

Platform prerequisites and troubleshooting steps are in [docs/INSTALLATION.md](docs/INSTALLATION.md) and [README-TAURI-INSTALLER.md](README-TAURI-INSTALLER.md). The Linux/macOS hosted build targets, artifact names and macOS signing caveat are documented in [docs/CROSS_PLATFORM_BUILDS.md](docs/CROSS_PLATFORM_BUILDS.md).

## Provider configuration

Provider credentials are entered in the application's **Settings** panel and stored by the local Node service.

| Integration | Used for | Required configuration |
|---|---|---|
| OpenRouter | AI chat | API key and model ID |
| Fish Audio | Text-to-speech | API key and permitted voice/reference ID |
| Google AI Studio | Image generation | API key |

Provider use may consume quota or incur charges. Review the provider's current pricing and terms. Chat prompts, speech text or image prompts are sent to the selected provider when those features are used; this application is not an offline-only AI client.

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for setup and data-storage details.

## Local data and privacy

- In development, the API uses `data/` by default. Tauri sets the data directory to the operating-system application-data location.
- Provider credentials, chat sessions, generated images and memory are local application data; they are not source files.
- The API listens on `127.0.0.1:8787`. It is intended for the local desktop app, not as a remotely accessible multi-user service.
- Requests sent to OpenRouter, Fish Audio or Google AI Studio leave the computer and are subject to the provider's policies.
- Do not commit `data/settings.json`, session exports, memory databases, memory backups, `.env` files, API keys or private logs.

Read [SECURITY.md](SECURITY.md) before reporting a security issue.

## Licence

The original project code is distributed under the **GNU General Public License, version 3.0**. See [`LICENSE`](LICENSE) for the complete terms.

Third-party models, textures, images, libraries and other included materials may have their own licences and attribution requirements. The GPL licence for the project code does not replace or override the terms attached to those materials. Refer to [`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md) and preserve the applicable notices when using or redistributing them.

## Contributing

Bug reports, focused fixes, tests and documentation improvements are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Related documentation
- [Cross-platform desktop build workflows](docs/CROSS_PLATFORM_BUILDS.md)

- [Installation and Windows desktop build](docs/INSTALLATION.md)
- [Architecture overview](docs/ARCHITECTURE.md)
- [Provider configuration](docs/CONFIGURATION.md)
- [Testing and release checks](docs/TESTING.md)
- [Third-party assets](THIRD_PARTY_ASSETS.md)
- [Roadmap](docs/ROADMAP.md)
- [Community launch notes](docs/LAUNCH.md)
- [Tauri installer notes](README-TAURI-INSTALLER.md)

---

<div align="center">
  <sub>Built independently. Not affiliated with or endorsed by the creators or rights holders referenced above.</sub>
</div>
