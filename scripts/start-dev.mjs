import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const defaultApiPort = Number(process.env.AQIRON_WEMMBU_API_PORT || 8787);

export function isSupportedNodeVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  return major > 24 || (major === 24 && minor >= 15);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function isWemmbuApiHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true && typeof body.apiKeyConfigured === 'boolean';
  } catch {
    return false;
  }
}

export async function resolveApiStartupPlan({
  preferredPort = 8787,
  fallbackStart = 8788,
  fallbackEnd = 8827,
  healthCheck = isWemmbuApiHealthy,
  portAvailable = isPortAvailable,
} = {}) {
  if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
    throw new Error(`Invalid API port: ${preferredPort}`);
  }

  if (await healthCheck(preferredPort)) {
    return { port: preferredPort, reuseExistingApi: true };
  }

  if (await portAvailable(preferredPort)) {
    return { port: preferredPort, reuseExistingApi: false };
  }

  for (let port = fallbackStart; port <= fallbackEnd; port += 1) {
    if (await portAvailable(port)) {
      return { port, reuseExistingApi: false };
    }
  }

  throw new Error(
    `Port ${preferredPort} is occupied by another application, and no free fallback port was found in ${fallbackStart}-${fallbackEnd}. Close the conflicting service and try again.`,
  );
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

function npmCommand() {
  return isWindows ? 'npm.cmd' : 'npm';
}

function runNpm(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand(), args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
      shell: isWindows,
    });

    child.once('error', (error) => reject(new Error(`Could not run npm. Install Node.js 24.15.0 or newer (including npm), then try again. ${error.message}`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`));
    });
  });
}

async function ensureDependencies(env) {
  const nodeModules = path.join(projectRoot, 'node_modules');
  const concurrentlyPackage = path.join(nodeModules, 'concurrently', 'package.json');
  if (await pathExists(nodeModules) && await pathExists(concurrentlyPackage)) return;

  console.log('\nFirst launch: installing project dependencies with npm ci...\n');
  await runNpm(['ci', '--no-audit', '--no-fund'], env);
}

function startDevelopmentServices({ env, uiOnly }) {
  const script = uiOnly ? 'dev:ui' : 'dev';
  console.log('');
  console.log('Wemmbu AI Assistant — development mode');
  console.log(`Project: ${projectRoot}`);
  console.log(`Frontend: http://127.0.0.1:1420`);
  console.log(`Local API: http://127.0.0.1:${env.AQIRON_WEMMBU_API_PORT}`);
  console.log('Keep this terminal open while using the application. Press Ctrl+C to stop.');
  console.log('');

  const child = spawn(npmCommand(), ['run', script], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    shell: isWindows,
  });

  let stopping = false;
  const forwardSignal = (signal) => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null) {
      try {
        child.kill(signal);
      } catch {
        child.kill();
      }
    }
  };

  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);

  child.once('error', (error) => {
    console.error(`\nCould not start the development services: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

async function main() {
  if (!isSupportedNodeVersion(process.versions.node)) {
    throw new Error(`Node.js 24.15.0 or newer is required. Current version: ${process.version}. Install the current LTS release from https://nodejs.org/ and reopen your terminal.`);
  }

  const env = { ...process.env, NODE_ENV: 'development' };
  if (!env.AQIRON_WEMMBU_API_PORT) env.AQIRON_WEMMBU_API_PORT = String(defaultApiPort);

  await ensureDependencies(env);

  if (!(await isPortAvailable(1420))) {
    throw new Error('The frontend port 1420 is already in use. Stop the other development server, then run the launcher again.');
  }

  const preferredPort = Number(env.AQIRON_WEMMBU_API_PORT);
  const plan = await resolveApiStartupPlan({ preferredPort });
  env.AQIRON_WEMMBU_API_PORT = String(plan.port);

  if (plan.reuseExistingApi) {
    console.log(`Found an existing Wemmbu API on port ${plan.port}; starting the frontend only to avoid a duplicate API process.`);
  } else if (plan.port !== preferredPort) {
    console.log(`Port ${preferredPort} is occupied by another service. Using available fallback port ${plan.port} for this Wemmbu API session.`);
  }

  startDevelopmentServices({ env, uiOnly: plan.reuseExistingApi });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nWemmbu AI Assistant could not start.\n${error.message}\n`);
    process.exitCode = 1;
  });
}
