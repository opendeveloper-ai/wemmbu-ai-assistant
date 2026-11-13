import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const stageSource = await readFile(new URL('../src/CharacterStage.jsx', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('chat status/count/new-chat subbar and drag instruction are removed without removing history navigation', () => {
  assert.doesNotMatch(appSource, /className="chat-subbar"/);
  assert.doesNotMatch(appSource, /className="drag-hint"/);
  assert.match(appSource, /className=\{`history-toggle-btn/);
  assert.match(appSource, /className="chat-sessions-sidebar"/);
  assert.match(appSource, /className="new-chat-btn"/);
});

test('equipment action buttons keep the same styled treatment as gesture buttons', () => {
  assert.match(cssSource, /\.action-equipment-row\s*>\s*button,\s*\.gesture-action-grid\s*>\s*button/);
  assert.match(cssSource, /\.action-equipment-row\s*>\s*button:focus-visible,\s*\.gesture-action-grid\s*>\s*button:focus-visible/);
});

test('mace and Totem are positioned at the lower wrist and use visible grip palms', () => {
  assert.equal((stageSource.match(/mainWrist\.position\.set\(0, -0\.75, 0\)/g) || []).length, 1);
  assert.equal((stageSource.match(/offWrist\.position\.set\(0, -0\.75, 0\)/g) || []).length, 1);
  assert.match(stageSource, /mace\.position\.set\(0, -0\.005, -0\.16\)/);
  assert.match(stageSource, /mace\.rotation\.z = 0\.18/);
  assert.match(stageSource, /totem\.position\.set\(0\.035, -0\.005, -0\.16\)/);
  assert.match(stageSource, /totem\.rotation\.set\(0, 0\.16, 0\)/);
  assert.match(stageSource, /loadAccessoryModel\([\s\S]*TOTEM_MODEL_URL, totem, 0\.38[\s\S]*anchorAtGrip: true, gripBandFraction: 0\.18/);
  assert.match(stageSource, /const maceGripPalm = makeGripPalm\('main-hand-grip-palm'\)/);
  assert.match(stageSource, /const totemGripPalm = makeGripPalm\('off-hand-grip-palm'\)/);
  assert.match(stageSource, /anchorAtGrip: true, gripBandFraction: 0\.10/);
  assert.match(stageSource, /gripAnchor\.copy\(gripSum\.multiplyScalar\(1 \/ gripCount\)\)/);
  assert.match(stageSource, /new THREE\.BoxGeometry\(0\.16, 0\.13, 0\.105\)/);
  assert.match(stageSource, /gear\.maceGripPalm\.visible = currentEquipment\.maceOn/);
  assert.match(stageSource, /gear\.totemGripPalm\.visible = currentEquipment\.totemOn/);
});


test('dark theme covers 3D stage controls and scene floor/platform materials', () => {
  assert.match(cssSource, /html\[data-theme=\"dark\"\] \.quick-actions\s*\{/);
  assert.match(cssSource, /html\[data-theme=\"dark\"\] \.circle-control:not\(\.play-control\)/);
  assert.match(stageSource, /floorMaterial\.color\.set\(dark \? '#172234' : '#eef3fb'\)/);
  assert.match(stageSource, /platformMaterial\.color\.set\(dark \? '#2a3850' : '#e8eef9'\)/);
  assert.match(stageSource, /themeObserver\.observe\(document\.documentElement/);
  assert.match(stageSource, /themeObserver\.disconnect\(\)/);
});
