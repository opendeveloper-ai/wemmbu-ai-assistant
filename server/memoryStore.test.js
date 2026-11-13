import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore, MemoryStoreError, MEMORY_SCHEMA_VERSION, MEMORY_PURGE_SCHEMA_VERSION } from './memoryStore.js';

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-memory-test-'));
  const store = new MemoryStore(directory);
  await store.init();
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  return { store, directory };
}

const newMemory = (overrides = {}) => ({
  title: 'Wemmbu project stack',
  content: 'The Wemmbu assistant uses React, Three.js, and a local Node.js backend.',
  category: 'project',
  tags: ['wemmbu', 'architecture'],
  importance: 4,
  source: { type: 'manual', label: 'test' },
  ...overrides
});

test('initializes a versioned local store and persists across restart', async (t) => {
  const { store, directory } = await makeStore(t);
  assert.equal(store.getStatus().schemaVersion, MEMORY_SCHEMA_VERSION);
  assert.equal(store.getStatus().count, 0);
  const memory = await store.create(newMemory());
  const persisted = JSON.parse(await fs.readFile(path.join(directory, 'memories.json'), 'utf8'));
  assert.equal(persisted.schemaVersion, MEMORY_SCHEMA_VERSION);
  assert.equal(persisted.memories[0].id, memory.id);
  const restarted = new MemoryStore(directory);
  await restarted.init();
  assert.equal(restarted.get(memory.id).title, 'Wemmbu project stack');
});

test('validates fields and rejects invalid categories, blank content and oversized text', async (t) => {
  const { store } = await makeStore(t);
  await assert.rejects(store.create(newMemory({ content: '   ' })), MemoryStoreError);
  await assert.rejects(store.create(newMemory({ category: 'not-a-category' })), /Category must be one of/);
  await assert.rejects(store.create(newMemory({ title: 'x'.repeat(161) })), /160 characters or fewer/);
  await assert.rejects(store.create(newMemory({ tags: 'not an array' })), /Tags must be an array/);
  assert.equal(store.getStatus().count, 0, 'validation errors must not persist partial records');
});

test('creates, updates and revision-bumps a record without mutating the returned object', async (t) => {
  const { store } = await makeStore(t);
  const created = await store.create(newMemory());
  created.title = 'tampered by caller';
  const updated = await store.update(created.id, { title: 'Updated title', pinned: true, tags: ['important'] });
  assert.equal(updated.title, 'Updated title');
  assert.equal(updated.revision, 2);
  assert.equal(updated.pinned, true);
  assert.deepEqual(updated.tags, ['important']);
  assert.equal(store.get(updated.id).title, 'Updated title');
  assert.equal(store.getStatus().revision, 2);
});

test('indexes title, category, tags and content for relevance-ranked search', async (t) => {
  const { store } = await makeStore(t);
  const first = await store.create(newMemory());
  await store.create({ title: 'Coffee preference', content: 'Likes dark roast coffee.', category: 'preference', tags: ['coffee'] });
  const results = store.list({ q: 'Wemmbu project', limit: 10 });
  assert.equal(results.total, 1);
  assert.equal(results.items[0].id, first.id);
  assert.equal(store.list({ tag: 'COFFEE' }).total, 1);
  assert.equal(store.list({ category: 'preference' }).total, 1);
});

test('soft delete hides a record by default, allows restore, and supports permanent deletion', async (t) => {
  const { store } = await makeStore(t);
  const record = await store.create(newMemory());
  await store.softDelete(record.id);
  assert.equal(store.list().total, 0);
  assert.equal(store.list({ includeDeleted: true }).total, 1);
  assert.equal(store.getStatus().deletedCount, 1);
  const restored = await store.restore(record.id);
  assert.equal(restored.deletedAt, null);
  assert.equal(store.list().total, 1);
  await store.permanentlyDelete(record.id);
  assert.equal(store.list({ includeDeleted: true }).total, 0);
  assert.ok((await store.listBackups()).length > 0, 'pre-change backups should remain recoverable');
});

test('deletedOnly lists only trashed memories for the Memory page', async (t) => {
  const { store } = await makeStore(t);
  const active = await store.create(newMemory({ title: 'Active memory' }));
  const deleted = await store.create(newMemory({ title: 'Trashed memory' }));
  await store.softDelete(deleted.id);
  const trash = store.list({ deletedOnly: true, includeDeleted: true });
  assert.equal(trash.total, 1);
  assert.equal(trash.items[0].id, deleted.id);
  assert.notEqual(trash.items[0].id, active.id);
  assert.equal(store.list({ deletedOnly: true }).total, 1);
});

test('serializes concurrent writes without losing records', async (t) => {
  const { store } = await makeStore(t);
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => store.create({
    title: `Concurrent memory ${index}`,
    content: `Unique content marker-${index}`,
    category: 'fact'
  })));
  assert.equal(new Set(results.map((record) => record.id)).size, 30);
  assert.equal(store.getStatus().count, 30);
  const reloaded = new MemoryStore(store.directory);
  await reloaded.init();
  assert.equal(reloaded.list({ limit: 100 }).total, 30);
});

test('recovers the latest valid pre-write backup when the main file is corrupted', async (t) => {
  const { store, directory } = await makeStore(t);
  const first = await store.create(newMemory({ title: 'First durable memory' }));
  await store.create(newMemory({ title: 'Second durable memory' }));
  await fs.writeFile(path.join(directory, 'memories.json'), '{ this is not valid JSON', 'utf8');
  const recovered = new MemoryStore(directory);
  const status = await recovered.init();
  assert.equal(status.recovery.recovered, true);
  assert.equal(recovered.list().total, 1);
  assert.equal(recovered.get(first.id).title, 'First durable memory');
  assert.ok((await fs.readdir(path.join(directory, 'backups'))).some((name) => name.startsWith('memory-corrupt-')),
    'the original corrupted file should be preserved for diagnostics');
});

test('refuses to silently replace a corrupted store when there is no valid backup', async (t) => {
  const { store, directory } = await makeStore(t);
  await fs.writeFile(path.join(directory, 'memories.json'), 'bad data', 'utf8');
  const reload = new MemoryStore(directory);
  await assert.rejects(reload.init(), (error) => error.code === 'MEMORY_RECOVERY_REQUIRED');
  assert.equal(await fs.readFile(path.join(directory, 'memories.json'), 'utf8'), 'bad data');
});

test('lists and restores a selected valid backup without path traversal', async (t) => {
  const { store } = await makeStore(t);
  const original = await store.create(newMemory({ title: 'Backup baseline' }));
  await store.create(newMemory({ title: 'Later state' }));
  const backups = await store.listBackups();
  assert.ok(backups.length > 0);
  const previous = backups.find((backup) => backup.memoryCount === 1);
  assert.ok(previous);
  const result = await store.restoreBackup(previous.name);
  assert.equal(result.count, 1);
  assert.equal(store.get(original.id).title, 'Backup baseline');
  await assert.rejects(store.restoreBackup('../memories.json'), /valid memory backup name/);
});

test('limits backups and leaves no temporary write files after successful operations', async (t) => {
  const { store } = await makeStore(t);
  for (let index = 0; index < 24; index += 1) {
    await store.create({ title: `Memory ${index}`, content: `Payload ${index}` });
  }
  const names = await fs.readdir(store.directory);
  assert.ok(!names.some((name) => name.endsWith('.tmp')));
  assert.ok((await store.listBackups()).length <= 20);
});


test('applies reviewed AI memory changes as one atomic transaction', async (t) => {
  const { store } = await makeStore(t);
  const existing = await store.create(newMemory({ title: 'Wemmbu project stack', content: 'The project uses React.', category: 'project' }));
  const beforeRevision = store.getStatus().revision;
  const result = await store.applyBatch([
    { action: 'update', id: existing.id, memory: { title: 'Wemmbu project stack', content: 'The project uses React and Three.js.', category: 'project', tags: ['updated'], importance: 4, source: { type: 'ai', label: 'project.md' } } },
    { action: 'create', memory: { title: 'Interface preference', content: 'Prefers dark interfaces.', category: 'preference', tags: ['ui'], importance: 3, source: { type: 'ai', label: 'project.md' } } }
  ]);
  assert.equal(result.items.length, 2);
  assert.equal(result.status.revision, beforeRevision + 1, 'batch should increment the store revision once');
  assert.equal(store.get(existing.id).content, 'The project uses React and Three.js.');
  assert.equal(store.getStatus().count, 2);
  assert.equal(result.items[1].source.type, 'ai');
});

test('rejects an invalid reviewed batch without saving any partial changes', async (t) => {
  const { store } = await makeStore(t);
  const before = await store.create(newMemory({ title: 'Baseline' }));
  const revision = store.getStatus().revision;
  await assert.rejects(store.applyBatch([
    { action: 'create', memory: { title: 'Would be new', content: 'Must not leak into the store.' } },
    { action: 'update', id: 'missing-id', memory: { title: 'No such memory' } }
  ]), /no longer exists/);
  assert.equal(store.getStatus().revision, revision);
  assert.equal(store.list().total, 1);
  assert.equal(store.get(before.id).title, 'Baseline');
});


test('ignores and cleans stale orphaned temporary files after a simulated interrupted write', async (t) => {
  const { store, directory } = await makeStore(t);
  const saved = await store.create(newMemory({ title: 'Last durable state' }));
  const staleName = '.memories.json.12345.00000000-0000-4000-8000-000000000000.tmp';
  const recentName = '.memories.json.12345.00000000-0000-4000-8000-000000000001.tmp';
  await fs.writeFile(path.join(directory, staleName), '{ truncated', 'utf8');
  await fs.writeFile(path.join(directory, recentName), '{ in-progress', 'utf8');
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(path.join(directory, staleName), old, old);
  const restarted = new MemoryStore(directory);
  await restarted.init();
  assert.equal(restarted.get(saved.id).title, 'Last durable state', 'the old main store remains authoritative');
  await assert.rejects(fs.access(path.join(directory, staleName)));
  assert.equal(await fs.readFile(path.join(directory, recentName), 'utf8'), '{ in-progress', 'a recent temp file is not assumed stale');
});

test('permanent deletion scrubs backup snapshots and cannot be undone by backup restore', async (t) => {
  const { store, directory } = await makeStore(t);
  const secret = await store.create(newMemory({ title: 'Permanent removal target', content: 'This private marker must not reappear after permanent deletion.' }));
  await store.update(secret.id, { title: 'Permanent removal target updated' });
  await store.softDelete(secret.id);
  await store.permanentlyDelete(secret.id);
  assert.throws(() => store.get(secret.id, { includeDeleted: true }), /not found/i);
  const backupDirectory = path.join(directory, 'backups');
  for (const name of await fs.readdir(backupDirectory)) {
    if (!name.startsWith('memory-backup-')) continue;
    const content = await fs.readFile(path.join(backupDirectory, name), 'utf8');
    assert.doesNotMatch(content, new RegExp(secret.id));
    assert.doesNotMatch(content, /This private marker must not reappear/);
  }
  const backups = await store.listBackups();
  for (const backup of backups) await store.restoreBackup(backup.name);
  assert.equal(store.list({ q: 'private marker', includeDeleted: true }).total, 0);
  const restarted = new MemoryStore(directory);
  await restarted.init();
  assert.equal(restarted.list({ q: 'private marker', includeDeleted: true }).total, 0);
});

test('a durable deletion tombstone completes cleanup after simulated process interruption', async (t) => {
  const { store, directory } = await makeStore(t);
  const record = await store.create(newMemory({ title: 'Interrupted permanent deletion', content: 'This should be purged after a crash.' }));
  await store.update(record.id, { importance: 5 }); // snapshot containing the record
  await fs.writeFile(path.join(directory, 'permanent-deletions.json'), JSON.stringify({
    schemaVersion: MEMORY_PURGE_SCHEMA_VERSION, updatedAt: Date.now(), ids: [record.id]
  }), 'utf8'); // simulates crash after tombstone, before rewriting the main store
  const restarted = new MemoryStore(directory);
  const status = await restarted.init();
  assert.equal(status.recovery.recovered, true);
  assert.equal(restarted.list({ includeDeleted: true }).total, 0);
  assert.doesNotMatch(await fs.readFile(path.join(directory, 'memories.json'), 'utf8'), new RegExp(record.id));
  for (const name of await fs.readdir(path.join(directory, 'backups'))) {
    if (name.startsWith('memory-backup-')) assert.doesNotMatch(await fs.readFile(path.join(directory, 'backups', name), 'utf8'), new RegExp(record.id));
  }
});


test('fails closed when the permanent-deletion manifest is damaged', async (t) => {
  const { store, directory } = await makeStore(t);
  const memory = await store.create(newMemory({ title: 'Must stay deleted-safe' }));
  await fs.writeFile(path.join(directory, 'permanent-deletions.json'), '{broken manifest', 'utf8');
  const restarted = new MemoryStore(directory);
  await assert.rejects(restarted.init(), (error) => error.code === 'PURGE_MANIFEST_RECOVERY_REQUIRED');
  assert.match(await fs.readFile(path.join(directory, 'memories.json'), 'utf8'), new RegExp(memory.id));
  assert.equal(await fs.readFile(path.join(directory, 'permanent-deletions.json'), 'utf8'), '{broken manifest');
});


test('retrieval ranks title/topic matches above recent unrelated records', async (t) => {
  const { store } = await makeStore(t);
  const target = await store.create({ title: 'Wemmbu rendering architecture', content: 'The character stage uses Three.js and a GLB model.', category: 'project', tags: ['wemmbu', 'threejs'], importance: 4 });
  for (let index = 0; index < 15; index += 1) {
    await store.create({ title: `Recent unrelated note ${index}`, content: `Unrelated grocery note ${index} about fruit and pantry items.`, category: 'note', tags: ['grocery'], importance: 1 });
  }
  const results = store.list({ q: 'Wemmbu rendering architecture', limit: 5 });
  assert.equal(results.items[0].id, target.id);
  assert.ok(results.items.every((item) => item.id === target.id || /Wemmbu|rendering|architecture/i.test(`${item.title} ${item.content}`)));
});
