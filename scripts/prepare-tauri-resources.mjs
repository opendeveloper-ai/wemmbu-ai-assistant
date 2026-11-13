import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = path.join(projectRoot, 'src-tauri', 'resources');
const appRoot = path.join(resourceRoot, 'app');
const runtimeDir = path.join(resourceRoot, 'runtime');
const requireWindowsRuntime = process.argv.includes('--windows');

const runtimeFiles = [
  ['server/index.js', 'server/index.js'],
  ['server/httpCors.js', 'server/httpCors.js'],
  ['server/memoryEngine.js', 'server/memoryEngine.js'],
  ['server/memorySqliteStore.js', 'server/memorySqliteStore.js'],
  ['server/memoryStore.js', 'server/memoryStore.js'],
  ['server/memoryTools.js', 'server/memoryTools.js'],
  ['shared/characterActions.js', 'shared/characterActions.js'],
];

await fs.rm(appRoot, { recursive: true, force: true });
for (const [source, destination] of runtimeFiles) {
  const from = path.join(projectRoot, source);
  const to = path.join(appRoot, destination);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}
await fs.writeFile(path.join(appRoot, 'package.json'), '{\n  "private": true,\n  "type": "module"\n}\n');
await fs.mkdir(runtimeDir, { recursive: true });

if (requireWindowsRuntime && (process.platform !== 'win32' || process.arch !== 'x64')) {
  throw new Error('The Windows NSIS installer must be prepared on a Windows x64 runner.');
}

if (process.platform === 'win32' && process.arch === 'x64') {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (requireWindowsRuntime && (major < 24 || (major === 24 && minor < 15))) {
    throw new Error(`Node.js 24.15.0 or newer is required to build the installer; found ${process.version}.`);
  }

  // Do not assume Node was installed in D:\node.js (or any other fixed path).
  // The executable used by this process is the runtime that gets bundled.
  const nodeExecutable = await fs.realpath(process.execPath).catch(() => process.execPath);
  const nodeDirectory = path.dirname(nodeExecutable);
  const licenseDestination = path.join(runtimeDir, 'NODE-LICENSE.txt');
  const licenseCandidates = [
    process.env.NODE_LICENSE_FILE,
    path.join(nodeDirectory, 'LICENSE'),
    path.join(nodeDirectory, 'LICENSE.txt'),
    path.join(nodeDirectory, '..', 'LICENSE'),
    path.join(nodeDirectory, '..', 'LICENSE.txt'),
    process.env.NODE_HOME ? path.join(process.env.NODE_HOME, 'LICENSE') : undefined,
    process.env.NODE_HOME ? path.join(process.env.NODE_HOME, 'LICENSE.txt') : undefined,
    process.env.NVM_SYMLINK ? path.join(process.env.NVM_SYMLINK, 'LICENSE') : undefined,
    path.join(nodeDirectory, '..', 'share', 'doc', 'node', 'LICENSE'),
  ].filter(Boolean);

  let licenseSource;
  for (const candidate of [...new Set(licenseCandidates.map((item) => path.resolve(item)))]) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        licenseSource = candidate;
        break;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
  }

  await fs.copyFile(nodeExecutable, path.join(runtimeDir, 'node.exe'));
  if (licenseSource) {
    await fs.copyFile(licenseSource, licenseDestination);
    console.log(`Bundled Node.js ${process.version} runtime and license file from ${licenseSource}.`);
  } else {
    // Some Windows installers place node.exe on PATH without installing the
    // upstream LICENSE file beside it. Preserve a clear notice and, most
    // importantly, do not abort an otherwise valid installer build.
    const notice = [
      'Node.js Runtime License Notice',
      '===============================',
      '',
      `Bundled runtime: Node.js ${process.version} (${process.arch})`,
      'The complete upstream Node.js license bundle was not found on this build machine.',
      'Node.js and its bundled components are distributed under their respective open-source licenses.',
      'The authoritative license texts are available from the Node.js project:',
      'https://github.com/nodejs/node/blob/v24.x/LICENSE',
      '',
      'To include the complete license bundle in this installer, set NODE_LICENSE_FILE',
      'to the LICENSE file from the matching official Node.js Windows distribution before building.',
    ].join('\n');
    await fs.writeFile(licenseDestination, `${notice}\n`, 'utf8');
    console.warn(
      'WARNING: No Node.js LICENSE file was found beside the active runtime. ' +
      'Installer staging will continue with a license notice. For a release build, ' +
      'set NODE_LICENSE_FILE to the full LICENSE file from the matching official Node.js distribution.'
    );
  }
} else if (requireWindowsRuntime) {
  throw new Error('A Windows Node.js runtime could not be staged.');
}

console.log('Prepared minimal Wemmbu API resources for Tauri.');
