# Architecture overview

## Runtime components

```text
React UI (src/)
   |
   | HTTP requests to loopback API
   v
Node.js API (server/index.js)
   |                 |
   |                 +--> OpenRouter / Fish Audio / Google AI Studio
   |
   +--> Local settings and chat sessions
   |
   +--> SQLite-backed memory (server/memory*.js)

Three.js character stage (src/CharacterStage.jsx)
   |
   +--> GLB avatar, skin, armour and held-item assets (public/models)

Tauri 2 desktop host (src-tauri/)
   |
   +--> WebView2 frontend
   +--> Bundled Node runtime and local API process
   +--> OS application-data directory
```

## Frontend

- React 18 components provide the navigation, chat, history, settings, memory, and action surfaces.
- Vite builds and code-splits the frontend.
- Three.js and `GLTFLoader` render the avatar and imported equipment models.
- `src/api.js` centralises calls to the local API.
- Speech queue and playback behaviour live in `src/speechPlaybackQueue.js`, `src/speechAudioController.js`, and related modules.

## Local API

- `server/index.js` exposes the loopback HTTP API.
- Settings endpoints save provider credentials locally and return only safe status information.
- Chat requests are sent server-side to OpenRouter.
- Fish Audio TTS is called by the local backend; provider credentials are not placed in browser requests.
- Memory operations are implemented in the `server/memory*.js` modules and use SQLite with migration/backup support.

## Character actions

`shared/characterActions.js` defines the action registry shared by the UI, local command parsing, and AI tool schema. `src/CharacterStage.jsx` maps action states to measured character pivot animations and equipment attachments.

## Desktop host

Tauri 2 launches the frontend in WebView2 and manages the local Node process. The native host starts the API, waits for its health endpoint, stores persistent data in OS app data, and shuts down the child process when the app exits.

## Boundaries

- The local API is not intended to be exposed as a remote multi-user server.
- AI chat, TTS, and image-generation requests send relevant user content to the selected provider.
- Local memory and saved API credentials remain on the device unless the user exports or otherwise shares them.
