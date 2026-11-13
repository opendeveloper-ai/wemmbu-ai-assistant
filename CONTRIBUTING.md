# Contributing

Contributions are welcome. The most useful contributions are reproducible bug reports, focused fixes, regression tests and documentation that makes the project easier to build and maintain.

## Before starting work

1. Search existing issues and pull requests for the same problem.
2. For a large change, open an issue first and describe the intended behaviour and affected parts of the app.
3. Keep pull requests focused. Avoid combining unrelated UI, backend and build-system changes.
4. Do not include API keys, provider tokens, personal chat exports, local memory databases, backups or private diagnostic logs.
5. Before adding a model, image, texture, sound or other third-party material, confirm that its licence permits the intended use and add the required attribution to `THIRD_PARTY_ASSETS.md`.

## Development environment

The supported development runtime is Node.js `24.15.0` or newer. Install dependencies from the repository root:

```powershell
npm ci
```

Run the browser development app with:

```powershell
npm run dev
```

Vite is served at `http://127.0.0.1:1420`; the local Node API listens at `http://127.0.0.1:8787`. Keep the terminal open while testing.

To run the native Tauri development window, install the Rust/MSVC, Visual Studio C++ Build Tools and Tauri CLI prerequisites described in [docs/INSTALLATION.md](docs/INSTALLATION.md), then run:

```powershell
npm run tauri:dev
```

Do not run `npm run dev` at the same time as `npm run tauri:dev`; the Tauri development command starts its own Vite process and the Rust host starts the local API.

## Project map

| Area | Location | Responsibility |
|---|---|---|
| Main React application | `src/App.jsx` | App shell, navigation, chat and top-level state |
| 3D character | `src/CharacterStage.jsx` | Three.js scene, avatar, gestures and equipment attachment |
| Chat rendering | `src/MarkdownMessage.jsx` | Message formatting and Markdown display |
| Memory UI | `src/MemoryPanel.jsx` | Local memory workflows |
| Settings UI | `src/SettingsPanel.jsx` | Provider and app configuration |
| Frontend API client | `src/api.js` | Requests to the local Node API |
| Speech playback | `src/speechAudioController.js`, `src/speechPlaybackQueue.js` | Voice output and playback queue |
| Local API | `server/index.js` | HTTP routes, provider calls, sessions and application data |
| Memory backend | `server/memory*.js` | Memory storage, import/organisation and tools |
| Shared character actions | `shared/characterActions.js`, `shared/characterAnimation.js` | Action names and shared animation data |
| Native desktop host | `src-tauri/` | Tauri window, Node process lifecycle and Windows bundling |
| Static character assets | `public/` | Images, GLB models and textures |

## Checks before opening a pull request

Run the full automated suite:

```powershell
npm run test:all
```

Run the production frontend build when a change affects React, styling, assets, Vite configuration or build output:

```powershell
npm run build
```

For the full release check, run:

```powershell
npm run verify:release
```

The project also has focused test commands:

```powershell
npm run test:memory
npm run test:desktop
npm run test:assets
npm run test:voice
npm run check:build-chunks
```

When changing the Windows desktop host or resource packaging, test the Tauri path as well:

```powershell
npm run tauri:dev
npm run tauri:build:windows
```

A frontend browser run does not verify the packaged Tauri application. Report clearly which checks you ran and which you could not run.

## Implementation guidelines

- Keep the frontend in the existing React/JavaScript structure. Do not introduce a second framework for a small feature.
- Keep provider credentials in the local backend. Do not expose secrets in frontend requests, source files or logs.
- Keep the local API bound to loopback. Do not turn it into a public network service without a separate security design.
- Reuse the shared character-action registry rather than adding conflicting gesture names in multiple places.
- Preserve keyboard, pointer and resizing behaviour when changing the layout.
- Keep persistent user data out of the repository. Add only safe example files where examples are needed.
- Update the relevant documentation and tests when changing a command, endpoint, data format or user-visible behaviour.
- Keep `package-lock.json` in sync when changing npm dependencies. Keep `src-tauri/Cargo.lock` in sync when changing Rust dependencies.

## Pull request checklist

- [ ] The change has a clear purpose and does not include unrelated edits.
- [ ] Relevant tests were added or updated.
- [ ] `npm run test:all` passes, or the PR explains why it could not be run.
- [ ] `npm run build` passes when the frontend or asset pipeline changes.
- [ ] Tauri development/build checks were run when the native host or installer changes.
- [ ] Documentation and release notes were updated where needed.
- [ ] No credentials, personal data, local memory files or private logs are included.
- [ ] New third-party assets have documented sources, licence terms and required attribution.

## Licence for contributions

The project's original code is distributed under the GNU General Public License, version 3.0. By submitting a code contribution for inclusion, you agree that the contribution may be distributed as part of this project under GPL-3.0. You remain responsible for having the right to submit the work. Third-party material must retain its own licence and notices; do not relicense someone else's asset as GPL-3.0 merely by adding it to this repository.

There is currently no separate Contributor Licence Agreement (CLA). If that changes, the project will document the new process before requiring it.
