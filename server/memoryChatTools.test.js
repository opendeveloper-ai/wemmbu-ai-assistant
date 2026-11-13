import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'index.js');

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApi(t) {
  const port = await reservePort();
  const memoryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-chat-memory-'));
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-chat-data-'));
  await fs.writeFile(path.join(dataDirectory, 'settings.json'), JSON.stringify({ apiKey: 'test-only-key' }), 'utf8');
  const preload = pathToFileURL(path.join(here, 'openRouterMock.mjs')).href;
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.resolve(here, '..'),
    env: {
      ...process.env,
      AQIRON_WEMMBU_API_PORT: String(port),
      AQIRON_WEMMBU_MEMORY_DIR: memoryDirectory,
      AQIRON_WEMMBU_DATA_DIR: dataDirectory,
      AQIRON_WEMMBU_MOCK_OPENROUTER: '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${preload}`].filter(Boolean).join(' ')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(1500)]);
    if (child.exitCode === null) child.kill('SIGKILL');
    await fs.rm(memoryDirectory, { recursive: true, force: true });
    await fs.rm(dataDirectory, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Memory API exited before startup. Output: ${logs}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) { ready = true; break; }
    } catch { /* startup in progress */ }
    await delay(50);
  }
  assert.ok(ready, `Memory API failed to start. Output: ${logs}`);

  return {
    async request(route, { method = 'GET', body } = {}) {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, payload: await response.json() };
    },
    async chat(content) {
      const response = await fetch(`${base}/api/chat/stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content }], webSearch: false })
      });
      const raw = await response.text();
      assert.equal(response.status, 200, `chat failed: ${raw}`);
      const events = raw.split(/\r?\n\r?\n/).map((block) => {
        const line = block.split(/\r?\n/).find((part) => part.startsWith('data:'));
        if (!line) return null;
        try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
      }).filter(Boolean);
      const complete = events.find((event) => event.type === 'complete');
      assert.ok(complete, `No completion event. Events: ${raw}`);
      return { events, complete, raw };
    }
  };
}

test('chat tools save, retrieve, update and forget memories across the local API', async (t) => {
  const api = await startApi(t);

  const saved = await api.chat('Remember that the current project codename is Project Ember.');
  assert.match(saved.complete.reply, /saved that to memory: project codename/i);
  let records = await api.request('/api/memories?q=project%20codename');
  assert.equal(records.payload.total, 1);
  const id = records.payload.items[0].id;
  assert.equal(records.payload.items[0].source.type, 'conversation');
  assert.equal(records.payload.items[0].content, 'The current project codename is Project Ember.');

  const answer = await api.chat("What's the project codename?");
  assert.match(answer.complete.reply, /project codename is project ember/i, 'relevant saved memory should be included in the next turn context');

  const updated = await api.chat('Update my project codename to Project Azure.');
  assert.match(updated.complete.reply, /updated the saved memory/i);
  records = await api.request('/api/memories?q=project%20codename');
  assert.equal(records.payload.total, 1, 'updating should not create a duplicate record');
  assert.equal(records.payload.items[0].id, id);
  assert.equal(records.payload.items[0].content, 'The current project codename is Project Azure.');

  const forgotten = await api.chat('Forget the project codename memory.');
  assert.match(forgotten.complete.reply, /forgot that saved memory/i);
  records = await api.request('/api/memories?q=project%20codename');
  assert.equal(records.payload.total, 0, 'deleted memories must not be retrieved in normal search');
  const trash = await api.request('/api/memories?deletedOnly=true&q=project%20codename');
  assert.equal(trash.payload.total, 1, 'chat forget should use recoverable trash, not permanent deletion');
  assert.equal(trash.payload.items[0].id, id);
});

test('chat does not claim a memory mutation without successful tool output', async (t) => {
  const api = await startApi(t);
  const response = await api.chat('I wonder whether a project codename is useful.');
  assert.match(response.complete.reply, /do not have a saved project codename/i);
  const records = await api.request('/api/memories');
  assert.equal(records.payload.total, 0, 'ordinary conversation should not automatically write a memory');
});


test('a requested Explain gesture is applied alongside the full informational answer', async (t) => {
  const api = await startApi(t);
  const result = await api.chat('Explain Quantum Mechanics.');

  assert.equal(result.complete.commands.length, 1);
  assert.deepEqual(result.complete.commands[0], { type: 'character_action', action: 'explain' });
  const commandEventIndex = result.events.findIndex((event) => event.type === 'commands');
  const firstAnswerTokenIndex = result.events.findIndex((event) => event.type === 'token');
  assert.ok(commandEventIndex >= 0, 'the avatar action should be emitted as soon as the initial tool call arrives');
  assert.ok(firstAnswerTokenIndex > commandEventIndex, 'the explain gesture should be dispatched before answer tokens stream');
  assert.match(result.complete.reply, /branch of physics that describes how matter and energy behave/i);
  assert.match(result.complete.reply, /superposition|uncertainty|entanglement/i);
  assert.doesNotMatch(result.complete.reply, /^Done\s*[—-]/i);
});
