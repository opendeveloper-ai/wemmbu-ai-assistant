# Wemmbu AI Assistant 0.2.5 — Settings CORS and API diagnostics

## Root cause fixed

The Tauri WebView saves the combined settings payload with `PUT /api/settings` at `http://127.0.0.1:8787`. In 0.2.4, the local API's CORS allow-method list omitted `PUT` (`GET, POST, PATCH, DELETE, OPTIONS`). Chromium therefore rejected the preflight, and the Settings UI surfaced a generic `Failed to fetch` for key saves and other settings changes. This affected OpenRouter, Fish Audio, Google AI Studio, and settings regardless of the selected speech provider. It was not proof that a provider API key was invalid.

The 0.2.5 server uses a shared, tested local CORS policy that explicitly allows `PUT`, while accepting only Tauri and loopback origins. It also acknowledges WebView2 Private Network Access preflight when requested by an already-allowed origin.

## Logging added

Node API stdout/stderr is already redirected by the Tauri Rust host to:

`%APPDATA%\com.wemmbu.assistant\logs\desktop-startup.log`

The API now logs:
- API startup configuration (port, runtime version, data directory, whether provider keys are configured).
- Each local HTTP request's method, path, origin, status, and duration.
- CORS origin/method rejections.
- Settings updates using boolean key-presence/configured flags only.
- OpenRouter connection, streaming, response status, duration, and network error name/code.
- Fish Audio request metadata, response status/content type, duration, and network error name/code.

Never log request bodies, API key values, Authorization headers, voice IDs, or speech text. Integration tests use dummy keys and assert they do not appear in captured logs.

## View logs

From the extracted project folder in PowerShell:

```powershell
.\scripts\show-startup-log.ps1
```

Follow the log live while using the app:

```powershell
.\scripts\show-startup-log.ps1 -Follow
```

Or use the direct Windows path:

```powershell
$log = Join-Path $env:APPDATA 'com.wemmbu.assistant\logs\desktop-startup.log'
Get-Content -LiteralPath $log -Tail 200 -Wait
```

## Useful log signatures

- `http.request.start` with `method: OPTIONS`, `path: /api/settings`, `preflightMethod: PUT` followed by `status: 204`: the settings preflight passed.
- `settings.update.saved` with `openRouterKeyConfigured: true` and/or `fishAudioKeyConfigured: true`: that key was saved (values are never logged).
- `provider.openrouter.response` with a status: the local API reached OpenRouter and received an HTTP response.
- `provider.openrouter.network_error`: local Node could not complete the network request; inspect its `name` and optional `code`.
- `provider.fish_audio.response` with a status: the local API reached Fish Audio and received an HTTP response.
- `provider.fish_audio.http_error` with 401/403: Fish Audio rejected authentication/authorization; check the rotated key and account/voice permissions.
- `provider.fish_audio.network_error`: the local API could not complete the Fish Audio network request.

The HTTP request log never includes query strings or request bodies. Provider error response bodies are not logged.

## Validation

`npm run test:all` passed 81 tests, including an integration test which starts the actual local server, performs an `OPTIONS` preflight for `PUT` from `http://tauri.localhost`, then saves dummy OpenRouter and Fish Audio credentials together and verifies that secret values are absent from the logs.

The Vite production build and Windows NSIS installer were not built in this Linux/offline environment. Build the installer on the user's Windows machine with the command below.
