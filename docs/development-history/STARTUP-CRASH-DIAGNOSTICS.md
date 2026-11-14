# Wemmbu Tauri startup crash diagnostics

The user recording shows the Tauri window briefly appearing as a black screen and then disappearing. The Rust host's setup path starts the bundled Node API and aborts launch if its health check fails. In the earlier release, Node stdout/stderr were discarded and the setup error had no user-visible message.

This diagnostic revision:

- writes desktop startup details and child Node stdout/stderr to the app data log;
- checks the exact Tauri resource layout plus two alternate layouts used by earlier bundle outputs;
- logs the resolved API folder and Node executable before launch;
- waits up to 45 seconds for first-run SQLite initialization;
- displays a Windows error dialog if local API startup fails, including the log file path.

Expected log location on Windows:

`%APPDATA%\com.wemmbu.assistant\logs\desktop-startup.log`

After installing and launching this diagnostic build, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\show-startup-log.ps1
```

The script prints the last 200 lines of the log. Send the log if the app still fails.

## Test the currently installed Node runtime without rebuilding

The bundled API can also be tested separately from the Tauri host using:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-installed-api.ps1
```

If automatic install-folder discovery does not find it, pass the installed app directory with `-InstallDir`. The test uses port `18788` and a temporary data folder, not the real app's database. If it reports that the API is ready, stop it with Ctrl+C before launching the app so port 8787 is not affected.

This diagnostic revision does not pretend to know the failure cause before collecting the process output. The log or separate API probe will show whether the issue is a resource path, missing runtime, Node startup exception, SQLite initialization, or port conflict.
