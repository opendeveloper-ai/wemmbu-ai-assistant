# Wemmbu Tauri diagnostic startup revision

- Confirmed from supplied screen recording: the desktop window opens black and then disappears.
- Root cause is not yet proven from the video alone.
- Current source shows a fatal Tauri setup path when the managed Node API fails its HTTP health check; Node stdout/stderr were previously discarded in release mode.
- Updated Rust host writes startup diagnostics to `%APPDATA%\com.wemmbu.assistant\logs\desktop-startup.log`, preserves Node stdout/stderr, verifies resource path candidates, waits 45 seconds for first-run initialization, and shows a Windows startup error dialog.
- Added PowerShell scripts to display the startup log and run the installed bundled Node API independently on port 18788 with temporary data.
- `npm run test:memory`: 61 tests passed.
- `npm run test:desktop`: 4 tests passed.
- Tauri config JSON parses.
- Rust/Windows NSIS build was not run in this Linux environment. Rebuild on the Windows x64/MSVC runner before installing this diagnostic revision.
