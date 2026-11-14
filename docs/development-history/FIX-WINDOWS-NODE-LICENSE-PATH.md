# Windows Node.js LICENSE path fix

The error occurred because the previous staging script expected `LICENSE` at `D:\\node.js\\LICENSE`. That path is not guaranteed to exist even when Node itself is correctly installed.

## What changed

`scripts/prepare-tauri-resources.mjs` now:

1. Uses the active Node executable (`process.execPath`) and resolves its real path.
2. Looks for the license in the active executable directory, common parent paths, `NODE_HOME`, and `NVM_SYMLINK`.
3. Supports an explicit `NODE_LICENSE_FILE` override.
4. Continues resource staging if the runtime is valid but the complete license bundle cannot be found, writing an explicit `NODE-LICENSE.txt` notice instead of throwing `ENOENT`.

## Rebuild

Extract this updated source archive over a clean folder, then run in PowerShell:

```powershell
npm run tauri:build:windows
```

For a release build, include the full license bundle from the matching official Node.js Windows x64 distribution:

```powershell
$env:NODE_LICENSE_FILE = 'C:\path\to\node-v24.15.0-win-x64\LICENSE'
npm run tauri:build:windows
```

The fallback notice prevents staging from failing, but it is not a substitute for the complete upstream license bundle in a public release.

## Verification performed

- `node --check scripts/prepare-tauri-resources.mjs`: passed.
- `npm run tauri:prepare`: passed.
- Simulated Windows staging with an executable that had no adjacent `LICENSE`: passed and emitted the intended warning/notice.
- `npm run test:memory`: 61 passed.
- `npm run test:desktop`: 4 passed.
- Actual Windows NSIS compilation was not run in this Linux environment.
