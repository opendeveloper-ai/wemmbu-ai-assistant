import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const models = path.join(root, 'public', 'models');

function readGlb(file) {
  const data = fs.readFileSync(path.join(models, file));
  assert.equal(data.toString('ascii', 0, 4), 'glTF');
  let offset = 12;
  let json;
  let binary;
  while (offset < data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    offset += 8;
    const chunk = data.subarray(offset, offset + length);
    offset += length;
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/[\0 ]+$/g, ''));
    if (type === 'BIN\0') binary = chunk;
  }
  assert.ok(json && binary, `${file} must contain JSON and BIN GLB chunks`);
  return { json, binary };
}

function embeddedImage(glb, imageIndex) {
  const image = glb.json.images[imageIndex];
  const view = glb.json.bufferViews[image.bufferView];
  const start = view.byteOffset || 0;
  return glb.binary.subarray(start, start + view.byteLength);
}

for (const [glbName, imageIndex, pngName] of [
  ['mace.glb', 0, 'mace-skin.png'],
  ['totem_of_undying.glb', 0, 'totem-basecolor.png'],
  ['totem_of_undying.glb', 1, 'totem-metalrough.png'],
]) {
  test(`${pngName} is byte-identical to its supplied GLB image`, () => {
    const source = readGlb(glbName);
    const extracted = fs.readFileSync(path.join(models, pngName));
    assert.deepEqual(extracted, embeddedImage(source, imageIndex));
    assert.equal(extracted.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  });
}

test('settings links use the Tauri native opener and only permit HTTPS URLs', () => {
  const panel = fs.readFileSync(path.join(root, 'src', 'SettingsPanel.jsx'), 'utf8');
  assert.match(panel, /window\.__TAURI__\?\.opener/);
  assert.match(panel, /parsed\.protocol !== 'https:'/);
  assert.equal((panel.match(/onClick=\{\(event\) => openSettingsExternalUrl\(event,/g) || []).length, 4);
});

test('Tauri registers the opener plugin and grants only default web URL access', () => {
  const main = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
  const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
  assert.match(main, /tauri_plugin_opener::init\(\)/);
  assert.ok(capability.permissions.includes('opener:allow-default-urls'));
  assert.ok(capability.windows.includes('main'));
});

test('chestplate fitting includes geometry-derived front-frame calibration', () => {
  const stage = fs.readFileSync(path.join(root, 'src', 'CharacterStage.jsx'), 'utf8');
  assert.match(stage, /alignArmorFrontToAvatarFrame\(fragments, sourceBounds, label\)/);
  assert.match(stage, /measuredFrontNormal/);
  assert.match(stage, /setFromUnitVectors\(measuredFront, avatarFront\)/);
});
