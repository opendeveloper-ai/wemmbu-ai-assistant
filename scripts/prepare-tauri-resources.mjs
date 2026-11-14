import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = path.join(projectRoot, 'src-tauri', 'resources');
const appRoot = path.join(resourceRoot, 'app');
const runtimeDir = path.join(resourceRoot, 'runtime');

const requestedPlatforms = new Map([
  ['--windows', 'win32'],
  ['--linux', 'linux'],
  ['--macos', 'darwin'],
]);
const requestedPlatformFlag = [...requestedPlatforms.keys()].find((flag) => process.argv.includes(flag));
const requestedPlatform = requestedPlatformFlag ? requestedPlatforms.get(requestedPlatformFlag) : null;

const runtimeFiles = [
  ['server/index.js', 'server/index.js'],
  ['server/httpCors.js', 'server/httpCors.js'],
  ['server/memoryEngine.js', 'server/memoryEngine.js'],
  ['server/memorySqliteStore.js', 'server/memorySqliteStore.js'],
  ['server/memoryStore.js', 'server/memoryStore.js'],
  ['server/memoryTools.js', 'server/memoryTools.js'],
  ['shared/characterActions.js', 'shared/characterActions.js'],
];

function isSupportedNodeVersion(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (![major, minor, patch].every(Number.isFinite)) return false;
  return major > 24 || (major === 24 && minor >= 15);
}

async function findNodeLicense(nodeDirectory) {
  const candidates = [
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

  for (const candidate of [...new Set(candidates.map((item) => path.resolve(item)))]) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}

await fs.rm(appRoot, { recursive: true, force: true });
for (const [source, destination] of runtimeFiles) {
  const from = path.join(projectRoot, source);
  const to = path.join(appRoot, destination);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}
await fs.writeFile(path.join(appRoot, 'package.json'), '{\n  "private": true,\n  "type": "module"\n}\n');
await fs.mkdir(runtimeDir, { recursive: true });

// `tauri:prepare` is also used by local development; only release build commands
// pass a platform flag and stage a bundled Node runtime.
if (requestedPlatform) {
  if (process.platform !== requestedPlatform) {
    throw new Error(`Requested ${requestedPlatformFlag} runtime staging on ${process.platform}. Build on the matching OS runner.`);
  }
  if (!['x64', 'arm64'].includes(process.arch)) {
    throw new Error(`Unsupported ${process.platform} architecture for bundled Node.js: ${process.arch}.`);
  }
  if (!isSupportedNodeVersion(process.versions.node)) {
    throw new Error(`Node.js 24.15.0 or newer is required to build the installer; found ${process.version}.`);
  }

  const runtimeFileName = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodeExecutable = await fs.realpath(process.execPath).catch(() => process.execPath);
  const nodeDirectory = path.dirname(nodeExecutable);
  const runtimeDestination = path.join(runtimeDir, runtimeFileName);
  await fs.copyFile(nodeExecutable, runtimeDestination);
  if (process.platform !== 'win32') {
    await fs.chmod(runtimeDestination, 0o755);
  }

  const licenseSource = await findNodeLicense(nodeDirectory);
  const licenseDestination = path.join(runtimeDir, 'NODE-LICENSE.txt');
  if (licenseSource) {
    await fs.copyFile(licenseSource, licenseDestination);
    console.log(`Bundled Node.js ${process.version} runtime and license from ${licenseSource}.`);
  } else {
    const notice = [
      'Node.js Runtime License Notice',
      '===============================',
      '',
      `Bundled runtime: Node.js ${process.version} (${process.platform}/${process.arch})`,
      'The complete upstream Node.js license bundle was not found on this build machine.',
      'Node.js and its bundled components are distributed under their respective open-source licenses.',
      'The authoritative license texts are available from the Node.js project:',
      'https://github.com/nodejs/node/blob/v24.x/LICENSE',
      '',
      'Set NODE_LICENSE_FILE to the LICENSE file from the matching official Node.js distribution',
      'before building to include the complete upstream license text.',
    ].join('\n');
    await fs.writeFile(licenseDestination, `${notice}\n`, 'utf8');
    console.warn('WARNING: Node.js LICENSE file not found; included a license notice instead.');
  }
  console.log(`Staged native Node.js runtime ${runtimeFileName} for ${process.platform}/${process.arch}.`);
} else {
  console.log('No packaged Node.js runtime staged (development preparation mode).');
}

console.log('Prepared minimal Wemmbu API resources for Tauri.');
