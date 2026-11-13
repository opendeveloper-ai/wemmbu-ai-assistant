import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { apiUrl } from './api.js';

const originalWindow = globalThis.window;

test('desktop WebView routes local API requests to the managed loopback service', () => {
  globalThis.window = { location: { protocol: 'http:', hostname: 'tauri.localhost' } };
  assert.equal(apiUrl('/api/health'), 'http://127.0.0.1:8787/api/health');
  assert.equal(apiUrl('/api/chat/stream'), 'http://127.0.0.1:8787/api/chat/stream');
});

test('Tauri custom protocol uses the managed loopback API', () => {
  globalThis.window = { location: { protocol: 'tauri:', hostname: 'localhost' } };
  assert.equal(apiUrl('/api/settings'), 'http://127.0.0.1:8787/api/settings');
});

test('browser development keeps relative API paths for the Vite proxy', () => {
  globalThis.window = { location: { protocol: 'http:', hostname: '127.0.0.1' } };
  assert.equal(apiUrl('/api/sessions'), '/api/sessions');
});

test('API helper rejects non-API paths instead of turning them into arbitrary URLs', () => {
  globalThis.window = { location: { protocol: 'http:', hostname: 'tauri.localhost' } };
  assert.throws(() => apiUrl('https://attacker.example'), TypeError);
});

test.after(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});


test('SettingsPanel routes every settings API request through apiUrl', async () => {
  const source = await readFile(new URL('./SettingsPanel.jsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ apiUrl \} from ['"]\.\/api\.js['"]/);
  assert.doesNotMatch(source, /fetch\(\s*['"]\/api\//);
  for (const endpoint of ['/api/settings', '/api/test', '/api/tts']) {
    assert.ok(source.includes(`fetch(apiUrl('${endpoint}')`), `Missing apiUrl routing for ${endpoint}`);
  }
});
