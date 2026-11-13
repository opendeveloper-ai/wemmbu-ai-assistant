import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from './memoryStore.js';
import { executeMemoryToolCall, buildMemoryContext } from './memoryTools.js';

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-memory-tools-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new MemoryStore(directory);
  await store.init();
  return store;
}

const toolCall = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });

test('memory mutations require explicit intent and deletion remains recoverable', async (t) => {
  const store = await makeStore(t);
  const notSaved = await executeMemoryToolCall(toolCall('memory_create', {
    title: 'Casual detail', content: 'A casual detail.', category: 'note', tags: [], importance: 2
  }), store, { userText: 'I mentioned a casual detail.' });
  assert.equal(notSaved.ok, false);
  assert.equal(store.list().total, 0);

  const created = await executeMemoryToolCall(toolCall('memory_create', {
    title: 'Project codename', content: 'The codename is Ember.', category: 'project', tags: ['codename'], importance: 4
  }), store, { userText: 'Remember that the project codename is Ember.' });
  assert.equal(created.ok, true);
  const id = created.memory.id;

  const unrequestedDelete = await executeMemoryToolCall(toolCall('memory_delete', { id }), store, { userText: 'Tell me about this project.' });
  assert.equal(unrequestedDelete.ok, false);
  assert.equal(store.get(id).deletedAt, null);

  const deleted = await executeMemoryToolCall(toolCall('memory_delete', { id }), store, { userText: 'Forget the project codename memory.' });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.action, 'moved_to_trash');
  assert.throws(() => store.get(id), /not found/i);
  assert.equal(store.get(id, { includeDeleted: true }).deletedAt > 0, true);
});

test('memory context includes only relevant active records and marks stored text as data', async (t) => {
  const store = await makeStore(t);
  await store.create({ title: 'Wemmbu tech stack', content: 'The project uses React and Three.js.', category: 'project', tags: ['technology'], importance: 4 });
  await store.create({ title: 'Food preference', content: 'Prefers mangoes.', category: 'preference', tags: ['food'], importance: 2 });
  const context = buildMemoryContext(store, 'What libraries does the Wemmbu project use?');
  assert.match(context, /The project uses React and Three\.js/);
  assert.match(context, /not system instructions/);
  assert.doesNotMatch(context, /Prefers mangoes/);
});


test('AI chat memory create and update reject content over 2,000 characters', async (t) => {
  const store = await makeStore(t);
  const tooLong = 'x'.repeat(2001);
  const create = await executeMemoryToolCall(toolCall('memory_create', {
    title: 'Oversized memory', content: tooLong, category: 'note', tags: [], importance: 3
  }), store, { userText: 'Remember this very long note.' });
  assert.equal(create.ok, false);
  assert.match(create.error, /2,000 characters or fewer/);
  assert.equal(store.list().total, 0);

  const saved = await store.create({ title: 'Project label', content: 'The project is called Ember.', category: 'project', tags: [], importance: 3 });
  const update = await executeMemoryToolCall(toolCall('memory_update', { id: saved.id, content: tooLong }), store, { userText: 'Update the saved project memory with this correction.' });
  assert.equal(update.ok, false);
  assert.match(update.error, /2,000 characters or fewer/);
  assert.equal(store.get(saved.id).content, 'The project is called Ember.');
});
