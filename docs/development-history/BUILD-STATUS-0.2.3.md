# Build status — Wemmbu AI Assistant 0.2.3

This source update addresses the three issues shown in the user's latest screenshots:

1. Explicitly loads the original mace and Totem texture images from same-origin PNG resources.
2. Opens all four Settings hyperlinks through the Tauri Opener plugin and the Windows default browser, with HTTPS-only link validation.
3. Adds measured front-normal alignment of the chestplate torso mesh to the avatar torso frame before fitting.

## Tests

`npm run test:all` completed successfully:

- Memory/application: 61 passed.
- Desktop API: 4 passed.
- Asset/desktop integration: 9 passed.
- Total: 74 passed, 0 failed.

Original GLB embedded-image integrity checks passed for the mace base-colour image and both Totem maps.

## Not run in this environment

- Vite production build.
- Rust/Tauri compilation.
- NSIS setup executable generation.
- Visual confirmation in Windows WebView2 after installation.

This is a source package, not a prebuilt Windows installer. Build on Windows x64 with Node.js 24.15+ and Rust/MSVC installed:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

The output NSIS installer is in `src-tauri\target\release\bundle\nsis\`.
