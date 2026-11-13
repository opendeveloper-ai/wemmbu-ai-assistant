import fs from 'node:fs/promises';
import path from 'node:path';

const assetsDir = path.resolve('dist/assets');
const names = (await fs.readdir(assetsDir)).filter((name) => name.endsWith('.js'));
if (!names.length) throw new Error('No JavaScript build assets were found in dist/assets. Run npm run build first.');
const required = ['MemoryPanel', 'CharacterStage', 'SettingsPanel', 'three-core', 'three-addons', 'react-vendor'];
const missing = required.filter((chunk) => !names.some((name) => name.toLowerCase().includes(chunk.toLowerCase())));
if (missing.length) throw new Error(`Expected code-split chunks are missing: ${missing.join(', ')}. Check React.lazy imports and vite.config.js manualChunks.`);
const entries = await Promise.all(names.map(async (name) => ({ name, bytes: (await fs.stat(path.join(assetsDir, name))).size })));
const entry = entries.find((asset) => /^index-.*\.js$/i.test(asset.name));
if (!entry) throw new Error('Could not find the main index JavaScript entry chunk.');
console.log('Verified split JavaScript assets:');
for (const asset of entries.sort((a, b) => b.bytes - a.bytes)) console.log(`  ${(asset.bytes / 1024).toFixed(1).padStart(7)} KiB  ${asset.name}`);
console.log(`Main entry: ${(entry.bytes / 1024).toFixed(1)} KiB`);
if (entry.bytes > 500 * 1024) throw new Error('Main entry remains above 500 KiB; move more code behind lazy imports or manual chunks.');
console.log('Code-splitting verification PASSED.');
