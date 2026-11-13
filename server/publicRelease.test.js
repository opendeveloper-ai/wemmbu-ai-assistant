import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

test('public app title no longer displays Prototype', () => {
  const app = read('src/App.jsx');
  const html = read('index.html');
  const css = read('src/style.css');

  assert.doesNotMatch(app, /prototype-label|>\s*PROTOTYPE\s*</i);
  assert.doesNotMatch(html, /<title>[^<]*prototype/i);
  assert.doesNotMatch(html, /assistant prototype/i);
  assert.doesNotMatch(css, /\.prototype-label\b/);
});

test('package names and versions are consistent for the public source package', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml');

  assert.equal(pkg.name, 'wemmbu-ai-assistant');
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(tauri.version, pkg.version);
  assert.match(cargo, new RegExp(`version = "${pkg.version.replaceAll('.', '\\.')}"`));
});

test('creator-specific Fish Audio reference is not preconfigured in public defaults', () => {
  const server = read('server/index.js');
  const settingsPanel = read('src/SettingsPanel.jsx');
  const creatorVoiceRef = 'eab6c979df6b493f9db5a5cb82274c32';

  assert.doesNotMatch(server, new RegExp(creatorVoiceRef, 'i'));
  assert.doesNotMatch(settingsPanel, new RegExp(creatorVoiceRef, 'i'));
  assert.match(server, /fishReferenceId:\s*''/);
  assert.match(settingsPanel, /fishReferenceId:\s*''/);
});

test('release documentation warns that assets and software licence need review', () => {
  const readme = read('README.md');
  const checklist = read('PUBLIC-RELEASE-CHECKLIST.md');
  const assets = read('THIRD_PARTY_ASSETS.md');

  assert.match(readme, /no root `LICENSE` file/i);
  assert.match(checklist, /armour GLBs/i);
  assert.match(assets, /redistribution permission are not documented/i);
});

test('private local data paths stay ignored by git', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /data\/settings\.json/);
  assert.match(gitignore, /data\/sessions\.json/);
  assert.match(gitignore, /data\/memory\/memories\.sqlite/);
  assert.match(gitignore, /\.env/);
  assert.equal(fs.existsSync(path.resolve('data/settings.json')), false);
  assert.equal(fs.existsSync(path.resolve('data/memory/sqlite-migration.json')), false);
});
