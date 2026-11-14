# Wemmbu AI Assistant 0.2.2 — packaged avatar texture fix

## Symptom
The Tauri application window and 3D avatar geometry appeared, but the character rendered as a plain white/grey mannequin rather than the purple Wemmbu skin.

## Change
- Preserve and load the original `high-fidelity_wemmbu_render.glb` model without replacing or regenerating its geometry.
- Extract the 64×64 PNG atlas byte-for-byte from that supplied GLB into `public/models/wemmbu-skin.png`.
- Load the atlas through a normal same-origin URL using Three.js `TextureLoader`, rather than depending only on the embedded GLB image's Blob URL path in the packaged WebView2 environment.
- Assign the texture to every avatar mesh material before the rig is added to the visible scene.
- Set sRGB color space, glTF-compatible `flipY=false`, nearest-neighbour filtering, no mipmaps, and alpha test 0.05 to retain the pixel-art and transparent outer skin layer.
- Show a visible stage error if the model or external skin atlas cannot be loaded.
- Bump package/Tauri version to 0.2.2.

## Integrity
`server/avatarAsset.test.js` verifies that `public/models/wemmbu-skin.png` is byte-identical to the PNG image stored in the original GLB, and that the runtime stage loads and applies the same-origin atlas.

## Tests run in this environment
- 61 application/memory tests: passed.
- 4 desktop API routing tests: passed.
- 2 avatar asset integrity/runtime-wiring tests: passed.
- GLB embedded texture extraction and PNG signature: passed.
- Windows MSVC/Tauri installer build: not run in this Linux environment.
- Packaged WebView2 visual confirmation: still requires installing the newly built 0.2.2 installer on Windows.

## Rebuild
On Windows x64 with Node.js 24.15+ and the Rust MSVC toolchain:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

Install the new `0.2.2` NSIS setup executable. The existing app data folder `%APPDATA%\com.wemmbu.assistant` is not part of the source update and should be preserved when upgrading.
