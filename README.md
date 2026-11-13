# Wemmbu AI Assistant

An independent, Minecraft-inspired desktop AI companion project built around an interactive 3D character. It combines chat, voice, gestures, equipment interactions, image generation, and a local persistent-memory system.

> **Unofficial fan project.** This software is independently developed and is not affiliated with, endorsed by, sponsored by, or operated by Wemmbu, the Unstable SMP, Mojang Studios, or Microsoft. Names and character references identify the subject of this fan-made project; they do not imply endorsement.

<p align="center">
  <strong>Chat · Voice · 3D character · Gestures · Equipment · Local memory</strong>
</p>

## Project status

- Application version: **0.2.9**
- Frontend: React + Vite
- 3D rendering: Three.js
- Local API: Node.js
- Desktop shell: Tauri 2 / WebView2 on Windows
- Supported development runtime: **Node.js 24.15.0 or newer**

This repository contains a working application codebase. The Windows installer must be built and tested on a supported Windows development machine before making a release.

## Features

### Interactive character
- High-fidelity GLB character rendered with Three.js.
- Drag-to-rotate and camera elevation controls.
- Gesture set including Wave, Explain, Nod/Agree, Shake Head, Think, Point, Present, Shrug, Cheer, Salute, Facepalm, and Stop/Wait.
- Pose and Idle commands, plus a local action parser.
- Netherite armor overlays and hand-held mace / Totem of Undying models.

### AI chat and tools
- OpenRouter-powered chat with configurable model, temperature, output-token limit, and system prompt.
- Local character-action and equipment tools.
- Chat sessions and conversation history.
- Optional web search and image generation integrations, depending on configured providers and available model support.

### Voice
- Fish Audio text-to-speech integration.
- Browser/system voice fallback.
- Speech playback queue with chunking and interruption handling.
- Audio-amplitude-driven mouth animation while speech is playing.
- Browser speech recognition where supported.

A Fish Audio API key and a voice/reference ID that you are authorised to use are required for Fish Audio output. The application no longer ships with a creator-specific voice reference ID preconfigured. Configure your own permitted reference in Settings.

### Persistent memory
- Local memory create, search, update, archive, restore, and delete workflows.
- SQLite-backed storage and migration support.
- Memory retrieval and memory-related chat tools.
- Local backups and validation.

### Desktop experience
- Home, Chat, Actions, Memory, and Settings areas.
- Light, dark, and automatic appearance modes.
- Resizable chat panel.
- Tauri desktop packaging for Windows.

## Screenshots and demo

Add current, real application screenshots and a short demo video here before announcing the repository. Do not use mockups as evidence of features that have not been tested in the current build.

Suggested media:
- `docs/media/home-dark.png`
- `docs/media/home-light.png`
- `docs/media/demo.mp4`

## Quick start (Windows)

### Requirements
- Windows 10 or 11, x64.
- Node.js 24.15.0 or newer and npm.
- A modern WebView2-capable browser/runtime.
- OpenRouter API key for AI chat.
- Optional Fish Audio API key for Fish Audio speech.
- Optional Google AI Studio API key for image generation.

### Run the development app

1. Extract or clone the repository.
2. Open PowerShell in the project directory.
3. Install dependencies:

   ```powershell
   npm ci
   ```

4. Start the local API and Vite frontend:

   ```powershell
   npm run dev
   ```

5. Open the local Vite address shown in the terminal. The configured development UI port is `1420`; the local API uses `127.0.0.1:8787`.
6. Open **Settings** and configure the providers you want to use.

You can also use `start.bat` on Windows. It checks the Node.js version, installs dependencies when needed, and starts the development services.

### Build the frontend

```powershell
npm run build
```

The build runs the Vite production build and the character asset verifier.

### Run tests

```powershell
npm run test:all
```

Before preparing a release:

```powershell
npm run verify:release
```

`verify:release` runs the regression suite and the production build. See [Testing](docs/TESTING.md).

## Configure providers

See [Provider configuration](docs/CONFIGURATION.md) for setup and security details.

- **OpenRouter:** required for AI chat. Add an API key in Settings and choose an available model ID.
- **Fish Audio:** optional speech provider. Add an API key and a voice/reference ID whose use you are authorised to make.
- **Google AI Studio:** optional image-generation provider. Add its API key if you want to use Google image generation.

Provider usage may incur charges or be subject to free-tier limits. Check each provider's current pricing and terms before use.

## Project documentation

- [Installation and Windows desktop build](docs/INSTALLATION.md)
- [Provider configuration](docs/CONFIGURATION.md)
- [Architecture overview](docs/ARCHITECTURE.md)
- [Testing and release checks](docs/TESTING.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Third-party assets and release rights checklist](docs/THIRD_PARTY_AND_RELEASE_RIGHTS.md)
- [Project roadmap](docs/ROADMAP.md)
- [Community launch plan](docs/LAUNCH.md)
- [Funding and GitHub Sponsors](docs/FUNDING.md)
- [Existing Tauri installer notes](README-TAURI-INSTALLER.md)

## Important: licence and asset status

**Do not treat this repository as fully open-source or ready for unrestricted redistribution until the licence and asset review is complete.**

There is currently no root `LICENSE` file. A public GitHub repository without a licence does not grant the public general permission to reuse, modify, or redistribute the code. Choose and add a licence for the original code only after confirming that you own or control the relevant copyright.

The repository also contains third-party and user-supplied assets with different rights:
- Some models are identified as Creative Commons Attribution 4.0 (CC BY 4.0) and require attribution.
- The source and redistribution licence for the four split Netherite armour models have not been verified.
- The Wemmbu logo/face image's redistribution permission is not documented in the current asset inventory.
- The avatar model, character name, and other creator-associated elements do not imply endorsement or a transfer of rights in the creator's identity.

Read [Third-party assets and release rights](docs/THIRD_PARTY_AND_RELEASE_RIGHTS.md) and `THIRD_PARTY_ASSETS.md` before pushing the complete repository publicly. Consider separating original code from assets that cannot be redistributed.

## Privacy and security

- API keys are stored by the local Node service in the app's local data directory; they are not intended to be committed to source control.
- `data/settings.json`, session data, local memory databases, backups, environment files, and build output are excluded by `.gitignore`.
- The local API is designed to bind to loopback (`127.0.0.1`), not to expose a public network service.
- Chat content sent to an AI provider, speech text sent to Fish Audio, and image prompts sent to image providers leave the local machine and are handled under those providers' terms.
- Never paste API keys, access tokens, private logs, or personal memory exports into public issues.

See [Security](SECURITY.md).

## Donations and sponsorships

Community support is intended to fund ongoing development, maintenance, documentation, and issue handling. No payment link is configured in this source package because the maintainer's personal funding profile/URL has not been supplied.

When ready, create a `.github/FUNDING.yml` file using your own personal GitHub Sponsors username or supported funding URL. See GitHub's [guide to displaying a sponsor button](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository).

## Contributing

Bug reports, documentation improvements, and carefully scoped pull requests are welcome once the public release licence and asset policy are finalised. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

Third-party model credits and licence details are maintained in [`THIRD_PARTY_ASSETS.md`](THIRD_PARTY_ASSETS.md). Please preserve those credits and the applicable licence notices when redistributing any permitted assets.
