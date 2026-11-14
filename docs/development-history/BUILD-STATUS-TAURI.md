# Tauri Windows installer build status — 0.2.1 startup-path fix

## Confirmed runtime failure from user's log

Node 24.17 was spawned successfully but exited before loading the API entry point. Its Windows CommonJS resolver reported `EISDIR: illegal operation on a directory, lstat 'D:'` while resolving the absolute script path supplied in extended-length form (`\\?\D:\...`). The embedded API code had not started.

## Fix included

- Normalize extended-length Windows paths before using them with the child process.
- Use the normalized API directory as the Node working directory.
- Pass `server/index.js` as a relative argument to Node, avoiding the extended absolute script path and spaces in the argument.
- Normalize runtime and data paths.
- Add path-specific startup log lines.
- Bump all app package versions to 0.2.1.

## Rebuild command

```powershell
npm ci
npm run test:memory
npm run test:desktop
npm run tauri:build:windows
```

## Verification scope

The Rust patch was reviewed against the actual supplied `main.rs` and the Node stack trace. This environment does not have Rust/Cargo or the Windows MSVC toolchain, so Windows compilation and NSIS generation have not been run here. The rebuilt 0.2.1 installer must be tested on Windows and its log should contain `Node script argument: server\index.js` followed by `Local API health check passed (HTTP 200)`.
