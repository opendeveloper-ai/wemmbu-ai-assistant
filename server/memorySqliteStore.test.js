import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from './memoryStore.js';
import { SqliteMemoryStore, MEMORY_LIMITS } from './memorySqliteStore.js';

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-sqlite-memory-'));
  const store = new SqliteMemoryStore(directory);
  await store.init();
  t.after(async () => { try { await store.close(); } catch {} await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, store };
}
const input = (overrides = {}) => ({ title: 'Wemmbu architecture', content: 'The project uses React, Three.js, and a local Node backend.', category: 'project', tags: ['wemmbu', 'architecture'], importance: 4, ...overrides });

test('SQLite migrates a legacy JSON store without losing records or tombstones', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-migrate-json-'));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const legacy = new MemoryStore(directory); await legacy.init();
  const first = await legacy.create(input());
  const trashed = await legacy.create(input({ title: 'Old preference', category: 'preference', content: 'Prefers a dark interface.' }));
  await legacy.softDelete(trashed.id);
  const sqlite = new SqliteMemoryStore(directory); await sqlite.init();
  assert.equal(sqlite.get(first.id).title, first.title);
  assert.equal(sqlite.list().total, 1);
  assert.equal(sqlite.list({ deletedOnly: true }).total, 1);
  assert.equal(await fs.access(path.join(directory, 'memories.json')).then(() => true), true, 'legacy JSON is preserved as migration archive');
  assert.equal(await fs.access(path.join(directory, 'sqlite-migration.json')).then(() => true), true);
  await sqlite.close();
});

test('oversized legacy data fails migration without leaving a partial SQLite database', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-migrate-overlimit-'));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const now = Date.now();
  const memories = Array.from({ length: MEMORY_LIMITS.maxRecords + 1 }, (_, index) => ({
    id: randomUUID(), title: `Legacy memory ${index}`, content: `Legacy content ${index}`, category: 'fact', tags: [], importance: 3, pinned: false,
    source: { type: 'manual', label: '' }, createdAt: now - index, updatedAt: now - index, deletedAt: null, revision: 1
  }));
  const legacyPath = path.join(directory, 'memories.json');
  await fs.writeFile(legacyPath, JSON.stringify({ schemaVersion: 1, revision: 1, updatedAt: now, memories }));
  const sqlite = new SqliteMemoryStore(directory);
  await assert.rejects(sqlite.init(), (error) => error.code === 'MIGRATION_LIMIT_EXCEEDED');
  assert.equal(await fs.access(legacyPath).then(() => true, () => false), true, 'legacy data remains intact after rejected migration');
  assert.equal(await fs.access(path.join(directory, 'memories.sqlite')).then(() => true, () => false), false, 'rejected migration does not leave an empty SQLite database');
});

test('SQLite CRUD, FTS relevance, revisions, concurrent writes, and restart persistence work', async (t) => {
  const { directory, store } = await temporary(t);
  const first = await store.create(input());
  await store.create(input({ title: 'Coffee preference', content: 'Likes dark roast coffee.', category: 'preference', tags: ['coffee'] }));
  assert.equal(store.list({ q: 'Three.js', limit: 5 }).items[0].id, first.id);
  const updated = await store.update(first.id, { title: 'Wemmbu graphics stack', pinned: true });
  assert.equal(updated.revision, 2); assert.equal(updated.pinned, true);
  const records = await Promise.all(Array.from({ length: 30 }, (_, i) => store.create(input({ title: `Concurrent ${i}`, content: `Unique concurrency marker ${i}` }))));
  assert.equal(new Set(records.map((record) => record.id)).size, 30);
  await store.close();
  const restarted = new SqliteMemoryStore(directory); await restarted.init();
  assert.equal(restarted.get(first.id).title, 'Wemmbu graphics stack');
  assert.equal(restarted.list({ q: 'concurrency marker', limit: 100 }).total, 30);
  await restarted.close();
});

test('search prefers all query terms and broadens only when strict search has no result', async (t) => {
  const { store } = await temporary(t);
  const both = await store.create(input({ title: 'Project Ember', content: 'The project is named Ember and uses SQLite indexing.' }));
  await store.create(input({ title: 'Ember color preference', content: 'Prefers ember-orange highlights.', category: 'preference' }));
  const strict = store.list({ q: 'project sqlite indexing' });
  assert.equal(strict.total, 1);
  assert.equal(strict.items[0].id, both.id);
  const broad = store.list({ q: 'project sqlite missingterm' });
  assert.ok(broad.total >= 1, 'OR fallback retains useful partial matches when no all-term result exists');
});

test('SQLite enforces new memory size and store capacity limits', async (t) => {
  const { store } = await temporary(t);
  await assert.rejects(store.create(input({ content: 'x'.repeat(MEMORY_LIMITS.maxNewContentChars + 1) })), (error) => error.statusCode === 413);
  assert.equal(store.getStatus().count, 0);
  assert.throws(() => store.importRecords(new Array(MEMORY_LIMITS.maxRecords + 1), 0, Date.now()), (error) => error.statusCode === 413);
  assert.equal(store.getStatus().count, 0, 'oversized restore data is rejected before changing the current database');
});

test('raw import is transactional, chunked, and idempotent by content hash', async (t) => {
  const { store } = await temporary(t);
  const content = '# Long notes\n\n' + ('Wemmbu memory notes about rendering and local storage.\n\n'.repeat(500));
  const first = await store.importRawDocument({ filename: 'notes.md', content });
  assert.equal(first.duplicate, false);
  assert.ok(first.created > 1);
  const second = await store.importRawDocument({ filename: 'renamed.md', content });
  assert.equal(second.duplicate, true);
  assert.equal(second.created, 0);
  assert.equal(store.getStatus().count, first.created);
  await store.createBackupSnapshot();
  const checkpoint = (await store.listBackups())[0];
  await store.restoreBackup(checkpoint.name);
  const duplicateAfterRestore = await store.importRawDocument({ filename: 'restored-again.md', content });
  assert.equal(duplicateAfterRestore.duplicate, true, 'duplicate-source hashes survive backup restore');
  await assert.rejects(store.importRawDocument({ filename: 'huge.md', content: 'x'.repeat(MEMORY_LIMITS.maxImportFileBytes + 1) }), (e) => e.statusCode === 413);
});

test('soft deletion is recoverable; permanent deletion remains deleted after backup restore', async (t) => {
  const { directory, store } = await temporary(t);
  const memory = await store.create(input({ title: 'Purge me', content: 'unique permanently deleted marker' }));
  await store.create(input({ title: 'checkpoint record' }));
  const backup = (await store.listBackups())[0]; assert.ok(backup);
  await store.softDelete(memory.id); assert.equal(store.list().total, 1);
  await store.restore(memory.id); assert.equal(store.get(memory.id).deletedAt, null);
  await store.permanentlyDelete(memory.id);
  assert.equal(store.list({ q: 'permanently deleted marker', includeDeleted: true }).total, 0);
  for (const item of await store.listBackups()) await store.restoreBackup(item.name);
  assert.equal(store.list({ q: 'permanently deleted marker', includeDeleted: true }).total, 0);
  await store.close();
  const restarted = new SqliteMemoryStore(directory); await restarted.init();
  assert.equal(restarted.list({ q: 'permanently deleted marker', includeDeleted: true }).total, 0);
  await restarted.close();
});

test('a missing SQLite database recovers from snapshots rather than importing the stale JSON archive', async (t) => {
  const { directory, store } = await temporary(t);
  const memory = await store.create(input({ title: 'Latest record' }));
  await store.close(); // clean-close checkpoint produces a fresh recovery snapshot
  // Reproduce Windows filesystem timestamp granularity: snapshots written at
  // nearly the same time can share the same mtime, so freshness must use the
  // logical revision stored in each snapshot rather than filesystem time alone.
  const snapshots = await store.listBackupFiles();
  assert.ok(snapshots.length >= 2, 'test needs an older and a fresh snapshot');
  const tiedTime = new Date(1_700_000_000_000);
  for (const snapshot of snapshots) await fs.utimes(snapshot.filePath, tiedTime, tiedTime);
  await fs.rm(path.join(directory, 'memories.sqlite'), { force: true });
  await fs.rm(path.join(directory, 'memories.sqlite-wal'), { force: true });
  await fs.rm(path.join(directory, 'memories.sqlite-shm'), { force: true });
  const recovered = new SqliteMemoryStore(directory); const status = await recovered.init();
  assert.equal(status.recovery.recovered, true);
  assert.equal(recovered.get(memory.id).title, 'Latest record');
  await recovered.close();
});

test('search benchmark smoke test remains bounded on a 1,000-record database', async (t) => {
  const { store } = await temporary(t);
  const items = [];
  for (let i=0;i<1000;i++) items.push({ action:'create', memory: input({ title:`Benchmark item ${i}`, content:`Benchmark memory marker ${i}; topic ${i%10===0?'threejs':'notes'}.`, category:i%2?'project':'note', tags:[`group-${i%20}`], importance:3 }) });
  for (let offset=0; offset<items.length; offset+=60) await store.applyBatch(items.slice(offset, offset+60));
  const samples=[];
  for(let i=0;i<25;i++){const start=performance.now();const result=store.list({q:'threejs',limit:10});samples.push(performance.now()-start);assert.ok(result.total>0);}
  samples.sort((a,b)=>a-b);
  assert.ok(samples[Math.floor(samples.length*.95)] < 100, `p95 search should stay under 100ms in this test environment; got ${samples[Math.floor(samples.length*.95)].toFixed(2)}ms`);
});


test('reviewed AI batch rejects oversized create/update content without partial writes', async (t) => {
  const { store } = await temporary(t);
  const existing = await store.create(input({ title: 'Existing project fact' }));
  const beforeCount = store.getStatus().count;
  await assert.rejects(store.applyBatch([
    { action: 'create', memory: input({ title: 'Valid first item', content: 'This must not partially save.' }) },
    { action: 'create', memory: input({ title: 'Oversized item', content: 'x'.repeat(MEMORY_LIMITS.maxAiMemoryChars + 1) }) }
  ]), (error) => error.code === 'AI_MEMORY_TOO_LONG');
  assert.equal(store.getStatus().count, beforeCount);
  assert.equal(store.list({ q: 'Valid first item' }).total, 0);
  await assert.rejects(store.applyBatch([
    { action: 'update', id: existing.id, memory: { content: 'x'.repeat(MEMORY_LIMITS.maxAiMemoryChars + 1) } }
  ]), (error) => error.code === 'AI_MEMORY_TOO_LONG');
  assert.equal(store.get(existing.id).content, 'The project uses React, Three.js, and a local Node backend.');
});
