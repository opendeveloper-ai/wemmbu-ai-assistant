# Wemmbu Assistant — Armor Geometry Fit Report

## Scope and source assets

This update is applied to the Latest Wemmbu Assistant source present in the Library archive `wemmbu-assistant-prototype-armor-fit-frontfix.zip`.

The fitting uses the original supplied files in `public/models/`:

- `helmet.glb`
- `chestplate.glb`
- `leggings.glb`
- `boots.glb`
- `high-fidelity_wemmbu_render.glb`

No replacement/procedural armor model is used. The legacy fabricated armor asset is not referenced. The original GLB geometries are loaded at runtime; the geometry is clipped into wearable regions and fitted to the avatar's actual pivot bounds.


## User-requested size adjustments (October 30, 2026)

The first adjustment increased the chestplate and leggings targets to **1.05×**. Following the user's follow-up reference, this second pass increases the overall target-size factor to **1.10×**, which is a further **4.76% increase over the previous version** and 10% over the original unadjusted targets. It applies uniformly to the chestplate torso, both shoulder caps, the leggings waist band, and both leg shells. The helmet and boots remain unchanged at 1.00×.

The implementation continues to use `growFitBounds(bounds, factor)` in `src/CharacterStage.jsx`; the factor is now 1.10 for chestplate and leggings. All fitting remains centre-aligned and the source armor GLBs remain unchanged. The wearable surfaces retain a single least-squares uniform scale per region; no independent X/Y/Z scaling is used. The saved `verification/wemmbu-armor-assembly.glb` was updated to match the new runtime target. Because the leg shells retain the centre-seam clamp, their target X width increases by about 2.59% (rather than 4.76%), their fitted target centres move outward by 0.003544 units per side, and the least-squares uniform scale increases by about 4.56% relative to the previous pass. The waist and torso/shoulder regions use a 1.047619 relative multiplier. New eight-view VTK renders are saved in `verification/size-adjustment/`, and `verification/eight-angle-verification.png` shows the second-pass assembly.

Updated uniform fitting scales and target dimensions are recorded in the transform table below.

## Geometry and orientation method

1. Update the original GLB scene world matrices and bake each source mesh's world transform into temporary working geometry.
2. Build connected triangle components by quantized world-space edge identity. This selects the largest real wearable surface component intersecting each measured source region, while excluding disconnected fragments.
3. Clip complete triangles against the measured source-region planes with polygon clipping and interpolated vertex attributes. Triangle-centroid inclusion tests are not used.
4. Measure the clipped source bounds and the actual avatar pivot bounds.
5. Solve one least-squares **uniform** scale per fitted region and align the measured bounds centres. No independent X/Y/Z scaling is applied.
6. Attach the fitted original surface to the corresponding head, body, arm, leg or waist pivot.

The shell clearance is `0.0078125` avatar units: one eighth of a measured 1/8-head-width skin pixel pitch (`0.5 / 8 / 8`). The head, torso, arm and leg bounds are taken from the character GLB after its rig pivots are rebased.

### Helmet orientation proof

The imported asset root converts the supplied source Z-up coordinates into the avatar's Y-up scene. In those already-converted source coordinates, the main helmet wearable island bounds are `[-65, 0, -14]` to `[-41, 24, 10]`, with measured centre `[-53, 12, -2]`. The face aperture is on the source `+Z` side; the Wemmbu head's face plane is `-Z`.

An A/B front render was made with the same fitted geometry and target bounds:

- `0°` Y yaw leaves the solid rear shell facing the character's face; the avatar face is obscured.
- `180°` Y yaw maps the aperture side to avatar `-Z`; the face features are visible through the opening.

The runtime applies the `180°` yaw about the measured clipped-geometry centre before uniform fitting. This is not a guessed global-origin rotation.

## Calculated fitting transforms

Scale is a dimensionless uniform multiplier applied after the GLB root/world transform and (for the helmet only) its source-centred yaw. Rotation is in degrees around avatar Y. World centres are expressed in the avatar's rest-pose scene coordinates. All non-helmet rotations are zero.

| Wearable region | Uniform scale | Rotation (X,Y,Z) | World-space fitted centre | Target dimensions (X,Y,Z) |
|---|---:|---:|---|---|
| Helmet | 0.02408854 | (0°, 180°, 0°) | (0, 1.750000, 0) | (0.578125, 0.578125, 0.578125) |
| Chestplate torso | 0.02844011 | (0°, 0°, 0°) | (0, 1.125000, 0) | (0.601563, 0.876563, 0.326563) |
| Left shoulder cap | 0.02303232 | (0°, 0°, 0°) | (-0.375000, 1.367188, 0) | (0.326563, 0.343750, 0.326563) |
| Right shoulder cap | 0.02299214 | (0°, 0°, 0°) | (0.375000, 1.367188, 0) | (0.326563, 0.343750, 0.326563) |
| Leggings waist band | 0.02832052 | (0°, 0°, 0°) | (0, 0.817708, 0) | (0.601563, 0.200522, 0.326563) |
| Right leggings | 0.02872611 | (0°, 0°, 0°) | (0.140478, 0.375000, 0) | (0.280957, 0.876563, 0.326563) |
| Left leggings | 0.02872611 | (0°, 0°, 0°) | (-0.140478, 0.375000, 0) | (0.280957, 0.876563, 0.326563) |
| Right boot | 0.02415747 | (0°, 0°, 0°) | (0.133594, 0.199219, 0) | (0.267188, 0.445313, 0.296875) |
| Left boot | 0.02415747 | (0°, 0°, 0°) | (-0.133594, 0.199219, 0) | (0.267188, 0.445313, 0.296875) |

### Uniform-fit dimension residuals

Residual = fitted source size after the uniform scale minus the target box size. Non-zero residuals are the unavoidable aspect-ratio mismatch when preserving each supplied asset's proportions rather than stretching it independently by axis.

| Region | Residual X | Residual Y | Residual Z |
|---|---:|---:|---:|
| Helmet | 0.00000 | 0.00000 | 0.00000 |
| Chestplate torso | +0.02383 | -0.02336 | +0.01472 |
| Left shoulder | -0.02928 | +0.01160 | +0.01348 |
| Right shoulder | -0.02767 | +0.01098 | +0.01290 |
| Leggings waist | -0.00683 | -0.00227 | +0.01328 |
| Each leggings leg | +0.02067 | -0.01478 | +0.01815 |
| Each boot | +0.02270 | -0.01048 | -0.00699 |

The source aspect ratios are not identical to the avatar's pivot boxes. These residuals are retained and reported instead of hiding them with non-uniform deformation. For the second-pass leg targets, the exact inner-edge clamp is applied before the uniform least-squares solve; the 0.003544-unit centre shift is outward on each side. The visual checks below were made from the resulting assembled original-mesh scene.

## Region separation and pivots

- Chestplate torso/shoulder clip planes are X = `-20.99` and X = `1.00` in the transformed source coordinates. Neither plane contains a source triangle wholly coplanar with the seam.
- Leggings are split at X = `27.50`. No source triangle is wholly coplanar with that split plane. The supplied upper waistband island is preserved as a separate fitted region and attached to the waist/root anchor to close the chest-to-leggings gap.
- Left/right leg shells and boots attach to their respective leg pivots; shoulder caps attach to their respective arm pivots; the helmet attaches to the head pivot.
- All source material/UV/vertex attributes are retained through the clip interpolation. Geometry is recalculated after fitting for consistent normals and bounds.

## Visual verification

The original avatar GLB and the original armor GLBs were assembled into `verification/wemmbu-armor-assembly.glb` and rendered from eight views:

1. Straight front
2. Front-left 45°
3. Front-right 45°
4. Left side
5. Right side
6. Back
7. Above head
8. Below feet

The front render shows the face through the helmet aperture. The back view shows the solid rear helmet surface. Side views were checked for profile, shoulder/torso silhouette and boot placement. The two legs are independently split and the original waist band is included. The connected-component pass removes detached stray geometry fragments from the fitted surfaces.

PNG renders are in `verification/` and `verification/size-adjustment/`. These are static offscreen GLTF renders of the assembled scene, not screenshots of the running browser UI. They are geometry/pose checks; VTK does not reproduce every runtime Three.js material and vertex-colour treatment pixel-for-pixel. The most recent eight-view sheet and front/side/back renders include the cumulative +10% chestplate and leggings target adjustment (second pass: +4.76% over the previous 1.05× version). They validate the original GLB assembly and fitting geometry, but do not replace a live Three.js runtime/build verification.

## Preserved features and checks

Runtime fitting changes are isolated to `src/CharacterStage.jsx`; the verification GLB and generated verification PNGs were also refreshed. No other UI/feature source files were changed; existing character actions, chat, voice, memory, settings, theme, equipment, and UI source files remain present. The netherite palette constants and material treatment are retained; the waistband region uses the same leggings palette rules.

Results on the available workspace:

- `npm run test:memory`: **61 passed, 0 failed** after the second size pass (includes gesture, chat/equipment UI regressions and memory tests).
- JSX/TS syntax parse using TypeScript (`tsc --noEmit --allowJs --checkJs false --jsx preserve --noResolve --typeRoots /tmp/empty-types --target ES2022 --module ESNext --skipLibCheck src/*.jsx`): **passed** after the second size pass.
- `node --check` across project `.js` files: **passed**.
- Verification assembly GLB re-import: **passed**; 21 geometry nodes present. Chestplate/leggings node bounds updated; helmet and both boots retain identical vertex arrays and face counts from the 1.05× preview.
- All five requested original GLBs exist under `public/models/`.
- Legacy fabricated-asset reference scan: **clean**.
- `npm run build`: **failed to start** because the Vite executable is absent (`sh: 1: vite: not found`). The installed Node is `v22.16.0`, while `package.json` declares `node >=24.15.0`. No production bundle is claimed.

## Desktop Stage 2.2 source availability

The Library contained the named prototype ZIP and the screenshot, but no separate Desktop Stage 2.2 updated source archive or project tree. This delivery therefore updates only the Latest source found in the named archive. No Desktop ZIP is fabricated, and the Desktop Node.js startup-path fix cannot be revalidated or updated without that source project.
