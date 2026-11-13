import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { dampHeadRotation } from '../shared/characterAnimation.js';

const PUBLIC_BASE_URL = import.meta.env.BASE_URL;
const MODEL_URL = `${PUBLIC_BASE_URL}models/high-fidelity_wemmbu_render.glb`;
// Load the skin atlas as a regular same-origin PNG as well as retaining the GLB's
// embedded copy. WebView2 can decode same-origin image URLs more reliably than
// Blob-backed GLTF texture URLs in some packaged Tauri configurations.
const AVATAR_SKIN_URL = `${PUBLIC_BASE_URL}models/wemmbu-skin.png`;
const ARMOR_HELMET_URL = `${PUBLIC_BASE_URL}models/helmet.glb`;
const ARMOR_CHESTPLATE_URL = `${PUBLIC_BASE_URL}models/chestplate.glb`;
const ARMOR_LEGGINGS_URL = `${PUBLIC_BASE_URL}models/leggings.glb`;
const ARMOR_BOOTS_URL = `${PUBLIC_BASE_URL}models/boots.glb`;
const MACE_MODEL_URL = `${PUBLIC_BASE_URL}models/mace.glb`;
const TOTEM_MODEL_URL = `${PUBLIC_BASE_URL}models/totem_of_undying.glb`;
const MACE_TEXTURE_URL = `${PUBLIC_BASE_URL}models/mace-skin.png`;
const TOTEM_BASECOLOR_URL = `${PUBLIC_BASE_URL}models/totem-basecolor.png`;
const TOTEM_METALROUGH_URL = `${PUBLIC_BASE_URL}models/totem-metalrough.png`;

function addStatus(mount, text, isError = false) {
  const node = document.createElement('div');
  node.className = `character-model-status${isError ? ' error' : ''}`;
  node.textContent = text;
  node.setAttribute('role', isError ? 'alert' : 'status');
  mount.appendChild(node);
  return node;
}

function disposeLoadedModel(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.filter(Boolean).forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
    });
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}

/**
 * Build a reliable pose rig from the supplied GLB's actual mesh groups. The GLB has
 * baked model-space vertex coordinates and identity transforms on its named part groups;
 * directly rotating those original groups moves the pivots but not the vertices. Instead,
 * bake each source mesh's world transform into a clone, rebase the clone around its true
 * joint, and place it under a new pivot group. This keeps the rest pose unchanged while
 * giving arms, legs and head real local pivots for animation and equipment.
 */

/**
 * WebView2 can render GLB geometry while failing to display its embedded PNG maps.
 * Load the byte-identical images extracted from the supplied accessory GLBs as
 * same-origin assets, then bind them explicitly to the original GLTF materials.
 */
async function applyAccessoryTextures(scene, displayName) {
  const isMace = displayName === 'Minecraft mace';
  const isTotem = displayName === 'Totem of Undying';
  if (!isMace && !isTotem) return;

  const textureLoader = new THREE.TextureLoader();
  const colorUrl = isMace ? MACE_TEXTURE_URL : TOTEM_BASECOLOR_URL;
  const colorMap = await textureLoader.loadAsync(colorUrl);
  let metalRoughMap = null;
  try {
    if (isTotem) metalRoughMap = await textureLoader.loadAsync(TOTEM_METALROUGH_URL);
  } catch (error) {
    colorMap.dispose();
    throw error;
  }

  const configureTexture = (texture, colorTexture) => {
    texture.flipY = false; // glTF UV/image convention; matches the embedded source.
    texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.channel = 0;
    texture.generateMipmaps = isTotem;
    texture.wrapS = isTotem ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = isTotem ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.magFilter = isTotem ? THREE.LinearFilter : THREE.NearestFilter;
    texture.minFilter = isTotem ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
    texture.needsUpdate = true;
  };
  configureTexture(colorMap, true);
  if (metalRoughMap) configureTexture(metalRoughMap, false);

  const materials = new Set();
  const replacedTextures = new Set();
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.filter(Boolean).forEach((material) => materials.add(material));
  });

  materials.forEach((material) => {
    for (const key of ['map', 'roughnessMap', 'metalnessMap']) {
      const current = material[key];
      if (current?.isTexture && current !== colorMap && current !== metalRoughMap) replacedTextures.add(current);
    }
    material.map = colorMap;
    if (isTotem) {
      material.roughnessMap = metalRoughMap;
      material.metalnessMap = metalRoughMap;
    }
    material.color?.set(0xffffff);
    material.needsUpdate = true;
  });

  if (materials.size === 0) {
    colorMap.dispose();
    metalRoughMap?.dispose();
    throw new Error(`${displayName} GLB contains no materials to receive its extracted texture.`);
  }
  replacedTextures.forEach((texture) => texture.dispose());
  console.info(`[CharacterStage] Applied extracted ${displayName} textures to ${materials.size} original GLTF materials.`, { colorUrl, hasMetalRoughMap: Boolean(metalRoughMap) });
}

function disposeSourceGeometryOnly(root) {
  root.traverse((object) => {
    if (object.isMesh && object.geometry) object.geometry.dispose();
  });
}

function buildRigPart(sourceRoot, candidates, pivotPosition, rigRoot, label) {
  const sourcePart = findNamedNode(sourceRoot, candidates);
  if (!sourcePart) throw new Error(`The Wemmbu model is missing the ${label} mesh group (${candidates.join(', ')}).`);

  const pivot = new THREE.Group();
  pivot.name = `wemmbu-pivot-${label}`;
  pivot.position.copy(pivotPosition);
  let meshCount = 0;

  sourcePart.traverse((sourceMesh) => {
    if (!sourceMesh.isMesh || !sourceMesh.geometry?.attributes?.position) return;
    const geometry = sourceMesh.geometry.clone();
    // Source mesh vertices are model-space values; bake any GLB node transforms first.
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      position.setXYZ(
        index,
        position.getX(index) - pivotPosition.x,
        position.getY(index) - pivotPosition.y,
        position.getZ(index) - pivotPosition.z,
      );
    }
    position.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const materials = Array.isArray(sourceMesh.material) ? sourceMesh.material : [sourceMesh.material];
    materials.filter(Boolean).forEach((material) => {
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      material.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(geometry, sourceMesh.material);
    mesh.name = `${label}-${sourceMesh.name || `mesh-${meshCount}`}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = sourceMesh.renderOrder;
    pivot.add(mesh);
    meshCount += 1;
  });

  if (meshCount === 0) throw new Error(`The Wemmbu model's ${label} group contains no usable meshes.`);
  rigRoot.add(pivot);
  return pivot;
}

function applyAvatarSkinTexture(rigRoot, skinTexture) {
  skinTexture.colorSpace = THREE.SRGBColorSpace;
  // glTF UVs are authored in glTF's convention; do not apply the default HTML-image flip.
  skinTexture.flipY = false;
  skinTexture.magFilter = THREE.NearestFilter;
  skinTexture.minFilter = THREE.NearestFilter;
  skinTexture.generateMipmaps = false;
  skinTexture.needsUpdate = true;

  const materials = new Set();
  const replacedTextures = new Set();
  rigRoot.traverse((object) => {
    if (!object.isMesh) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.filter(Boolean).forEach((material) => materials.add(material));
  });

  for (const material of materials) {
    if (material.map && material.map !== skinTexture) replacedTextures.add(material.map);
    material.map = skinTexture;
    material.color?.set(0xffffff);
    // Preserve the source Minecraft skin's transparent pixels/outer hat layer.
    material.alphaTest = Math.max(Number(material.alphaTest) || 0, 0.05);
    material.transparent = false;
    material.depthWrite = true;
    material.needsUpdate = true;
  }
  replacedTextures.forEach((texture) => texture.dispose());

  if (materials.size === 0) {
    throw new Error('The Wemmbu GLB has no mesh materials to receive its skin texture.');
  }
  console.info(`[CharacterStage] Applied external Wemmbu skin texture ${AVATAR_SKIN_URL} to ${materials.size} avatar materials.`);
  return materials.size;
}

function buildAvatarRig(sourceScene) {
  sourceScene.updateMatrixWorld(true);
  const rigRoot = new THREE.Group();
  rigRoot.name = 'wemmbu-rig-root';
  const anchors = {
    // The root serves as a subtle whole-avatar breathing pivot and the waist/leggings anchor.
    waist: rigRoot,
    head: buildRigPart(sourceScene, ['Head_2', 'Head'], new THREE.Vector3(0, 1.5, 0), rigRoot, 'head'),
    body: buildRigPart(sourceScene, ['Body_5', 'Body', 'Torso'], new THREE.Vector3(0, 1.125, 0), rigRoot, 'body'),
    rightArm: buildRigPart(sourceScene, ['Right Arm_8', 'Right Arm', 'RightArm', 'Arm_R'], new THREE.Vector3(0.375, 1.5, 0), rigRoot, 'right-arm'),
    leftArm: buildRigPart(sourceScene, ['Left Arm_11', 'Left Arm', 'LeftArm', 'Arm_L'], new THREE.Vector3(-0.375, 1.5, 0), rigRoot, 'left-arm'),
    rightLeg: buildRigPart(sourceScene, ['Right Leg_15', 'Right Leg', 'RightLeg', 'Leg_R'], new THREE.Vector3(0.125, 0.75, 0), rigRoot, 'right-leg'),
    leftLeg: buildRigPart(sourceScene, ['Left Leg_18', 'Left Leg', 'LeftLeg', 'Leg_L'], new THREE.Vector3(-0.125, 0.75, 0), rigRoot, 'left-leg'),
  };
  anchors.root = rigRoot;
  // The new rig uses cloned geometries, so source geometry can be released while its
  // materials/textures remain shared with the visible clone meshes.
  disposeSourceGeometryOnly(sourceScene);
  return { rigRoot, anchors };
}

function normalizeNodeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Resolve Blender/Sketchfab node names robustly; exporters may change spaces or suffixes. */
function findNamedNode(root, candidateNames) {
  for (const name of candidateNames) {
    const exact = root.getObjectByName(name);
    if (exact) return exact;
  }
  const candidates = new Set(candidateNames.map(normalizeNodeName));
  let match = null;
  root.traverse((object) => {
    if (match || !object.name) return;
    if (candidates.has(normalizeNodeName(object.name))) match = object;
  });
  return match;
}

/**
 * The supplied Wemmbu head is a pixel-textured cube with no facial rig. Keep the
 * original GLB and its exact skin atlas, but give the head's base mesh a private
 * canvas copy so the existing mouth pixels can be opened during speech. The front
 * face of this GLB uses atlas pixels x=8..15, y=8..15; the closed-mouth pixels are
 * in rows 12..14. Only this head mesh gets the animated copy, so other body parts
 * and the hat layer continue using their original material/texture.
 */
function attachMouthTextureController(headPivot) {
  if (!headPivot) return null;
  let faceMesh = null;
  headPivot.traverse((object) => {
    if (!faceMesh && object.isMesh && object.name === 'head-Object_6') faceMesh = object;
  });
  if (!faceMesh) {
    console.warn('[CharacterStage] Could not locate the base head mesh for texture-driven mouth animation.');
    return null;
  }

  const materialList = Array.isArray(faceMesh.material) ? faceMesh.material : [faceMesh.material];
  const sourceMaterial = materialList.find((material) => material?.map?.image);
  if (!sourceMaterial) {
    console.warn('[CharacterStage] The head mesh has no loaded skin texture; mouth animation is unavailable.');
    return null;
  }

  const sourceTexture = sourceMaterial.map;
  const image = sourceTexture.image;
  const width = image.naturalWidth || image.videoWidth || image.width;
  const height = image.naturalHeight || image.videoHeight || image.height;
  if (!width || !height || width < 16 || height < 16) {
    console.warn('[CharacterStage] The head skin texture has unexpected dimensions; mouth animation is unavailable.');
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);

  const mouthRegion = { x: 8, y: 12, width: 8, height: 4 };
  const originalMouthPixels = context.getImageData(mouthRegion.x, mouthRegion.y, mouthRegion.width, mouthRegion.height);
  const getCssColor = (x, y) => {
    const pixel = context.getImageData(x, y, 1, 1).data;
    return `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})`;
  };
  // Sample the face's actual skin and existing dark mouth palette instead of guessing colors.
  const skinColor = getCssColor(9, 11);
  const lipColor = getCssColor(8, 8);
  const cavityColor = getCssColor(8, 12);

  const animatedTexture = new THREE.CanvasTexture(canvas);
  animatedTexture.name = 'wemmbu-runtime-speaking-mouth-texture';
  animatedTexture.colorSpace = sourceTexture.colorSpace;
  animatedTexture.flipY = sourceTexture.flipY;
  animatedTexture.wrapS = sourceTexture.wrapS;
  animatedTexture.wrapT = sourceTexture.wrapT;
  animatedTexture.magFilter = sourceTexture.magFilter;
  animatedTexture.minFilter = sourceTexture.minFilter;
  animatedTexture.generateMipmaps = sourceTexture.generateMipmaps;
  animatedTexture.anisotropy = sourceTexture.anisotropy;
  animatedTexture.offset.copy(sourceTexture.offset);
  animatedTexture.repeat.copy(sourceTexture.repeat);
  animatedTexture.center.copy(sourceTexture.center);
  animatedTexture.rotation = sourceTexture.rotation;
  animatedTexture.matrixAutoUpdate = sourceTexture.matrixAutoUpdate;

  const animatedMaterial = sourceMaterial.clone();
  animatedMaterial.map = animatedTexture;
  animatedMaterial.needsUpdate = true;
  faceMesh.material = Array.isArray(faceMesh.material)
    ? materialList.map((material) => material === sourceMaterial ? animatedMaterial : material)
    : animatedMaterial;

  let lastShape = -1;
  const setOpening = (rawAmount) => {
    const amount = THREE.MathUtils.clamp(Number(rawAmount) || 0, 0, 1);
    // Discrete pixel-art mouth shapes keep the source character's Minecraft aesthetic.
    const shape = amount < 0.16 ? 0 : amount < 0.38 ? 1 : amount < 0.67 ? 2 : 3;
    if (shape === lastShape) return;
    lastShape = shape;

    context.putImageData(originalMouthPixels, mouthRegion.x, mouthRegion.y);
    if (shape > 0) {
      // Remove the source smile only while talking, restoring it exactly while silent.
      context.fillStyle = skinColor;
      context.fillRect(mouthRegion.x, mouthRegion.y, mouthRegion.width, mouthRegion.height);

      const opening = shape === 1
        ? { x: 11, y: 13, width: 2, height: 1 }
        : shape === 2
          ? { x: 10, y: 12, width: 4, height: 2 }
          : { x: 10, y: 12, width: 4, height: 3 };
      context.fillStyle = lipColor;
      context.fillRect(opening.x, opening.y, opening.width, opening.height);
      if (opening.width > 2 && opening.height > 1) {
        context.fillStyle = cavityColor;
        context.fillRect(opening.x + 1, opening.y, opening.width - 2, opening.height);
      }
    }
    animatedTexture.needsUpdate = true;
  };

  console.info('[CharacterStage] Attached a texture-driven mouth controller to the existing Wemmbu head mesh.');
  setOpening(0);
  return { setOpening };
}

/**
 * Always returns a valid Object3D attachment target. If a custom/re-exported GLB omits a named
 * pivot, create a safe fallback at the avatar's normalized joint position instead of crashing
 * with "Cannot read properties of undefined (reading 'add')".
 */
function ensurePivot(root, candidateNames, label, fallbackPosition) {
  const existing = findNamedNode(root, candidateNames);
  if (existing && typeof existing.add === 'function') return existing;
  const fallback = new THREE.Group();
  fallback.name = `runtime-fallback-pivot-${label}`;
  fallback.position.copy(fallbackPosition);
  root.add(fallback);
  console.warn(`[CharacterStage] No named GLB pivot found for ${label}; using a fallback attachment pivot.`);
  return fallback;
}

/**
 * Normalize an accessory after baking its source-node transforms and axis correction into its
 * geometry. Baking the orientation before measuring is important: some GLBs have their long
 * axis in Z while the avatar is Y-up, so using an unrotated height can accidentally scale a
 * sideways totem to almost twice the character's width. The origin is the grip end at Y=0.
 */
function inferAccessoryLongAxis(scene, orientationMatrix, directionHint = [1, 1, 0]) {
  // Use the loaded GLB's transformed vertices rather than assuming its authoring axis.
  // The shipped mace is tilted diagonally by its nested node transforms, so its shaft is
  // not aligned with the untransformed scene's local Y axis.
  scene.updateMatrixWorld(true);
  const points = [];
  const point = new THREE.Vector3();
  scene.traverse((sourceMesh) => {
    if (!sourceMesh.isMesh || !sourceMesh.geometry?.attributes?.position) return;
    const position = sourceMesh.geometry.attributes.position;
    // Models used here are lightweight. Sampling every vertex gives a stable fit while
    // avoiding assumptions about mesh names or hard-coded world coordinates.
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(sourceMesh.matrixWorld).applyMatrix4(orientationMatrix);
      points.push(point.clone());
    }
  });
  if (points.length < 3) return new THREE.Vector3(0, 1, 0);

  const mean = points.reduce((sum, item) => sum.add(item), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  points.forEach((item) => {
    const x = item.x - mean.x;
    const y = item.y - mean.y;
    const z = item.z - mean.z;
    covariance[0][0] += x * x; covariance[0][1] += x * y; covariance[0][2] += x * z;
    covariance[1][0] += x * y; covariance[1][1] += y * y; covariance[1][2] += y * z;
    covariance[2][0] += x * z; covariance[2][1] += y * z; covariance[2][2] += z * z;
  });
  // Power iteration finds the dominant geometric axis; the mace's shaft/head extends much
  // farther along this axis than across it. Start along the widest AABB dimension for fast
  // convergence, then choose a stable sign so the grip end remains at the low-Y end.
  const bounds = new THREE.Box3().setFromPoints(points);
  const extents = bounds.getSize(new THREE.Vector3());
  let axis = extents.x >= extents.y && extents.x >= extents.z
    ? new THREE.Vector3(1, 0, 0)
    : extents.y >= extents.z ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < 24; i += 1) {
    const next = new THREE.Vector3(
      covariance[0][0] * axis.x + covariance[0][1] * axis.y + covariance[0][2] * axis.z,
      covariance[1][0] * axis.x + covariance[1][1] * axis.y + covariance[1][2] * axis.z,
      covariance[2][0] * axis.x + covariance[2][1] * axis.y + covariance[2][2] * axis.z,
    );
    if (next.lengthSq() < 1e-12) break;
    axis.copy(next.normalize());
  }
  const hint = new THREE.Vector3().fromArray(directionHint).normalize();
  if (axis.dot(hint) < 0) axis.negate();
  return axis.normalize();
}

function prepareAccessoryModel(
  scene,
  targetHeight,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
  gripOffset = [0, 0, 0],
  orientationOptions = {},
) {
  scene.updateMatrixWorld(true);
  const orientationMatrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(rotationX, rotationY, rotationZ, 'XYZ'),
  );
  let axisAlignmentMatrix = null;
  if (orientationOptions.alignLongAxisToY) {
    const longAxis = inferAccessoryLongAxis(scene, orientationMatrix, orientationOptions.directionHint || [1, 1, 0]);
    const alignment = new THREE.Quaternion().setFromUnitVectors(longAxis, new THREE.Vector3(0, 1, 0));
    axisAlignmentMatrix = new THREE.Matrix4().makeRotationFromQuaternion(alignment);
  }
  const oriented = new THREE.Group();
  oriented.name = 'oriented-accessory-source';
  let meshCount = 0;

  scene.traverse((sourceMesh) => {
    if (!sourceMesh.isMesh || !sourceMesh.geometry?.attributes?.position) return;
    const geometry = sourceMesh.geometry.clone();
    // Bake nested GLTF node transforms, then rotate the actual vertices into avatar Y-up space.
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    geometry.applyMatrix4(orientationMatrix);
    if (axisAlignmentMatrix) geometry.applyMatrix4(axisAlignmentMatrix);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const materials = Array.isArray(sourceMesh.material) ? sourceMesh.material : [sourceMesh.material];
    materials.filter(Boolean).forEach((material) => {
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      material.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(geometry, sourceMesh.material);
    mesh.name = sourceMesh.name || `accessory-mesh-${meshCount}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = sourceMesh.renderOrder;
    oriented.add(mesh);
    meshCount += 1;
  });

  if (!meshCount) throw new Error('GLB accessory contains no usable 3D geometry.');
  oriented.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(oriented);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite) || size.y < 1e-5) {
    // The catch path disposes the source GLTF, including its shared materials and textures.
    // Do not dispose those shared resources here while cleaning up cloned geometry.
    oriented.traverse((object) => object.geometry?.dispose?.());
    throw new Error('GLB accessory contains no usable 3D geometry after orientation.');
  }

  // Anchor held objects at the actual grip region, not the center of their bounding box.
  // The mace's heavy head is off-axis, so centering X/Z on the whole model moves its handle
  // away from the wrist. For both accessories, find the low-Y grip band after all GLB and axis
  // transforms have been baked, then place that band's centroid at the wrist pivot.
  let gripAnchor = new THREE.Vector3(center.x, bounds.min.y, center.z);
  if (orientationOptions.anchorAtGrip) {
    const bandFraction = THREE.MathUtils.clamp(
      Number(orientationOptions.gripBandFraction) || 0.1, 0.03, 0.3,
    );
    const thresholdY = bounds.min.y + size.y * bandFraction;
    const gripSum = new THREE.Vector3();
    let gripCount = 0;
    oriented.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
      const positions = mesh.geometry.attributes.position;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < positions.count; i += 1) {
        vertex.fromBufferAttribute(positions, i);
        if (vertex.y <= thresholdY) {
          gripSum.add(vertex);
          gripCount += 1;
        }
      }
    });
    if (gripCount > 0) gripAnchor.copy(gripSum.multiplyScalar(1 / gripCount));
  }
  oriented.position.set(
    -gripAnchor.x + gripOffset[0],
    -gripAnchor.y + gripOffset[1],
    -gripAnchor.z + gripOffset[2],
  );
  const fitted = new THREE.Group();
  fitted.name = 'normalized-accessory-model';
  fitted.scale.setScalar(targetHeight / size.y);
  fitted.add(oriented);
  fitted.updateMatrixWorld(true);
  return fitted;
}

function loadAccessoryModel(
  loader, url, target, targetHeight, rotationX, rotationY, rotationZ,
  isDisposed, displayName, gripOffset = [0, 0, 0], orientationOptions = {},
) {
  loader.load(url, async (gltf) => {
    if (isDisposed()) {
      disposeLoadedModel(gltf.scene);
      return;
    }
    try {
      await applyAccessoryTextures(gltf.scene, displayName);
      if (isDisposed()) {
        disposeLoadedModel(gltf.scene);
        return;
      }
      const fitted = prepareAccessoryModel(
        gltf.scene, targetHeight, rotationX, rotationY, rotationZ, gripOffset, orientationOptions,
      );
      fitted.name = `${displayName}-normalized-model`;
      target.add(fitted);
      // The fitted accessory has cloned geometry but deliberately shares source materials/textures.
      disposeSourceGeometryOnly(gltf.scene);
      console.info(`[CharacterStage] Loaded and normalized ${displayName} from ${url}.`);
    } catch (error) {
      disposeLoadedModel(gltf.scene);
      console.error(`[CharacterStage] Could not prepare ${displayName} model at ${url}.`, error);
    }
  }, undefined, (error) => {
    if (!isDisposed()) console.error(`[CharacterStage] Failed to load ${displayName} GLB at ${url}.`, error);
  });
}

/**
 * Split the supplied armour display model into wearable regions. The pieces are laid out
 * along source X; the imported GLB root already rotates source Z-up into avatar Y-up. Use the
 * world transforms from GLTFLoader exactly once before measuring and splitting triangles.
 */
// Reference-matched Wemmbu netherite palette: dark plum metal with vivid magenta/lavender trim.
// Colors are applied to the supplied GLB surfaces as vertex colors, so they follow the real meshes.
const NETHERITE_ARMOR_PALETTE = {
  shadow: new THREE.Color('#4B202C'),
  base: new THREE.Color('#713443'),
  highlight: new THREE.Color('#975564'),
  trim: new THREE.Color('#C703C3'),
  trimDeep: new THREE.Color('#5F2793'),
  trimLight: new THREE.Color('#D87DEC'),
};

function configureNetheriteArmorMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  materials.filter(Boolean).forEach((entry) => {
    if (entry.color) entry.color.set('#FFFFFF');
    if ('vertexColors' in entry) entry.vertexColors = true;
    if ('metalness' in entry) entry.metalness = 0.32;
    if ('roughness' in entry) entry.roughness = 0.58;
    entry.needsUpdate = true;
  });
}

function getNetheriteArmorFaceColor(label, x, y, nx, ny, nz) {
  const front = nz < -0.56; // The character's camera/front side is -Z in this rig.
  const side = Math.abs(nx) > 0.62;
  const top = ny > 0.62;
  let color = top ? NETHERITE_ARMOR_PALETTE.highlight
    : (front ? NETHERITE_ARMOR_PALETTE.base : NETHERITE_ARMOR_PALETTE.shadow);

  if (label === 'helmet') {
    if (front && (Math.abs(x) > 0.205 || y > 0.19 || y < -0.225)) {
      color = NETHERITE_ARMOR_PALETTE.trim;
    } else if (front && y > 0.125 && Math.abs(x) < 0.16) {
      color = NETHERITE_ARMOR_PALETTE.trimLight;
    } else if (side && y > 0.18) {
      color = NETHERITE_ARMOR_PALETTE.trimDeep;
    }
  } else if (label === 'chestplate') {
    if (front && (Math.abs(x) > 0.218 || y > 0.335 || y < -0.34)) {
      color = NETHERITE_ARMOR_PALETTE.trim;
    } else if (front && Math.abs(y - 0.105) < 0.024) {
      color = NETHERITE_ARMOR_PALETTE.trimDeep;
    } else if (side && Math.abs(x) > 0.225) {
      color = NETHERITE_ARMOR_PALETTE.trimDeep;
    }
  } else if (label.endsWith('shoulder')) {
    // Shoulder caps use a compact top-edge trim that follows the supplied chestplate islands.
    if (front && y > -0.055) {
      color = NETHERITE_ARMOR_PALETTE.trim;
    } else if (front && Math.abs(x) > 0.105) {
      color = NETHERITE_ARMOR_PALETTE.trimLight;
    } else if (side && Math.abs(x) > 0.13) {
      color = NETHERITE_ARMOR_PALETTE.trimDeep;
    }
  } else if (label.includes('leggings')) {
    if (front && y > -0.105) {
      color = NETHERITE_ARMOR_PALETTE.trimDeep;
    } else if (front && Math.abs(x) > 0.108) {
      color = NETHERITE_ARMOR_PALETTE.trim;
    } else if (front && y < -0.405 && y > -0.515 && Math.abs(x) < 0.105) {
      color = NETHERITE_ARMOR_PALETTE.trimLight;
    } else if (side && Math.abs(x) > 0.116) {
      color = NETHERITE_ARMOR_PALETTE.trimDeep;
    }
  } else if (label.endsWith('boot')) {
    if (y > -0.555 && y < -0.515) {
      color = NETHERITE_ARMOR_PALETTE.trim;
    } else if (front && y < -0.675) {
      color = NETHERITE_ARMOR_PALETTE.trimLight;
    } else if (front && Math.abs(x) > 0.116) {
      color = NETHERITE_ARMOR_PALETTE.trimDeep;
    }
  }

  return color;
}

function applyNetheriteArmorColors(geometry, label) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position) return;

  const colors = new Float32Array(position.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  for (let vertex = 0; vertex + 2 < position.count; vertex += 3) {
    const x = (position.getX(vertex) + position.getX(vertex + 1) + position.getX(vertex + 2)) / 3;
    const y = (position.getY(vertex) + position.getY(vertex + 1) + position.getY(vertex + 2)) / 3;
    if (normal) {
      faceNormal.set(
        (normal.getX(vertex) + normal.getX(vertex + 1) + normal.getX(vertex + 2)) / 3,
        (normal.getY(vertex) + normal.getY(vertex + 1) + normal.getY(vertex + 2)) / 3,
        (normal.getZ(vertex) + normal.getZ(vertex + 1) + normal.getZ(vertex + 2)) / 3,
      ).normalize();
    } else {
      a.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      b.set(position.getX(vertex + 1), position.getY(vertex + 1), position.getZ(vertex + 1));
      c.set(position.getX(vertex + 2), position.getY(vertex + 2), position.getZ(vertex + 2));
      faceNormal.subVectors(b, a).cross(c.sub(a)).normalize();
    }

    const color = getNetheriteArmorFaceColor(
      label, x, y, faceNormal.x, faceNormal.y, faceNormal.z,
    );
    for (let offset = 0; offset < 3; offset += 1) {
      const colorOffset = (vertex + offset) * 3;
      colors[colorOffset] = color.r;
      colors[colorOffset + 1] = color.g;
      colors[colorOffset + 2] = color.b;
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Load the original wearable GLB triangles, clip intersecting faces against measured source
 * island bounds, correct source orientation where the measured face aperture requires it,
 * and fit with a centre-aligned least-squares uniform scale to the avatar's measured rig bounds.
 * Source materials, UVs and vertex attributes are retained; only the netherite vertex palette
 * is adjusted after fitting.
 */

/**
 * Calibrate the chestplate's source front normal against the avatar torso frame.
 * This is derived from the selected GLB triangles, not a guessed Euler offset. The
 * supplied mesh's transformed front surfaces measure almost exactly local -Z; this
 * step removes only any residual exporter tilt before the geometry is fitted.
 */
function alignArmorFrontToAvatarFrame(fragments, sourceBounds, label) {
  if (label !== 'chestplate') return 0;
  const weightedFront = new THREE.Vector3();
  let totalArea = 0;
  for (const { geometry } of fragments) {
    const position = geometry.getAttribute('position');
    if (!position) continue;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let index = 0; index + 2 < position.count; index += 3) {
      a.fromBufferAttribute(position, index);
      b.fromBufferAttribute(position, index + 1);
      c.fromBufferAttribute(position, index + 2);
      normal.subVectors(b, a).cross(c.sub(a));
      const doubleArea = normal.length();
      if (doubleArea < 1e-10) continue;
      normal.multiplyScalar(1 / doubleArea);
      if (Math.abs(normal.z) < 0.85) continue;
      if (normal.z > 0) normal.negate();
      const area = doubleArea * 0.5;
      weightedFront.addScaledVector(normal, area);
      totalArea += area;
    }
  }
  if (totalArea < 1e-8 || weightedFront.lengthSq() < 1e-12) {
    console.warn('[CharacterStage] Chestplate orientation calibration skipped: no stable front-facing surface was measured.');
    return 0;
  }

  const measuredFront = weightedFront.normalize();
  const avatarFront = new THREE.Vector3(0, 0, -1);
  const correction = new THREE.Quaternion().setFromUnitVectors(measuredFront, avatarFront);
  const correctionRadians = correction.angleTo(new THREE.Quaternion());
  if (correctionRadians > 1e-10) {
    const center = sourceBounds.getCenter(new THREE.Vector3());
    const correctionMatrix = new THREE.Matrix4()
      .makeTranslation(center.x, center.y, center.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(correction))
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
    fragments.forEach(({ geometry }) => {
      geometry.applyMatrix4(correctionMatrix);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
    sourceBounds.makeEmpty();
    fragments.forEach(({ geometry }) => sourceBounds.union(geometry.boundingBox));
  }
  console.info('[CharacterStage] Chestplate front plane calibrated to avatar torso frame:', {
    measuredFrontNormal: measuredFront.toArray(),
    targetFrontNormal: avatarFront.toArray(),
    correctionDegrees: THREE.MathUtils.radToDeg(correctionRadians),
    fittedMeshLocalRotationDegrees: [0, 0, 0],
  });
  return correctionRadians;
}

function loadFittedArmorRegion(loader, url, target, targetMin, targetMax, isDisposed, gear, label, clipBounds = null, sourceYawRadians = 0) {
  loader.load(url, (gltf) => {
    if (isDisposed()) {
      disposeLoadedModel(gltf.scene);
      return;
    }

    const fragments = [];
    const sourceBounds = new THREE.Box3();
    const sourceGeometries = [];
    try {
      gltf.scene.updateMatrixWorld(true);

      // The source exports store the wearable surface as many small mesh objects, plus
      // disconnected stray fragments. Weld by world-space edge identity (not by triangle
      // centroid) so we can select the connected wearable island intersecting this region.
      const faces = [];
      gltf.scene.traverse((sourceMesh) => {
        if (!sourceMesh.isMesh || !sourceMesh.geometry?.attributes?.position) return;
        const worldGeometry = sourceMesh.geometry.index
          ? sourceMesh.geometry.toNonIndexed()
          : sourceMesh.geometry.clone();
        worldGeometry.applyMatrix4(sourceMesh.matrixWorld);
        sourceGeometries.push({ sourceMesh, worldGeometry });
        const position = worldGeometry.getAttribute('position');
        const keyFor = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
        for (let faceIndex = 0; faceIndex * 3 + 2 < position.count; faceIndex += 1) {
          const points = [0, 1, 2].map((offset) => new THREE.Vector3(
            position.getX(faceIndex * 3 + offset),
            position.getY(faceIndex * 3 + offset),
            position.getZ(faceIndex * 3 + offset),
          ));
          const keys = points.map((point) => keyFor(point.x, point.y, point.z));
          const edgeKeys = [
            [keys[0], keys[1]], [keys[1], keys[2]], [keys[2], keys[0]],
          ].map(([a, b]) => a < b ? `${a}|${b}` : `${b}|${a}`);
          faces.push({ sourceIndex: sourceGeometries.length - 1, faceIndex, points, edgeKeys });
        }
      });

      if (!faces.length) throw new Error(`The ${label}.glb contains no triangle geometry.`);
      const parents = faces.map((_, index) => index);
      const findRoot = (index) => {
        let root = index;
        while (parents[root] !== root) root = parents[root];
        while (parents[index] !== index) {
          const next = parents[index];
          parents[index] = root;
          index = next;
        }
        return root;
      };
      const union = (a, b) => {
        const rootA = findRoot(a);
        const rootB = findRoot(b);
        if (rootA !== rootB) parents[rootB] = rootA;
      };
      const edgeOwners = new Map();
      faces.forEach((face, faceIndex) => {
        face.edgeKeys.forEach((edgeKey) => {
          const owner = edgeOwners.get(edgeKey);
          if (owner === undefined) edgeOwners.set(edgeKey, faceIndex);
          else union(faceIndex, owner);
        });
      });

      const componentScores = new Map();
      const componentFaceCounts = new Map();
      faces.forEach((face, faceIndex) => {
        const root = findRoot(faceIndex);
        componentFaceCounts.set(root, (componentFaceCounts.get(root) || 0) + 1);
        const points = face.points;
        const faceLow = new THREE.Vector3(
          Math.min(...points.map((point) => point.x)),
          Math.min(...points.map((point) => point.y)),
          Math.min(...points.map((point) => point.z)),
        );
        const faceHigh = new THREE.Vector3(
          Math.max(...points.map((point) => point.x)),
          Math.max(...points.map((point) => point.y)),
          Math.max(...points.map((point) => point.z)),
        );
        const overlaps = !clipBounds || [0, 1, 2].every((axis) => (
          faceHigh.getComponent(axis) >= clipBounds[0][axis] - 1e-6
          && faceLow.getComponent(axis) <= clipBounds[1][axis] + 1e-6
        ));
        if (!overlaps) return;
        const area = points[1].clone().sub(points[0])
          .cross(points[2].clone().sub(points[0])).length() * 0.5;
        componentScores.set(root, (componentScores.get(root) || 0) + area);
      });

      let selectedComponent = null;
      let bestScore = -1;
      componentScores.forEach((score, root) => {
        if (score > bestScore) {
          bestScore = score;
          selectedComponent = root;
        }
      });
      if (selectedComponent === null || bestScore <= 1e-10) {
        throw new Error(`No connected wearable island intersects the measured ${label} region.`);
      }
      const selectedFacesBySource = new Map();
      let selectedComponentFaceCount = 0;
      faces.forEach((face, faceIndex) => {
        if (findRoot(faceIndex) !== selectedComponent) return;
        selectedComponentFaceCount += 1;
        if (!selectedFacesBySource.has(face.sourceIndex)) selectedFacesBySource.set(face.sourceIndex, new Set());
        selectedFacesBySource.get(face.sourceIndex).add(face.faceIndex);
      });

      sourceGeometries.forEach(({ sourceMesh, worldGeometry }, sourceIndex) => {
        const selectedFaceIndices = selectedFacesBySource.get(sourceIndex);
        if (!selectedFaceIndices?.size) {
          worldGeometry.dispose();
          return;
        }
        const sourcePosition = worldGeometry.getAttribute('position');
        const sourceAttributes = Object.entries(worldGeometry.attributes);
        const keptAttributes = Object.fromEntries(sourceAttributes.map(([name]) => [name, []]));
        const readVertex = (vertexIndex) => {
          const vertex = {};
          sourceAttributes.forEach(([name, attribute]) => {
            const components = [];
            for (let component = 0; component < attribute.itemSize; component += 1) {
              components.push(attribute.getComponent(vertexIndex, component));
            }
            vertex[name] = components;
          });
          return vertex;
        };
        const interpolateVertex = (from, to, amount) => {
          const vertex = {};
          sourceAttributes.forEach(([name]) => {
            vertex[name] = from[name].map((value, index) => value + (to[name][index] - value) * amount);
          });
          return vertex;
        };
        const clipAtAxis = (polygon, axis, boundary, keepGreater) => {
          if (!polygon.length) return [];
          const output = [];
          const inside = (vertex) => keepGreater
            ? vertex.position[axis] >= boundary - 1e-6
            : vertex.position[axis] <= boundary + 1e-6;
          let previous = polygon[polygon.length - 1];
          let previousInside = inside(previous);
          polygon.forEach((current) => {
            const currentInside = inside(current);
            if (currentInside !== previousInside) {
              const delta = current.position[axis] - previous.position[axis];
              const amount = Math.abs(delta) > 1e-8
                ? (boundary - previous.position[axis]) / delta
                : 0;
              output.push(interpolateVertex(previous, current, THREE.MathUtils.clamp(amount, 0, 1)));
            }
            if (currentInside) output.push(current);
            previous = current;
            previousInside = currentInside;
          });
          return output;
        };

        selectedFaceIndices.forEach((faceIndex) => {
          const vertex = faceIndex * 3;
          const polygonStart = [readVertex(vertex), readVertex(vertex + 1), readVertex(vertex + 2)];
          let polygon = polygonStart;
          if (clipBounds) {
            for (let axis = 0; axis < 3; axis += 1) {
              polygon = clipAtAxis(polygon, axis, clipBounds[0][axis], true);
              polygon = clipAtAxis(polygon, axis, clipBounds[1][axis], false);
              if (polygon.length < 3) break;
            }
          }
          if (polygon.length < 3) return;
          for (let index = 1; index < polygon.length - 1; index += 1) {
            [polygon[0], polygon[index], polygon[index + 1]].forEach((clippedVertex) => {
              sourceAttributes.forEach(([name]) => keptAttributes[name].push(...clippedVertex[name]));
            });
          }
        });

        const keptVertexCount = keptAttributes.position.length / 3;
        if (!keptVertexCount) {
          worldGeometry.dispose();
          return;
        }
        const filteredGeometry = new THREE.BufferGeometry();
        sourceAttributes.forEach(([name, attribute]) => {
          const values = new attribute.array.constructor(keptAttributes[name]);
          const copiedAttribute = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
          copiedAttribute.name = attribute.name;
          filteredGeometry.setAttribute(name, copiedAttribute);
        });
        if (!filteredGeometry.getAttribute('normal')) filteredGeometry.computeVertexNormals();
        else filteredGeometry.normalizeNormals();
        filteredGeometry.computeBoundingBox();
        filteredGeometry.computeBoundingSphere();
        sourceBounds.union(filteredGeometry.boundingBox);
        fragments.push({ geometry: filteredGeometry, material: sourceMesh.material, name: sourceMesh.name });
        worldGeometry.dispose();
      });

      if (!fragments.length || sourceBounds.isEmpty()) {
        throw new Error(`No matching connected wearable triangles were found in ${label}.glb.`);
      }

      // Correct source orientation in the GLB's already-converted Y-up world space.
      // The helmet's face aperture is on source +Z; Wemmbu's face plane is local -Z.
      // A 180-degree yaw about measured Y-up aligns the aperture with the face.
      // Rotate about the actual clipped-geometry centre, not the GLB origin.
      if (Math.abs(sourceYawRadians) > 1e-8) {
        const rotationCenter = sourceBounds.getCenter(new THREE.Vector3());
        const rotateAboutCenter = new THREE.Matrix4()
          .makeTranslation(rotationCenter.x, rotationCenter.y, rotationCenter.z)
          .multiply(new THREE.Matrix4().makeRotationY(sourceYawRadians))
          .multiply(new THREE.Matrix4().makeTranslation(-rotationCenter.x, -rotationCenter.y, -rotationCenter.z));
        fragments.forEach(({ geometry }) => {
          geometry.applyMatrix4(rotateAboutCenter);
          geometry.computeBoundingBox();
        });
        sourceBounds.makeEmpty();
        fragments.forEach(({ geometry }) => sourceBounds.union(geometry.boundingBox));
      }

      alignArmorFrontToAvatarFrame(fragments, sourceBounds, label);

      // Preserve the supplied armor proportions with one least-squares uniform scale.
      // The scale minimizes ||sourceSize * scale - targetSize||²; it never stretches
      // X/Y/Z independently. Centre alignment is calculated from the measured bounds.
      const sourceSize = sourceBounds.getSize(new THREE.Vector3());
      const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
      const targetLow = new THREE.Vector3(...targetMin);
      const targetHigh = new THREE.Vector3(...targetMax);
      const targetSize = targetHigh.clone().sub(targetLow);
      const targetCenter = targetLow.clone().add(targetHigh).multiplyScalar(0.5);
      const sourceSizeSquared = sourceSize.lengthSq();
      const uniformScale = sourceSizeSquared > 1e-12
        ? sourceSize.dot(targetSize) / sourceSizeSquared
        : 1;
      if (!Number.isFinite(uniformScale) || uniformScale <= 0) {
        throw new Error(`Invalid geometry-derived uniform scale for ${label}.`);
      }
      const fittedTranslation = targetCenter.clone().addScaledVector(sourceCenter, -uniformScale);
      const fitMatrix = new THREE.Matrix4().makeTranslation(
        fittedTranslation.x, fittedTranslation.y, fittedTranslation.z,
      ).multiply(new THREE.Matrix4().makeScale(uniformScale, uniformScale, uniformScale));
      const fittedSize = sourceSize.clone().multiplyScalar(uniformScale);
      const fitResidual = fittedSize.clone().sub(targetSize);
      console.info(`[CharacterStage] Geometry fit ${label}:`, {
        sourceBounds: sourceBounds.min.toArray().concat(sourceBounds.max.toArray()),
        targetBounds: targetLow.toArray().concat(targetHigh.toArray()),
        selectedComponentFaces: selectedComponentFaceCount,
        sourceComponentCount: componentFaceCounts.size,
        uniformScale,
        fittedDimensions: fittedSize.toArray(),
        targetDimensions: targetSize.toArray(),
        dimensionResidual: fitResidual.toArray(),
        yawRadians: sourceYawRadians,
      });

      fragments.forEach(({ geometry, material, name }, index) => {
        const position = geometry.getAttribute('position');
        for (let vertex = 0; vertex < position.count; vertex += 1) {
          const fittedPoint = new THREE.Vector3(
            position.getX(vertex), position.getY(vertex), position.getZ(vertex),
          ).applyMatrix4(fitMatrix);
          position.setXYZ(vertex, fittedPoint.x, fittedPoint.y, fittedPoint.z);
        }
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        applyNetheriteArmorColors(geometry, label);
        configureNetheriteArmorMaterial(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `${label}-${name || `mesh-${index}`}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = false;
        target.add(mesh);
        gear.armorMeshes.push(mesh);
      });

      // The fitted meshes own their new geometries and share the GLB's original materials.
      disposeSourceGeometryOnly(gltf.scene);
      gear.armorReady = true;
      console.info(`[CharacterStage] Fitted original ${label}.glb wearable island to Wemmbu (${fragments.length} mesh fragments).`);
    } catch (error) {
      fragments.forEach(({ geometry }) => geometry.dispose());
      sourceGeometries.forEach(({ worldGeometry }) => worldGeometry.dispose());
      disposeLoadedModel(gltf.scene);
      console.error(`[CharacterStage] Could not fit ${label}.glb from ${url}.`, error);
    }
  }, undefined, (error) => {
    if (!isDisposed()) console.error(`[CharacterStage] Failed to load ${label}.glb at ${url}.`, error);
  });
}

function getPivotLocalBounds(pivot, label) {
  if (!pivot) throw new Error(`Cannot measure the ${label} pivot because it is missing.`);
  const bounds = new THREE.Box3();
  let foundMesh = false;
  pivot.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox && !object.geometry.boundingBox.isEmpty()) {
      bounds.union(object.geometry.boundingBox);
      foundMesh = true;
    }
  });
  if (!foundMesh || bounds.isEmpty()) throw new Error(`Could not measure the ${label} pivot geometry.`);
  return bounds;
}

function expandedLocalBounds(bounds, padding) {
  const pad = typeof padding === 'number'
    ? new THREE.Vector3(padding, padding, padding)
    : new THREE.Vector3(padding.x || 0, padding.y || 0, padding.z || 0);
  return [bounds.min.clone().sub(pad).toArray(), bounds.max.clone().add(pad).toArray()];
}

// Expand a measured fit target uniformly around its own centre. Since the fitting
// routine uses a single least-squares scale, multiplying all three target dimensions
// by this factor increases the resulting wearable shell by the same proportion without
// moving its centre or distorting the original GLB proportions.
function growFitBounds(bounds, factor) {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`Invalid armor fit-size factor: ${factor}`);
  }
  const low = new THREE.Vector3(...bounds[0]);
  const high = new THREE.Vector3(...bounds[1]);
  const center = low.clone().add(high).multiplyScalar(0.5);
  const halfSize = high.clone().sub(low).multiplyScalar(0.5 * factor);
  return [center.clone().sub(halfSize).toArray(), center.clone().add(halfSize).toArray()];
}

function loadArmorPieces(loader, anchors, gear, isDisposed) {
  // Measure the actual outer-layer meshes in Wemmbu's rebuilt local pivots. These
  // dimensions come from the character GLB itself, not estimated Minecraft defaults.
  const headBounds = getPivotLocalBounds(anchors.head, 'head');
  const bodyBounds = getPivotLocalBounds(anchors.body, 'torso');
  const rightArmBounds = getPivotLocalBounds(anchors.rightArm, 'right arm');
  const leftArmBounds = getPivotLocalBounds(anchors.leftArm, 'left arm');
  const rightLegBounds = getPivotLocalBounds(anchors.rightLeg, 'right leg');
  const leftLegBounds = getPivotLocalBounds(anchors.leftLeg, 'left leg');

  // Use one eighth of a measured 1/8-head-width skin voxel as shell clearance.
  // The base head is 0.5 units wide across eight Minecraft skin pixels; this
  // margin is 1/8 of that measured pixel pitch, not a freehand positional offset.
  const armorClearance = (0.5 / 8) / 8;
  const CHESTPLATE_SIZE_FACTOR = 1.10;
  const LEGGINGS_SIZE_FACTOR = 1.10;
  const fittedHeadBounds = expandedLocalBounds(headBounds, armorClearance);
  const fittedTorsoBounds = growFitBounds(
    expandedLocalBounds(bodyBounds, armorClearance), CHESTPLATE_SIZE_FACTOR,
  );
  const fittedRightLegBounds = growFitBounds(
    expandedLocalBounds(rightLegBounds, armorClearance), LEGGINGS_SIZE_FACTOR,
  );
  const fittedLeftLegBounds = growFitBounds(
    expandedLocalBounds(leftLegBounds, armorClearance), LEGGINGS_SIZE_FACTOR,
  );
  // The original Minecraft leg pivots sit at X=+0.125 and X=-0.125. Keep
  // the two outer armor shells on their own side of the exact center seam;
  // otherwise the expanded shells overlap by ~0.044 units and form crotch wedges.
  const rightLegInnerEdge = -anchors.rightLeg.position.x;
  const leftLegInnerEdge = -anchors.leftLeg.position.x;
  fittedRightLegBounds[0][0] = Math.max(fittedRightLegBounds[0][0], rightLegInnerEdge);
  fittedLeftLegBounds[1][0] = Math.min(fittedLeftLegBounds[1][0], leftLegInnerEdge);

  // Shoulder-cap height is derived from the actual arm cross-section, so its
  // upper shell has the same measured scale as the arm's width/depth.
  const shoulderBoundsFor = (armBounds) => {
    const armSize = armBounds.getSize(new THREE.Vector3());
    const capHeight = Math.max(armSize.x, armSize.z) + 3 * armorClearance;
    return growFitBounds([
      [armBounds.min.x - armorClearance, armBounds.max.y - capHeight, armBounds.min.z - armorClearance],
      [armBounds.max.x + armorClearance, armBounds.max.y + armorClearance, armBounds.max.z + armorClearance],
    ], CHESTPLATE_SIZE_FACTOR);
  };

  // The supplied boot island is measured as 12 x 18 x 12 units. Preserve that
  // 3:2 height-to-footprint ratio and derive boot height from the character's
  // measured leg width/depth rather than a fixed world-space offset.
  const bootBoundsFor = (legBounds, side, innerEdge) => {
    const legSize = legBounds.getSize(new THREE.Vector3());
    const footWidth = Math.max(legSize.x, legSize.z) + 2 * armorClearance;
    const sourceBootAspect = 18 / 12;
    const bootHeight = footWidth * sourceBootAspect;
    return [
      [side === 'right' ? Math.max(legBounds.min.x - armorClearance, innerEdge) : legBounds.min.x - armorClearance,
        legBounds.min.y - armorClearance, legBounds.min.z - armorClearance],
      [side === 'left' ? Math.min(legBounds.max.x + armorClearance, innerEdge) : legBounds.max.x + armorClearance,
        legBounds.min.y - armorClearance + bootHeight, legBounds.max.z + armorClearance],
    ];
  };

  console.info('[CharacterStage] Armor fit-size multipliers:', {
    chestplate: CHESTPLATE_SIZE_FACTOR,
    leggings: LEGGINGS_SIZE_FACTOR,
    helmet: 1,
    boots: 1,
  });
  console.info('[CharacterStage] Measured avatar armor targets:', {
    head: fittedHeadBounds,
    torso: fittedTorsoBounds,
    rightLeg: fittedRightLegBounds,
    leftLeg: fittedLeftLegBounds,
  });

  // Region boxes are measured against the original GLB wearable islands. The central
  // chestplate and leggings are already oriented toward -Z; the helmet alone is reversed.
  loadFittedArmorRegion(
    loader, ARMOR_HELMET_URL, anchors.head, ...fittedHeadBounds,
    isDisposed, gear, 'helmet', [[-65.01, -0.01, -14.01], [-40.99, 24.01, 10.01]], Math.PI,
  );

  // Main torso breastplate plus its left/right shoulder-cap regions. The source
  // island's measured shoulder seams are X=-20.99 and X=1.00. Use those exact
  // shared boundaries so the torso and shoulder clips never duplicate triangles.
  loadFittedArmorRegion(
    loader, ARMOR_CHESTPLATE_URL, anchors.body, ...fittedTorsoBounds,
    isDisposed, gear, 'chestplate', [[-20.99, -0.01, -8.27], [1.00, 31.18, 4.01]],
  );
  loadFittedArmorRegion(
    loader, ARMOR_CHESTPLATE_URL, anchors.leftArm, ...shoulderBoundsFor(leftArmBounds),
    isDisposed, gear, 'left-shoulder', [[-33.91, 17.78, -8.77], [-20.99, 33.22, 6.01]],
  );
  loadFittedArmorRegion(
    loader, ARMOR_CHESTPLATE_URL, anchors.rightArm, ...shoulderBoundsFor(rightArmBounds),
    isDisposed, gear, 'right-shoulder', [[1.00, 17.78, -8.77], [14.01, 33.22, 6.01]],
  );

  // The supplied leggings island includes two independent leg shells and a
  // separate upper waist band. Keep the two leg regions split at their exact
  // source seam, then fit the intact upper band to the measured torso/hip envelope.
  // Its 7:21 height-to-width ratio is measured directly from the original GLB.
  const bodySize = bodyBounds.getSize(new THREE.Vector3());
  const waistBandHeight = (bodySize.x + 2 * armorClearance) * (7 / 21);
  const waistBandMinY = anchors.body.position.y + bodyBounds.min.y - armorClearance;
  const fittedWaistBandBounds = growFitBounds([
    [
      bodyBounds.min.x - armorClearance,
      waistBandMinY,
      bodyBounds.min.z - armorClearance,
    ],
    [
      bodyBounds.max.x + armorClearance,
      waistBandMinY + waistBandHeight,
      bodyBounds.max.z + armorClearance,
    ],
  ], LEGGINGS_SIZE_FACTOR);
  loadFittedArmorRegion(
    loader, ARMOR_LEGGINGS_URL, anchors.waist,
    ...fittedWaistBandBounds,
    isDisposed, gear, 'leggings-waist', [[16.99, 32.00, -8.01], [38.01, 39.01, 4.01]],
  );
  loadFittedArmorRegion(
    loader, ARMOR_LEGGINGS_URL, anchors.rightLeg, ...fittedRightLegBounds,
    isDisposed, gear, 'right-leggings', [[16.99, -0.01, -8.01], [27.50, 30.01, 4.01]],
  );
  loadFittedArmorRegion(
    loader, ARMOR_LEGGINGS_URL, anchors.leftLeg, ...fittedLeftLegBounds,
    isDisposed, gear, 'left-leggings', [[27.50, -0.01, -8.01], [38.01, 30.01, 4.01]],
  );

  loadFittedArmorRegion(
    loader, ARMOR_BOOTS_URL, anchors.rightLeg, ...bootBoundsFor(rightLegBounds, 'right', rightLegInnerEdge),
    isDisposed, gear, 'right-boot', [[-4.23, -0.01, -8.01], [7.79, 18.01, 4.01]],
  );
  loadFittedArmorRegion(
    loader, ARMOR_BOOTS_URL, anchors.leftLeg, ...bootBoundsFor(leftLegBounds, 'left', leftLegInnerEdge),
    isDisposed, gear, 'left-boot', [[10.77, -0.01, -8.01], [22.79, 18.01, 4.01]],
  );
}
function attachEquipment(model, anchors, loader, isDisposed) {
  const armorMeshes = [];

  // GLB node names are anatomical: Right Arm is the main hand; Left Arm is the offhand.
  // Add explicit wrist pivots at the measured end of each arm, then attach props just in front
  // of the palm (-Z). This avoids the former offsets that left items suspended inside the forearm.
  const mainHand = anchors.rightArm && typeof anchors.rightArm.add === 'function'
    ? anchors.rightArm
    : ensurePivot(model, ['Right Arm_8', 'Right Arm', 'RightArm', 'Arm_R'], 'main-hand', new THREE.Vector3(0.375, 1.5, 0));
  const offHand = anchors.leftArm && typeof anchors.leftArm.add === 'function'
    ? anchors.leftArm
    : ensurePivot(model, ['Left Arm_11', 'Left Arm', 'LeftArm', 'Arm_L'], 'off-hand', new THREE.Vector3(-0.375, 1.5, 0));

  const mainWrist = new THREE.Group();
  mainWrist.name = 'wemmbu-main-hand-wrist-grip';
  // The arm cuboid extends from local Y=0 at the shoulder to Y=-0.75 at the wrist.
  // Make a real child grip pivot at the measured lower endpoint of the arm block.
  // Accessories and their optional palm overlay now meet at this same wrist location.
  mainWrist.position.set(0, -0.75, 0);
  mainHand.add(mainWrist);

  const mace = new THREE.Group();
  mace.name = 'equipped-mace-main-hand';
  // The normalized model origin is its measured grip zone, so it meets the palm at this pivot.
  mace.position.set(0, -0.005, -0.16);
  mainWrist.add(mace);
  mace.visible = false;

  // The source avatar has rigid cuboid arms and no separate hand/finger mesh. Add a small
  // Minecraft-style palm only while holding an item, so the handle visibly enters the hand
  // instead of appearing attached to the outside of the forearm. It follows the wrist pivot.
  const makeGripPalm = (name) => {
    // A Minecraft hand has no finger rig. This small cuboid overlaps both the arm's front face
    // and the accessory grip, so it reads as a hand holding the object instead of a detached cuff.
    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.13, 0.105),
      new THREE.MeshStandardMaterial({ color: '#8700d6', roughness: 0.9, metalness: 0.0 }),
    );
    palm.name = name;
    palm.position.set(0, 0.04, -0.15);
    palm.castShadow = true;
    palm.receiveShadow = true;
    palm.visible = false;
    return palm;
  };
  const maceGripPalm = makeGripPalm('main-hand-grip-palm');
  mainWrist.add(maceGripPalm);
  // The GLB's nested transforms place the shaft diagonally in world space. Align its measured
  // principal axis to avatar +Y, keeping the grip end at the wrist and the heavy head above it.
  // This keeps the actual multi-mesh mace 3D instead of letting its diagonal bounds scale across
  // the torso. A small cant makes the held pose natural without laying the weapon sideways.
  mace.rotation.z = 0.18;
  loadAccessoryModel(
    loader, MACE_MODEL_URL, mace, 0.66, 0, 0, 0, isDisposed, 'Minecraft mace', [0, 0, 0],
    { alignLongAxisToY: true, directionHint: [1, 1, 0], anchorAtGrip: true, gripBandFraction: 0.10 },
  );

  const offWrist = new THREE.Group();
  offWrist.name = 'wemmbu-offhand-wrist-grip';
  offWrist.position.set(0, -0.75, 0);
  offHand.add(offWrist);

  const totem = new THREE.Group();
  totem.name = 'equipped-totem-offhand';
  // Anchor the lower body of the Totem inside the offhand grip, rather than hanging its feet
  // from the wrist pivot as if it were stuck onto the outside of the arm.
  totem.position.set(0.035, -0.005, -0.16);
  offWrist.add(totem);
  totem.visible = false;
  const totemGripPalm = makeGripPalm('off-hand-grip-palm');
  // Keep the palm and Totem on the same grip line so the hand overlaps the lower body.
  totemGripPalm.position.x = 0.035;
  totemGripPalm.position.z = -0.15;
  offWrist.add(totemGripPalm);
  // The Totem GLB's root node already converts its source Z-up geometry into avatar Y-up.
  // A second -90° X rotation laid it on its side and made the model appear like a flat plank.
  // Keep its authored upright orientation, expose a little side depth, and scale it for a
  // clear hand-held silhouette. The wrist palm overlays its lower body to make the grip legible.
  totem.rotation.set(0, 0.16, 0);
  loadAccessoryModel(
    loader, TOTEM_MODEL_URL, totem, 0.38, 0, 0, 0, isDisposed, 'Totem of Undying', [0, 0, 0],
    { anchorAtGrip: true, gripBandFraction: 0.18 },
  );

  const gear = { armorMeshes, mace, totem, maceGripPalm, totemGripPalm, mainWrist, offWrist, armorReady: false };
  loadArmorPieces(loader, anchors, gear, isDisposed);
  return gear;
}

export default function CharacterStage({ action, actionDurationMs = 0, holdActionDuringSpeech = false, speechTimelineRef, isSpeaking = false, speechLevelRef, speechModeRef, armorOn, maceOn, totemOn, autoRotate = true, resetViewKey = 0, onActionComplete }) {
  const mountRef = useRef(null);
  const sceneState = useRef(null);
  const actionRef = useRef(action);
  const completionRef = useRef(onActionComplete);
  const equipmentRef = useRef({ armorOn, maceOn, totemOn });
  const autoRotateRef = useRef(autoRotate);
  const speakingRef = useRef(isSpeaking);
  const actionDurationRef = useRef(actionDurationMs);
  const holdActionRef = useRef(holdActionDuringSpeech);

  useEffect(() => { actionRef.current = action; }, [action]);
  useEffect(() => { completionRef.current = onActionComplete; }, [onActionComplete]);
  useEffect(() => { equipmentRef.current = { armorOn, maceOn, totemOn }; }, [armorOn, maceOn, totemOn]);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { actionDurationRef.current = actionDurationMs; }, [actionDurationMs]);
  useEffect(() => { holdActionRef.current = holdActionDuringSpeech; }, [holdActionDuringSpeech]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
    camera.position.set(1.2, 1.55, -4.9);
    camera.lookAt(0, 1.02, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const hemisphereLight = new THREE.HemisphereLight(0xe9f2ff, 0x7887a3, 2.1);
    scene.add(hemisphereLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
    keyLight.position.set(3.4, 5.6, -4.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x55edff, 10, 8);
    rimLight.position.set(-2.3, 2.5, 2.2);
    scene.add(rimLight);
    const fillLight = new THREE.PointLight(0x8d8eff, 5.5, 8);
    fillLight.position.set(2.7, 1.8, -3.0);
    scene.add(fillLight);

    const floorMaterial = new THREE.MeshStandardMaterial({ color: '#eef3fb', roughness: 0.92 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 64), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.16;
    floor.receiveShadow = true;
    scene.add(floor);
    const platformMaterial = new THREE.MeshStandardMaterial({ color: '#e8eef9', metalness: 0.1, roughness: 0.35 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.12, 64), platformMaterial);
    platform.position.y = -0.06;
    platform.receiveShadow = true;
    platform.castShadow = true;
    scene.add(platform);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.018, 10, 100), new THREE.MeshStandardMaterial({ color: '#b9fbff', emissive: '#35d5f6', emissiveIntensity: 1.8, metalness: 0.25, roughness: 0.23 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    scene.add(ring);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.60, 48), new THREE.MeshBasicMaterial({ color: '#98a8c8', transparent: true, opacity: 0.16, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.008;
    shadow.scale.set(1.12, 0.58, 1);
    scene.add(shadow);

    // Keep the 3D stage in sync with the app theme. The canvas is transparent, but the floor,
    // pedestal and high-intensity lights were hard-coded for light mode and stayed glaringly
    // white after the UI switched to dark mode.
    const applySceneTheme = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      floorMaterial.color.set(dark ? '#172234' : '#eef3fb');
      platformMaterial.color.set(dark ? '#2a3850' : '#e8eef9');
      platformMaterial.metalness = dark ? 0.22 : 0.1;
      shadow.material.color.set(dark ? '#070d18' : '#98a8c8');
      shadow.material.opacity = dark ? 0.34 : 0.16;
      ring.material.color.set(dark ? '#9beaf5' : '#b9fbff');
      ring.material.emissive.set(dark ? '#187f9a' : '#35d5f6');
      ring.material.emissiveIntensity = dark ? 1.0 : 1.8;
      hemisphereLight.intensity = dark ? 1.15 : 2.1;
      keyLight.intensity = dark ? 2.0 : 3.1;
      rimLight.intensity = dark ? 6.5 : 10;
      fillLight.intensity = dark ? 3.0 : 5.5;
    };
    applySceneTheme();
    const themeObserver = new MutationObserver(applySceneTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const avatarPivot = new THREE.Group();
    avatarPivot.name = 'wemmbu-upright-pivot';
    // Native GLB dimensions are ~2.05 units tall. Keep them unscaled and lift only 2.5 cm
    // so the lowest boot-overlay vertices sit on the stage rather than below it.
    avatarPivot.position.y = 0.025;
    scene.add(avatarPivot);

    // Dragging has intentionally split behavior: horizontal drag turns the avatar around
    // its vertical axis, while vertical drag changes only the camera's elevation. The model
    // itself is never pitched/rolled, so it remains upright while being inspected from above/below.
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.touchAction = 'none';
    const cameraTarget = new THREE.Vector3(0, 1.02, 0);
    const cameraOffset = camera.position.clone().sub(cameraTarget);
    const startingSpherical = new THREE.Spherical().setFromVector3(cameraOffset);
    const dragRef = { active: false, x: 0, y: 0, rotationY: 0, cameraRadius: startingSpherical.radius, cameraTheta: startingSpherical.theta, cameraPhi: startingSpherical.phi };

    const onPointerDown = (event) => {
      const pivot = sceneState.current?.avatarPivot;
      const cameraState = sceneState.current?.camera;
      if (!pivot || !cameraState) return;
      const offset = cameraState.position.clone().sub(cameraTarget);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      Object.assign(dragRef, {
        active: true, x: event.clientX, y: event.clientY, rotationY: pivot.rotation.y,
        cameraRadius: spherical.radius, cameraTheta: spherical.theta, cameraPhi: spherical.phi,
      });
      renderer.domElement.setPointerCapture?.(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    };
    const onPointerMove = (event) => {
      if (!dragRef.active) return;
      const current = sceneState.current;
      if (!current) return;
      const dx = event.clientX - dragRef.x;
      const dy = event.clientY - dragRef.y;
      current.avatarPivot.rotation.y = dragRef.rotationY + dx * 0.009;
      const minPhi = THREE.MathUtils.degToRad(18);
      const maxPhi = THREE.MathUtils.degToRad(162);
      const phi = THREE.MathUtils.clamp(dragRef.cameraPhi + dy * 0.008, minPhi, maxPhi);
      const spherical = new THREE.Spherical(dragRef.cameraRadius, phi, dragRef.cameraTheta);
      current.camera.position.copy(cameraTarget).add(new THREE.Vector3().setFromSpherical(spherical));
      current.camera.lookAt(cameraTarget);
    };
    const onPointerUp = () => {
      dragRef.active = false;
      renderer.domElement.style.cursor = 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    const loadingStatus = addStatus(mount, 'Loading Wemmbu 3D model…');
    const state = {
      scene, camera, renderer, avatarPivot, model: null, anchors: null, gear: null, ring,
      cameraTarget, defaultCameraPosition: new THREE.Vector3(1.2, 1.55, -4.9), dragRef,
      startedAt: performance.now(), lastAction: null, actionStartedAt: 0, actionCompleted: false,
      mouthController: null, mouthOpenness: 0, nativeSpeechStartedAt: null,
      disposed: false, loadErrorStatus: null,
    };
    sceneState.current = state;
    const clearLoadingStatus = () => {
      window.clearTimeout(state.loadTimeout);
      loadingStatus.remove();
      state.loadErrorStatus?.remove();
      state.loadErrorStatus = null;
    };
    state.loadTimeout = window.setTimeout(() => {
      if (state.disposed || state.model) return;
      loadingStatus.remove();
      state.loadErrorStatus = addStatus(mount, 'The 3D model is taking too long to load. Check that /models/high-fidelity_wemmbu_render.glb returns HTTP 200, then refresh.', true);
      console.error(`[CharacterStage] Timed out loading ${MODEL_URL}.`);
    }, 12000);

    const loader = new GLTFLoader();
    loader.load(MODEL_URL, async (gltf) => {
      if (state.disposed || sceneState.current !== state) {
        disposeLoadedModel(gltf.scene);
        return;
      }
      try {
        const sourceScene = gltf.scene;
        sourceScene.name = 'wemmbu-source-glb';
        sourceScene.updateMatrixWorld(true);

        // Use a normal same-origin PNG request for the avatar atlas. This avoids depending
        // on WebView2's Blob URL image decoding for the embedded GLB texture. The supplied
        // 64x64 skin atlas is extracted byte-for-byte from the original character GLB.
        const skinTexture = await new THREE.TextureLoader().loadAsync(AVATAR_SKIN_URL);
        if (state.disposed || sceneState.current !== state) {
          skinTexture.dispose();
          disposeLoadedModel(gltf.scene);
          return;
        }

        const sourceBounds = new THREE.Box3().setFromObject(sourceScene);
        const sourceSize = sourceBounds.getSize(new THREE.Vector3());
        if (![sourceSize.x, sourceSize.y, sourceSize.z].every(Number.isFinite) || sourceSize.y <= 0) {
          throw new Error('The Wemmbu GLB contains no usable 3D geometry.');
        }

        // Do not scale/translate the GLB and then attach hand-built pivot positions in a
        // different coordinate space. Its native height is ~2.05 units and the part bounds
        // already match the armour fitting dimensions, so the rebuilt rig stays in native units.
        const { rigRoot: model, anchors } = buildAvatarRig(sourceScene);
        applyAvatarSkinTexture(model, skinTexture);
        model.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = true;
          object.receiveShadow = true;
        });
        avatarPivot.add(model);
        state.model = model;
        state.anchors = anchors;
        state.baseRotations = {
          rightArm: anchors.rightArm?.rotation.clone() || new THREE.Euler(),
          leftArm: anchors.leftArm?.rotation.clone() || new THREE.Euler(),
          head: anchors.head?.rotation.clone() || new THREE.Euler(),
        };
        state.mouthController = attachMouthTextureController(anchors.head);
        state.baseWaistY = anchors.waist?.position.y || 0;
        state.baseBodyScale = anchors.body?.scale.clone() || new THREE.Vector3(1, 1, 1);
        // Stop showing the loading banner as soon as the avatar is visible. Equipment
        // loads separately and must never keep the full character stuck in Loading state.
        clearLoadingStatus();
        state.gear = attachEquipment(model, anchors, loader, () => state.disposed);
        console.info(`[CharacterStage] Loaded and rebuilt avatar rig from ${MODEL_URL}; native height=${sourceSize.y.toFixed(3)}.`);
      } catch (error) {
        clearLoadingStatus();
        state.loadErrorStatus = addStatus(mount, `Could not initialize Wemmbu's 3D model or skin texture: ${error.message || 'unknown model error'}`, true);
        console.error(`[CharacterStage] Avatar initialization failed for ${MODEL_URL}.`, error);
      }
    }, undefined, (error) => {
      if (state.disposed) return;
      clearLoadingStatus();
      state.loadErrorStatus = addStatus(mount, 'Could not load Wemmbu. Check that public/models/high-fidelity_wemmbu_render.glb exists and refresh.', true);
      console.error(`[CharacterStage] Failed to load the avatar GLB at ${MODEL_URL}.`, error);
    });

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 420 ? 36 : 33;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    let previousNow = performance.now();
    const animate = (now) => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min(Math.max((now - previousNow) / 1000, 0), 0.05);
      previousNow = now;
      const t = (now - state.startedAt) / 1000;
      const currentAction = actionRef.current;
      const currentEquipment = equipmentRef.current;
      const defaultActionDurations = {
        wave: 3100, explain: 4300, pose: 2800, nod: 1750, shake_head: 1700,
        think: 2750, point: 2550, present: 2750, shrug: 2150, cheer: 2450,
        salute: 2200, facepalm: 2100, stop: 2100,
      };
      const requestedDurationMs = Number(actionDurationRef.current);
      const currentActionDurationMs = THREE.MathUtils.clamp(
        Number.isFinite(requestedDurationMs) && requestedDurationMs > 0
          ? requestedDurationMs : (defaultActionDurations[currentAction] || 4300),
        500,
        30000,
      );
      const currentActionDurationSec = currentActionDurationMs / 1000;
      const actionElapsedMs = now - state.actionStartedAt;
      const actionHeldForSpeech = holdActionRef.current === true && speechTimelineRef?.current?.sessionActive !== false;

      if (autoRotateRef.current && !dragRef.active) avatarPivot.rotation.y += 0.12 * dt;
      ring.rotation.z = Math.sin(t * 0.35) * 0.025;

      // Animations depend only on the avatar and named pivots, not on the asynchronous
      // completion of armour/weapon loads. This prevents equipment failures from disabling poses.
      if (state.model && state.anchors) {
        const { anchors, gear, baseRotations } = state;
        if (gear) {
          gear.armorMeshes.forEach((mesh) => { mesh.visible = currentEquipment.armorOn; });
          // Equipment remains attached to the wrist pivots and follows shoulder movement.
          // Wave uses the offhand arm; the mace remains in the main hand and the totem stays
          // parented to the left wrist so neither prop is detached or teleported mid-gesture.
          gear.mace.visible = currentEquipment.maceOn;
          gear.totem.visible = currentEquipment.totemOn;
          gear.maceGripPalm.visible = currentEquipment.maceOn;
          gear.totemGripPalm.visible = currentEquipment.totemOn;
        }

        // Quiet Minecraft-like idle breathing: tiny upper-body bob plus a very small chest
        // expansion. It keeps running under actions, but never changes the character's upright axis.
        const breath = Math.sin(t * 1.85);
        if (anchors.waist) anchors.waist.position.y = (state.baseWaistY || 0) + breath * 0.007;
        if (anchors.body && state.baseBodyScale) {
          const chestScale = 1 + breath * 0.012;
          anchors.body.scale.x = state.baseBodyScale.x * chestScale;
          anchors.body.scale.z = state.baseBodyScale.z * chestScale;
        }

        if (currentAction !== state.lastAction) {
          state.lastAction = currentAction;
          state.actionStartedAt = now;
          state.actionCompleted = false;
        }
        const rightTarget = baseRotations.rightArm.clone();
        const leftTarget = baseRotations.leftArm.clone();
        const headTarget = baseRotations.head.clone();
        headTarget.y += Math.sin(t * 0.62) * 0.025;

        // Speech gets an independent facial channel. Fish Audio drives this from the actual
        // playback analyser. Native speech synthesis has no exposed audio samples, so its
        // documented fallback is a restrained rhythmic pixel-mouth pulse, not phoneme sync.
        const speechMode = speechModeRef?.current || 'idle';
        let mouthTarget = 0;
        if (speakingRef.current && speechMode === 'fish') {
          mouthTarget = THREE.MathUtils.clamp(Number(speechLevelRef?.current) || 0, 0, 1);
          state.nativeSpeechStartedAt = null;
        } else if (speakingRef.current && speechMode === 'native') {
          if (state.nativeSpeechStartedAt == null) state.nativeSpeechStartedAt = now;
          const elapsed = (now - state.nativeSpeechStartedAt) / 1000;
          const syllableEnvelope = Math.sin(elapsed * 9.2) * 0.47
            + Math.sin(elapsed * 15.7 + 0.8) * 0.25
            + Math.sin(elapsed * 4.1 + 1.3) * 0.14
            + 0.17;
          mouthTarget = THREE.MathUtils.clamp(syllableEnvelope, 0, 0.82);
        } else {
          state.nativeSpeechStartedAt = null;
        }
        state.mouthOpenness = THREE.MathUtils.damp(
          state.mouthOpenness,
          mouthTarget,
          mouthTarget > state.mouthOpenness ? 23 : 12,
          dt,
        );
        state.mouthController?.setOpening(state.mouthOpenness);

        if (currentAction === 'wave') {
          // Wave with the LEFT arm around its actual shoulder pivot. The arm mesh itself is
          // a child of this pivot, so the shoulder remains connected and the whole arm moves
          // as one rigid part. Small X/Y oscillations create a readable wave without flinging
          // the arm or separating it from the torso. Offhand equipment remains parented to wrist.
          const waveTime = (now - state.actionStartedAt) / 1000;
          // Lift the whole left arm from the shoulder. Keep the arm rigid and avoid adding
          // X/Y wobble here; those extra rotations made the hand look disconnected and tipped
          // the held totem. A small Z oscillation provides the wave without breaking the joint.
          leftTarget.z -= 1.96 + Math.sin(waveTime * 7.2) * 0.10;
          headTarget.y += Math.sin(waveTime * 2.4) * 0.025;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'explain') {
          // Phase the explaining motion from the same action start that is tied to the
          // first audible speech sample, not from the lifetime of the render loop.
          const actionElapsedSec = actionElapsedMs / 1000;
          const gesture = Math.sin(actionElapsedSec * 3.2);
          // Mirror the shoulder rotations so both arms open away from the chest instead of
          // crossing inward. Keep the motion below a wave/pose so it reads as explanation.
          rightTarget.z += 0.42 + gesture * 0.20;
          rightTarget.x += Math.sin(actionElapsedSec * 2.6) * 0.16;
          leftTarget.z -= 0.42 - gesture * 0.20;
          leftTarget.x -= Math.sin(actionElapsedSec * 2.6 + 0.7) * 0.16;
          headTarget.y += Math.sin(actionElapsedSec * 1.8) * 0.075;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'pose') {
          rightTarget.z += 0.92;
          leftTarget.z -= 0.92;
          rightTarget.x += 0.12;
          leftTarget.x -= 0.12;
          headTarget.y += 0.14;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'nod') {
          // Two small nods, with the head returning smoothly toward its native rest rotation.
          const elapsed = (now - state.actionStartedAt) / 1000;
          const fade = THREE.MathUtils.clamp(1 - elapsed / currentActionDurationSec, 0, 1);
          headTarget.x += Math.sin(elapsed * 10.5) * 0.19 * fade;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'shake_head') {
          // A restrained left-right head shake with a tapered envelope.
          const elapsed = (now - state.actionStartedAt) / 1000;
          const fade = THREE.MathUtils.clamp(1 - elapsed / currentActionDurationSec, 0, 1);
          headTarget.y += Math.sin(elapsed * 11.5) * 0.31 * fade;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'think') {
          // Rigid block arm approaches the lower face; a slight head tilt sells the thought.
          const elapsed = (now - state.actionStartedAt) / 1000;
          rightTarget.x += 0.79;
          rightTarget.z -= 0.56;
          headTarget.x += 0.10;
          headTarget.y += 0.09 + Math.sin(elapsed * 2.0) * 0.025;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'point') {
          // The right arm extends forward; the hand stays rigid because the source model has no finger rig.
          const elapsed = (now - state.actionStartedAt) / 1000;
          rightTarget.x += 1.17;
          rightTarget.z += 0.04;
          headTarget.y += 0.07;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'present') {
          // Open the offhand to the side in a presentation arc without changing the body pivot.
          const elapsed = (now - state.actionStartedAt) / 1000;
          leftTarget.x += 0.72 + Math.sin(elapsed * 2.3) * 0.045;
          leftTarget.z -= 0.52;
          headTarget.y -= 0.08;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'shrug') {
          const elapsed = (now - state.actionStartedAt) / 1000;
          const lift = Math.sin(Math.min(elapsed / 0.35, 1) * Math.PI / 2);
          rightTarget.z += 0.86 * lift;
          leftTarget.z -= 0.86 * lift;
          rightTarget.x += 0.14;
          leftTarget.x -= 0.14;
          headTarget.z += 0.12 + Math.sin(elapsed * 2.0) * 0.025;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'cheer') {
          const elapsed = (now - state.actionStartedAt) / 1000;
          rightTarget.z += 1.65;
          leftTarget.z -= 1.65;
          rightTarget.x += 0.10;
          leftTarget.x -= 0.10;
          headTarget.x -= 0.07 + Math.sin(elapsed * 4.0) * 0.025;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'salute') {
          const elapsed = (now - state.actionStartedAt) / 1000;
          rightTarget.x += 0.71;
          rightTarget.z -= 1.02;
          headTarget.x += 0.035;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'facepalm') {
          const elapsed = (now - state.actionStartedAt) / 1000;
          rightTarget.x += 0.76;
          rightTarget.z -= 0.62;
          headTarget.x += 0.20 + Math.sin(elapsed * 2.0) * 0.025;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        } else if (currentAction === 'stop') {
          const elapsed = (now - state.actionStartedAt) / 1000;
          rightTarget.x += 1.18;
          rightTarget.z += 0.02;
          headTarget.x += 0.025;
          if (!state.actionCompleted && !actionHeldForSpeech && actionElapsedMs >= currentActionDurationMs) {
            state.actionCompleted = true;
            completionRef.current?.();
          }
        }

        if (anchors.rightArm) {
          anchors.rightArm.rotation.x = THREE.MathUtils.damp(anchors.rightArm.rotation.x, rightTarget.x, 10, dt);
          anchors.rightArm.rotation.y = THREE.MathUtils.damp(anchors.rightArm.rotation.y, rightTarget.y, 10, dt);
          anchors.rightArm.rotation.z = THREE.MathUtils.damp(anchors.rightArm.rotation.z, rightTarget.z, 10, dt);
        }
        if (anchors.leftArm) {
          anchors.leftArm.rotation.x = THREE.MathUtils.damp(anchors.leftArm.rotation.x, leftTarget.x, 10, dt);
          anchors.leftArm.rotation.y = THREE.MathUtils.damp(anchors.leftArm.rotation.y, leftTarget.y, 10, dt);
          anchors.leftArm.rotation.z = THREE.MathUtils.damp(anchors.leftArm.rotation.z, leftTarget.z, 10, dt);
        }
        // The wrist grips intentionally inherit the arm rotations. Held gear therefore stays
        // registered to the hand through waves/poses instead of counter-rotating away from it.
        // Apply all three head axes: nod/think/facepalm use pitch (X), shake uses yaw (Y), and
        // shrug uses roll (Z). Previously only Y was applied, making Nod/Agree look inactive.
        if (anchors.head) dampHeadRotation(anchors.head.rotation, headTarget, dt);
      }
      renderer.render(scene, camera);
    };
    animate(performance.now());

    return () => {
      state.disposed = true;
      window.clearTimeout(state.loadTimeout);
      cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
      loadingStatus.remove();
      state.loadErrorStatus?.remove();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.filter(Boolean).forEach((material) => {
          Object.values(material).forEach((value) => { if (value?.isTexture) value.dispose(); });
          material.dispose();
        });
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      if (sceneState.current === state) sceneState.current = null;
    };
  }, []);

  // Every user message can ask the stage to settle back to its default orientation. This resets
  // avatar yaw and camera elevation without remounting the GLB or disturbing the character rig.
  useEffect(() => {
    const state = sceneState.current;
    if (!state || state.disposed) return;
    state.avatarPivot.rotation.set(0, 0, 0);
    state.dragRef.active = false;
    state.dragRef.rotationY = 0;
    state.camera.position.copy(state.defaultCameraPosition);
    state.camera.lookAt(state.cameraTarget);
    const offset = state.camera.position.clone().sub(state.cameraTarget);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    state.dragRef.cameraRadius = spherical.radius;
    state.dragRef.cameraTheta = spherical.theta;
    state.dragRef.cameraPhi = spherical.phi;
  }, [resetViewKey]);

  return <div className={`character-canvas${isSpeaking ? ' character-speaking' : ''}`} ref={mountRef} aria-label="Interactive 3D Wemmbu model. His existing face texture animates between closed and open mouth shapes based on audio activity while he speaks. Drag horizontally to rotate the upright character; drag vertically to change camera elevation." />;
}
