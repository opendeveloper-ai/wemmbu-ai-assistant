import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, access } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function getFreePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 12000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local API exited before health check (code ${child.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local API did not become healthy: ${lastError?.message || 'timeout'}`);
}

test('Tauri resource staging includes the shared CORS helper imported by the API server', async () => {
  const manifest = await readFile(path.join(root, 'scripts', 'prepare-tauri-resources.mjs'), 'utf8');
  assert.match(manifest, /server\/httpCors\.js/);
  const apiSource = await readFile(path.join(root, 'server', 'index.js'), 'utf8');
  assert.match(apiSource, /from ['"]\.\/httpCors\.js['"]/);
});

test('real local API accepts Tauri PUT preflight and saves settings', async (t) => {
  const port = await getFreePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wemmbu-cors-'));
  const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env: {
      ...process.env,
      AQIRON_WEMMBU_API_PORT: String(port),
      AQIRON_WEMMBU_DATA_DIR: tempDir,
      AQIRON_WEMMBU_MEMORY_DIR: path.join(tempDir, 'memory')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childOutput = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { childOutput += chunk; });
  child.stderr.on('data', (chunk) => { childOutput += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = 'http://tauri.localhost';
  await waitForHealth(`${baseUrl}/api/health`, child);

  const preflight = await fetch(`${baseUrl}/api/settings`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type'
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-methods') || '', /\bPUT\b/);

  const save = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openrouter/auto',
      apiKey: 'not-a-real-openrouter-test-key',
      fishAudioApiKey: 'not-a-real-fish-audio-test-key',
      ttsProvider: 'native',
      imageProvider: 'google'
    })
  });
  assert.equal(save.status, 200);
  assert.equal(save.headers.get('access-control-allow-origin'), origin);
  const settings = await save.json();
  assert.equal(settings.ok, true);
  assert.equal(settings.ttsProvider, 'native');
  assert.equal(settings.apiKeyConfigured, true);
  assert.equal(settings.fishAudioApiKeyConfigured, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(childOutput, /settings\.update\.received/);
  assert.match(childOutput, /settings\.update\.saved/);
  assert.doesNotMatch(childOutput, /not-a-real-openrouter-test-key|not-a-real-fish-audio-test-key/);
});
