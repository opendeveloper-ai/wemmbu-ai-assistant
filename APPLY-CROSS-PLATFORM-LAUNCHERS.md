# Apply the cross-platform development launchers

Extract the patch ZIP into the root of your existing `wemmbu-ai-assistant` Git clone and allow the listed files to be replaced. Do not extract over or replace the `.git` directory.

The patch adds `start.sh` for Linux, `start.command` for macOS, and a shared Node.js startup routine used by all three launchers. It also updates `start.bat`, `package.json`, `.gitattributes`, the root README and installation/testing documentation.

## Important when committing from Windows

Windows checkouts do not always preserve Unix executable permissions. After copying the patch into your Git clone, run:

```powershell
git add -A
git update-index --chmod=+x start.sh start.command
git status
```

Then commit and push normally. `.gitattributes` ensures the shell launchers keep LF line endings even when edited or committed on Windows.

## Launch commands for users

- Windows: double-click `start.bat`.
- Linux: `chmod +x ./start.sh`, then `./start.sh` (or `bash ./start.sh`).
- macOS: `chmod +x ./start.command`, then `./start.command`, or double-click `start.command` in Finder. `bash ./start.command` also works from Terminal.

All launchers require Node.js 24.15.0 or newer and npm. See `docs/INSTALLATION.md` for complete instructions.
