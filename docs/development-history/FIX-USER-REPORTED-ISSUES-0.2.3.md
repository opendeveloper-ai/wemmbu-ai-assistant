# Wemmbu AI Assistant 0.2.3 — equipment textures, Settings links, chestplate frame alignment

## Changes

### Mace and Totem appearance

- Extracted the images from the actual supplied `mace.glb` and `totem_of_undying.glb` GLB buffer views without re-encoding them.
- Added `public/models/mace-skin.png` (512×512), `totem-basecolor.png` (256×1), and `totem-metalrough.png` (256×1).
- Accessory loading binds those same-origin images directly to the original GLTF materials before the accessory meshes are cloned/fitted.
- Mace texture settings match its GLB sampler (nearest filtering, clamp wrapping); Totem settings match its GLB sampler (linear/mipmap filtering, repeat wrapping). The base-colour maps use sRGB; the metallic/roughness map remains linear data.
- The GLB geometry and original material properties (including mace alpha-mask settings) remain in use.

### Settings hyperlinks

- Replaced reliance on WebView2 `target="_blank"` behavior with Tauri's official Opener plugin.
- Registered `tauri-plugin-opener` 2.7.2 and enabled its global JavaScript API.
- Added a main-window capability granting `opener:allow-default-urls`; the Settings helper additionally rejects non-HTTPS destinations.
- All four Settings links open with the OS default browser in the packaged desktop app. Browser development falls back to `window.open`.

### Chestplate fit orientation

- The supplied chestplate GLB has an X-axis -90° root quaternion that converts its source Z-up coordinates into the avatar's Y-up coordinate frame. GLTFLoader's world matrix is baked into each triangle before fitting.
- A weighted front-surface normal analysis of the supplied torso region yields an average normal approximately `(8.9e-10, -6.66e-6, -1.0)`, aligned to the Wemmbu torso front `(0, 0, -1)`.
- The fitting routine now measures that normal from the selected/clipped torso triangles and aligns it to the avatar torso frame around the measured mesh centre before scale and position fitting. It does not apply an arbitrary hand-entered rotation.
- The measured residual on the original source is below 0.001°. The calibration therefore removes only tiny residual exporter tilt; if a larger apparent slant persists in a particular pose, it is likely due to the avatar/camera pose or another pivot relationship, and should be diagnosed from a fresh application screenshot rather than guessed.

## Build and verification

- `npm run test:all`: 74 tests passed (61 memory/application, 4 desktop API, 9 asset and desktop integration regression tests).
- Added tests verify all three extracted accessory PNGs are byte-identical to the matching image buffer views in the original GLBs.
- Added regression tests verify the four Settings links route through the Tauri opener, the opener capability is registered, and the chestplate geometry calibration remains in the fit path.
- `scripts/verify-dist-character-assets.mjs` now checks the three accessory texture PNGs are copied to `dist/models` alongside all supplied GLBs.
- A production Vite build, Rust compile, and NSIS installer build were not run in this Linux container: Vite/node_modules and Rust/Cargo are not installed here. Build the installer on the Windows x64 PC with the commands below.

## Windows build

From `wemmbu-assistant-prototype` in PowerShell:

```powershell
npm ci
npm run test:all
npm run tauri:build:windows
```

The new installer is emitted under `src-tauri\target\release\bundle\nsis\`.

Keep `%APPDATA%\com.wemmbu.assistant` during upgrade so existing memories and settings remain available.
