# Wemmbu AI Assistant 0.2.2 — character texture packaging update

## Reported symptom
The packaged Tauri app opened and displayed the character's block geometry, but the character appeared plain white/grey with no Wemmbu purple skin texture.

## Diagnosis and implementation
The provided original avatar GLB contains a 64×64 PNG skin atlas embedded in its binary chunk. The viewer previously relied exclusively on GLTFLoader's embedded image/Blob URL texture path. To make packaged WebView2 loading more robust, this update extracts that exact image into `public/models/wemmbu-skin.png` and loads it through a same-origin URL using `THREE.TextureLoader`.

Before exposing the avatar rig, the viewer assigns this texture to every avatar material with sRGB color space, glTF-compatible `flipY=false`, nearest-neighbour filters, mipmaps disabled, and an alpha-test threshold of 0.05. The original GLB model and its geometry remain unchanged. A visible error is shown if the model or the external atlas cannot load.

Vite's production build now runs `scripts/verify-dist-character-assets.mjs` after `vite build`. This verifies the original Wemmbu GLB, skin PNG, four original armor GLBs, mace and totem are all present in `dist/models` before Tauri bundling.

## Automated verification performed
- 61 application/memory regression tests passed.
- 4 desktop API routing tests passed.
- 3 avatar texture/asset packaging tests passed.
- Embedded PNG byte comparison passed: `public/models/wemmbu-skin.png` is byte-identical to the 302-byte image extracted from the source GLB.
- Package, package-lock and Tauri versions are synchronized at 0.2.2.
- `node --check` passed for the API and resource preparation scripts.

## Not verified here
- Vite production build was not run because this environment has no installed `node_modules` and uses Node.js 22.16, whereas the project requires Node.js 24.15 or newer.
- Windows Rust/MSVC/NSIS build was not run in this Linux environment.
- Actual WebView2 visual appearance must be confirmed by building and installing 0.2.2 on the user's Windows PC.

## Windows rebuild
Open PowerShell in the extracted `wemmbu-assistant-prototype` directory on Windows x64 with Node.js 24.15+, Rust stable/MSVC and NSIS available:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

The resulting NSIS installer is under `src-tauri\target\release\bundle\nsis\`. Install 0.2.2 over the previous 0.2.1 build. Preserve `%APPDATA%\com.wemmbu.assistant` so saved memories/settings remain intact.
