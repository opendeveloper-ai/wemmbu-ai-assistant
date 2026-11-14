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

  const license = read('LICENSE');
  assert.match(readme, /GNU General Public License, version 3\.0/i);
  assert.match(license, /GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/i);
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


test('cross-platform packaging stages the native Node runtime and produces platform installers', () => {
  const pkg = JSON.parse(read('package.json'));
  const launcher = read('src-tauri/src/main.rs');
  const prepare = read('scripts/prepare-tauri-resources.mjs');
  const linuxWorkflow = read('.github/workflows/linux-tauri-installers.yml');
  const macWorkflow = read('.github/workflows/macos-tauri-installers.yml');
  const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'));

  assert.match(pkg.scripts['tauri:build:linux'], /--linux[\s\S]*--bundles deb,appimage/);
  assert.match(pkg.scripts['tauri:build:macos'], /--macos[\s\S]*--bundles dmg/);
  assert.match(launcher, /if cfg!\(target_os = "windows"\) \{ "node\.exe" \} else \{ "node" \}/);
  assert.match(prepare, /\['--windows', 'win32'\]/);
  assert.match(prepare, /\['--linux', 'linux'\]/);
  assert.match(prepare, /\['--macos', 'darwin'\]/);
  assert.match(linuxWorkflow, /bundle\/deb\/\*\.deb/);
  assert.match(linuxWorkflow, /bundle\/appimage\/\*\.AppImage/);
  assert.match(macWorkflow, /macos-26-intel/);
  assert.match(macWorkflow, /macos-26/);
  assert.equal(tauriConfig.bundle.linux.appimage.bundleMediaFramework, true);
});


test('Windows, Linux and macOS installers use shared Wemmbu branding assets', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const nsis = config.bundle.windows.nsis;
  assert.equal(nsis.installerIcon, 'icons/icon.ico');
  assert.equal(nsis.uninstallerIcon, 'icons/icon.ico');
  assert.equal(nsis.headerImage, 'installer/nsis-header.bmp');
  assert.equal(nsis.sidebarImage, 'installer/nsis-sidebar.bmp');
  assert.equal(nsis.uninstallerHeaderImage, 'installer/nsis-header.bmp');
  assert.equal(config.bundle.licenseFile, '../LICENSE');
  assert.equal(config.bundle.macOS.dmg.background, 'installer/dmg-background.png');
  assert.equal(config.bundle.license, 'GPL-3.0-only');

  for (const relativePath of [
    'src-tauri/icons/icon.png',
    'src-tauri/icons/icon.ico',
    'src-tauri/installer/wemmbu-logo.png',
    'src-tauri/installer/nsis-header.bmp',
    'src-tauri/installer/nsis-sidebar.bmp',
    'src-tauri/installer/dmg-background.png',
    'public/assets/wemmbu_logo.png',
    'LICENSE',
  ]) {
    assert.equal(fs.existsSync(path.resolve(relativePath)), true, `${relativePath} should exist`);
  }
});
