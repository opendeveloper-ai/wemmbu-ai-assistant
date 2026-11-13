import fs from 'node:fs/promises';
import path from 'node:path';

const distModels = path.resolve('dist', 'models');
const requiredAssets = [
  'high-fidelity_wemmbu_render.glb',
  'wemmbu-skin.png',
  'helmet.glb',
  'chestplate.glb',
  'leggings.glb',
  'boots.glb',
  'mace.glb',
  'totem_of_undying.glb',
  'mace-skin.png',
  'totem-basecolor.png',
  'totem-metalrough.png',
];

for (const name of requiredAssets) {
  const file = path.join(distModels, name);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(`Required character asset is missing from Vite output: ${file}`);
  }
  console.log(`Verified ${name} (${stat.size} bytes)`);
}
console.log('All original character, armor and equipment assets are present in dist/models.');
