import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const glbPath = resolve(root, 'public/models/high-fidelity_wemmbu_render.glb');
const skinPath = resolve(root, 'public/models/wemmbu-skin.png');
const stagePath = resolve(root, 'src/CharacterStage.jsx');

function readGlb(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'original avatar must be a GLB');
  assert.equal(buffer.readUInt32LE(4), 2, 'GLB version must be 2');
  let offset = 12;
  let json;
  let binary;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    offset += 8;
    const chunk = buffer.subarray(offset, offset + length);
    offset += length;
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/[\0 ]+$/g, ''));
    if (type === 'BIN\0') binary = chunk;
  }
  assert.ok(json && binary, 'GLB must contain JSON and BIN chunks');
  return { json, binary };
}

test('external Wemmbu skin PNG is byte-identical to the original GLB embedded atlas', async () => {
  const [glbBytes, skinBytes] = await Promise.all([readFile(glbPath), readFile(skinPath)]);
  const { json, binary } = readGlb(glbBytes);
  const image = json.images?.[0];
  assert.equal(image?.mimeType, 'image/png');
  const view = json.bufferViews?.[image.bufferView];
  assert.ok(view, 'embedded skin must reference a valid buffer view');
  const start = view.byteOffset || 0;
  const embedded = binary.subarray(start, start + view.byteLength);
  assert.deepEqual(skinBytes, embedded);
  assert.equal(skinBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('avatar stage explicitly applies the local skin PNG before exposing the rig', async () => {
  const source = await readFile(stagePath, 'utf8');
  assert.match(source, /AVATAR_SKIN_URL\s*=\s*`\$\{PUBLIC_BASE_URL\}models\/wemmbu-skin\.png`/);
  assert.match(source, /new THREE\.TextureLoader\(\)\.loadAsync\(AVATAR_SKIN_URL\)/);
  assert.match(source, /applyAvatarSkinTexture\(model, skinTexture\)/);
  assert.match(source, /THREE\.NearestFilter/);
});

test('production build verification checks all original wearable and equipment GLBs plus the skin PNG', async () => {
  const script = await readFile(resolve(root, 'scripts/verify-dist-character-assets.mjs'), 'utf8');
  for (const asset of [
    'high-fidelity_wemmbu_render.glb', 'wemmbu-skin.png', 'helmet.glb',
    'chestplate.glb', 'leggings.glb', 'boots.glb', 'mace.glb', 'totem_of_undying.glb',
  ]) assert.ok(script.includes(asset), `production asset check must include ${asset}`);
});
