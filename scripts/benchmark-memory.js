import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { SqliteMemoryStore } from '../server/memorySqliteStore.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wemmbu-memory-benchmark-'));
const store = new SqliteMemoryStore(directory);
const percentile = (values, p) => [...values].sort((a,b)=>a-b)[Math.min(values.length - 1, Math.floor(values.length * p))] || 0;
const timed = async (fn) => { const start = performance.now(); await fn(); return performance.now() - start; };
try {
  await store.init();
  const base = Date.now();
  const seed = Array.from({ length: 9_900 }, (_, i) => ({
    id: randomUUID(), title: `Benchmark memory ${i}`, content: `Synthetic test memory ${i} for project retrieval, React, Three.js and durable local storage.`,
    category: i % 3 === 0 ? 'project' : i % 3 === 1 ? 'preference' : 'note', tags: [`group-${i % 30}`, i % 3 === 0 ? 'threejs' : 'general'],
    importance: i % 5 + 1, pinned: i % 100 === 0, source: { type: 'system', label: 'isolated performance fixture' },
    createdAt: base - i * 1000, updatedAt: base - i * 500, deletedAt: null, revision: 1
  }));
  const seedStart = performance.now();
  store.importRecords(seed, 0, base);
  const seedMs = performance.now() - seedStart;
  const searches = [];
  for (let i=0;i<100;i++) searches.push(await timed(() => store.list({ q: i % 2 ? 'Three.js project group-12' : 'group-12', limit: 10 })));
  const creates=[]; const updates=[]; const deletes=[];
  for (let i=0;i<30;i++) {
    let record;
    creates.push(await timed(async()=>{record=await store.create({title:`Measured create ${i}`,content:`Measured local memory mutation ${i}`,category:'fact',tags:['benchmark'],importance:3});}));
    updates.push(await timed(()=>store.update(record.id,{pinned:true})));
    deletes.push(await timed(()=>store.softDelete(record.id)));
  }
  console.log(JSON.stringify({
    database: 'SQLite + FTS5', seededRecords: seed.length, seedMs: Number(seedMs.toFixed(2)),
    searchMs: { p50: Number(percentile(searches,.50).toFixed(2)), p95: Number(percentile(searches,.95).toFixed(2)), max: Number(Math.max(...searches).toFixed(2)) },
    createMs: { p50: Number(percentile(creates,.50).toFixed(2)), p95: Number(percentile(creates,.95).toFixed(2)) },
    updateMs: { p50: Number(percentile(updates,.50).toFixed(2)), p95: Number(percentile(updates,.95).toFixed(2)) },
    softDeleteMs: { p50: Number(percentile(deletes,.50).toFixed(2)), p95: Number(percentile(deletes,.95).toFixed(2)) },
    status: store.getStatus()
  }, null, 2));
} finally { await store.close(); await fs.rm(directory, { recursive: true, force: true }); }
