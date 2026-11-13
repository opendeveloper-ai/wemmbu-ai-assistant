# Wemmbu Tauri startup fix — Windows Node entry-point path

## Root cause from the supplied startup log

The bundled Node process did start, but it exited before loading `server/index.js`. Node 24.17 reported:

```text
Error: EISDIR: illegal operation on a directory, lstat 'D:'
    at Object.realpathSync (node:fs:2745:25)
    at Module._findPath (node:internal/modules/cjs/loader:803:22)
    at resolveMainPath (node:internal/modules/run_main:35:13)
```

The log shows Tauri was passing resource paths in Windows extended-length form (`\\?\D:\...`) from an installation directory containing spaces. Node failed while resolving its absolute main-script path, before any Wemmbu API code ran. This is not a SQLite or frontend/Vite failure.

## Fix in this source

- Strip the Windows `\\?\` prefix for paths passed to the child process. UNC paths are converted from `\\?\UNC\server\share` to `\\server\share`.
- Set Node's working directory to the normalized API resource directory.
- Pass `server/index.js` as a short relative script argument rather than passing the absolute resource path.
- Normalize the app-data and runtime executable paths before passing them to Node/Windows process APIs.
- Log the normalized executable, working directory, and script argument separately.
- Bump the app version to 0.2.1 so the rebuilt installer is distinguishable from the failing 0.2.0 installation.

## Rebuild on Windows

From `wemmbu-assistant-prototype` in PowerShell:

```powershell
npm ci
npm run test:memory
npm run test:desktop
npm run tauri:build:windows
```

Install the newly generated `0.2.1` setup executable. The output should be under:

```text
src-tauri\target\release\bundle\nsis\
```

## Expected startup log after the fix

The relevant lines should look like this (drive letter/install path will vary):

```text
Node working directory: D:\Wemmbu AI Assistant\resources\app
Node script argument: server\index.js
Launching Node executable: D:\Wemmbu AI Assistant\resources\runtime\node.exe
Node process spawned with PID ...
Local API health check passed (HTTP 200).
```

This source patch is prepared, but it has not been compiled with the Windows MSVC toolchain in this environment. Verify the new installer on the target Windows PC before distributing it.
