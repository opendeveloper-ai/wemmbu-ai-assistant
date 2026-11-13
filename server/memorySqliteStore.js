import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStore, MemoryStoreError, MEMORY_CATEGORIES, MEMORY_SOURCE_TYPES, MEMORY_PURGE_SCHEMA_VERSION } from './memoryStore.js';

export const SQLITE_MEMORY_SCHEMA_VERSION = 2;
export const MEMORY_LIMITS = Object.freeze({
  maxRecords: 10_000,
  maxLogicalBytes: 32 * 1024 * 1024,
  maxNewContentChars: 8_000,
  maxAiMemoryChars: 2_000,
  maxImportFileBytes: 2 * 1024 * 1024,
  maxImportFiles: 25,
  maxImportBatchBytes: 10 * 1024 * 1024,
  maxBackups: 5,
  maxBackupBytes: 80 * 1024 * 1024
});

const MAX_TITLE_LENGTH = 160;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const MAX_SOURCE_LABEL_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 1_000_000;
const SNAPSHOT_INTERVAL_MUTATIONS = 100;
const MAX_PURGED_IDS = 250_000;
const BACKUP_PATTERN = /^memory-backup-[A-Za-z0-9-]+\.json$/;
const MEMORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const clone = (v) => structuredClone(v);
const nowMs = () => Date.now();
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function textField(value, label, max, required = false) {
  if (typeof value !== 'string') throw new MemoryStoreError(`${label} must be text.`);
  const result = value.trim();
  if (required && !result) throw new MemoryStoreError(`${label} cannot be empty.`);
  if (result.length > max) throw new MemoryStoreError(`${label} must be ${max.toLocaleString()} characters or fewer.`, 413, 'FIELD_TOO_LONG');
  if (result.includes('\0')) throw new MemoryStoreError(`${label} contains an invalid null character.`);
  return result;
}
function allowedKeys(value, allowed, label) {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new MemoryStoreError(`Unsupported ${label} field(s): ${extra.slice(0, 5).join(', ')}.`);
}
function tagsField(value = []) {
  if (!Array.isArray(value)) throw new MemoryStoreError('Tags must be an array of text labels.');
  if (value.length > MAX_TAGS) throw new MemoryStoreError(`A memory can have at most ${MAX_TAGS} tags.`);
  const out = []; const seen = new Set();
  for (const raw of value) {
    const tag = textField(raw, 'Each tag', MAX_TAG_LENGTH, true);
    const key = tag.toLocaleLowerCase('en-US');
    if (!seen.has(key)) { seen.add(key); out.push(tag); }
  }
  return out;
}
function categoryField(value = 'general') {
  if (!MEMORY_CATEGORIES.includes(value)) throw new MemoryStoreError(`Category must be one of: ${MEMORY_CATEGORIES.join(', ')}.`);
  return value;
}
function importanceField(value = 3) {
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new MemoryStoreError('Importance must be an integer from 1 to 5.');
  return value;
}
function sourceField(value, defaultType = 'manual') {
  if (value === undefined) return { type: defaultType, label: '' };
  if (!isPlainObject(value)) throw new MemoryStoreError('Source must be an object with a supported type and optional label.');
  const type = value.type === undefined ? defaultType : value.type;
  if (!MEMORY_SOURCE_TYPES.includes(type)) throw new MemoryStoreError(`Source type must be one of: ${MEMORY_SOURCE_TYPES.join(', ')}.`);
  return { type, label: textField(value.label ?? '', 'Source label', MAX_SOURCE_LABEL_LENGTH) };
}
function normalizeStoredRecord(raw) {
  if (!isPlainObject(raw) || typeof raw.id !== 'string' || !MEMORY_ID_PATTERN.test(raw.id)) throw new MemoryStoreError('A stored memory has an invalid ID.', 500, 'INVALID_STORE');
  const title = textField(raw.title, 'Stored memory title', MAX_TITLE_LENGTH, true);
  const content = textField(raw.content, 'Stored memory content', 48_000, true);
  if (!Number.isInteger(raw.revision) || raw.revision < 1 || !Number.isSafeInteger(raw.createdAt) || !Number.isSafeInteger(raw.updatedAt)) throw new MemoryStoreError('A stored memory has invalid revision or timestamps.', 500, 'INVALID_STORE');
  if (raw.deletedAt !== null && !Number.isSafeInteger(raw.deletedAt)) throw new MemoryStoreError('A stored memory has an invalid deletion timestamp.', 500, 'INVALID_STORE');
  if (typeof raw.pinned !== 'boolean') throw new MemoryStoreError('A stored memory has an invalid pinned flag.', 500, 'INVALID_STORE');
  return { id: raw.id, title, content, category: categoryField(raw.category), tags: tagsField(raw.tags), importance: importanceField(raw.importance), pinned: raw.pinned, source: sourceField(raw.source), createdAt: raw.createdAt, updatedAt: raw.updatedAt, deletedAt: raw.deletedAt, revision: raw.revision };
}
function tokenize(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}_-]+/gu) || []; }
function bytesOf(record) { return Buffer.byteLength(JSON.stringify(record), 'utf8'); }
function timestampName() { return new Date().toISOString().replace(/[^0-9TZ-]/g, '-'); }
async function fsyncDir(directory) {
  let handle;
  try { handle = await fs.open(directory, 'r'); await handle.sync(); } catch { /* Windows does not always permit directory fsync. */ }
  finally { await handle?.close().catch(() => {}); }
}
async function atomicWriteFile(target, contents) {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temp, target); await fsyncDir(path.dirname(target));
  } catch (error) { await handle?.close().catch(() => {}); await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
}

function ftsQuery(query, operator = 'AND') {
  return [...new Set(tokenize(query))].slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"`).join(` ${operator} `);
}

export class SqliteMemoryStore {
  constructor(memoryDirectory) {
    this.directory = path.resolve(memoryDirectory);
    this.dbPath = path.join(this.directory, 'memories.sqlite');
    this.backupDirectory = path.join(this.directory, 'backups');
    this.purgeManifestPath = path.join(this.directory, 'permanent-deletions.json');
    this.migrationMarkerPath = path.join(this.directory, 'sqlite-migration.json');
    this.db = null;
    this.ftsAvailable = true;
    this.purgedIds = new Set();
    this.writeChain = Promise.resolve();
    this.backupScheduled = false;
    this.pendingSnapshot = Promise.resolve();
    this.recoveryInfo = { recovered: false, source: null };
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.mkdir(this.backupDirectory, { recursive: true });
    await this.loadPurgeManifest();
    const dbExists = await fs.access(this.dbPath).then(() => true, () => false);
    if (dbExists) {
      try {
        this.openDatabase();
        const check = this.db.prepare('PRAGMA integrity_check').get();
        if (check?.integrity_check !== 'ok') throw new Error(`SQLite integrity check returned ${check?.integrity_check || 'unknown error'}`);
        const schema = this.db.prepare("SELECT value FROM memory_meta WHERE key='schemaVersion'").get();
        if (!schema || Number(schema.value) !== SQLITE_MEMORY_SCHEMA_VERSION) throw new Error('Unsupported SQLite memory schema.');
        await this.ensureFtsIndex();
        await this.applyTombstonesToDb();
        if (!(await this.listBackupFiles()).length) await this.createBackupSnapshot();
        await this.ensureMigrationMarker();
        return { ...this.getStatus(), recovery: this.recoveryInfo, storage: 'sqlite' };
      } catch (error) {
        this.db?.close(); this.db = null;
        const corruptPath = path.join(this.backupDirectory, `memory-database-corrupt-${timestampName()}-${randomUUID()}.sqlite`);
        await fs.rename(this.dbPath, corruptPath).catch(() => {});
        await fs.rm(`${this.dbPath}-wal`, { force: true }).catch(() => {});
        await fs.rm(`${this.dbPath}-shm`, { force: true }).catch(() => {});
        const recovered = await this.findLatestValidBackup();
        if (!recovered) throw new MemoryStoreError(`The SQLite memory database is unreadable and no valid JSON backup could be recovered. The original database was preserved where possible. Details: ${error.message}`, 500, 'MEMORY_RECOVERY_REQUIRED');
        this.openDatabase(); this.createSchema(); this.importRecords(recovered.data.memories, recovered.data.revision, recovered.data.updatedAt, recovered.data.importedSources); await this.ensureFtsIndex();
        this.recoveryInfo = { recovered: true, source: recovered.name };
        await this.applyTombstonesToDb();
        await this.createBackupSnapshot();
        await this.ensureMigrationMarker();
        console.warn(`[memory] Recovered SQLite store from ${recovered.name}.`);
        return { ...this.getStatus(), recovery: this.recoveryInfo, storage: 'sqlite' };
      }
    }

    // If SQLite existed previously but is now missing, recover from its JSON snapshots.
    // Never silently migrate the older JSON archive over a newer SQLite-backed store.
    const markerExists = await fs.access(this.migrationMarkerPath).then(() => true, () => false);
    if (markerExists) {
      const recovered = await this.findLatestValidBackup();
      if (!recovered) throw new MemoryStoreError('The SQLite database is missing and no valid recovery snapshot exists. The legacy JSON archive was preserved but may be stale; memory startup stopped to avoid silently losing newer data.', 500, 'MEMORY_RECOVERY_REQUIRED');
      this.openDatabase(); this.createSchema(); this.importRecords(recovered.data.memories, recovered.data.revision, recovered.data.updatedAt, recovered.data.importedSources); await this.ensureFtsIndex();
      await this.applyTombstonesToDb(); await this.createBackupSnapshot(); await this.ensureMigrationMarker();
      this.recoveryInfo = { recovered: true, source: recovered.name };
      return { ...this.getStatus(), recovery: this.recoveryInfo, storage: 'sqlite' };
    }

    // First-run migration: validate the existing JSON store and keep it as a one-time migration archive.
    const legacyPath = path.join(this.directory, 'memories.json');
    const legacyExists = await fs.access(legacyPath).then(() => true, () => false);
    let legacyData;
    if (legacyExists) {
      const legacy = new MemoryStore(this.directory);
      await legacy.init();
      legacyData = legacy.data;
    } else {
      legacyData = { schemaVersion: 1, revision: 0, updatedAt: nowMs(), memories: [] };
    }
    const migrated = { ...legacyData, memories: legacyData.memories.filter((record) => !this.purgedIds.has(record.id)) };
    const logicalBytes = migrated.memories.reduce((sum, record) => sum + bytesOf(record), 0);
    if (migrated.memories.length > MEMORY_LIMITS.maxRecords || logicalBytes > MEMORY_LIMITS.maxLogicalBytes) {
      throw new MemoryStoreError(`Existing memory data exceeds the new limits (${MEMORY_LIMITS.maxRecords.toLocaleString()} records / 32 MiB). Export or consolidate memories before retrying migration. The original JSON store remains unchanged.`, 413, 'MIGRATION_LIMIT_EXCEEDED');
    }
    this.openDatabase(); this.createSchema(); this.importRecords(migrated.memories, migrated.revision || 0, migrated.updatedAt || nowMs(), migrated.importedSources); await this.ensureFtsIndex();
    if (this.purgedIds.size) await this.scrubBackupsForPurgedIds();
    await this.createBackupSnapshot();
    await this.ensureMigrationMarker();
    return { ...this.getStatus(), recovery: this.recoveryInfo, storage: 'sqlite', migratedFromJson: legacyExists };
  }

  async ensureMigrationMarker() {
    const marker = { schemaVersion: SQLITE_MEMORY_SCHEMA_VERSION, migratedAt: nowMs(), database: 'memories.sqlite' };
    const exists = await fs.access(this.migrationMarkerPath).then(() => true, () => false);
    if (!exists) await atomicWriteFile(this.migrationMarkerPath, `${JSON.stringify(marker, null, 2)}\n`);
  }

  openDatabase() {
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.ftsAvailable = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memories_fts'").get());
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, category TEXT NOT NULL,
        tags_json TEXT NOT NULL, importance INTEGER NOT NULL, pinned INTEGER NOT NULL,
        source_type TEXT NOT NULL, source_label TEXT NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, deleted_at INTEGER, revision INTEGER NOT NULL, logical_bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS memories_category_active ON memories(category, deleted_at, updated_at DESC);
      CREATE INDEX IF NOT EXISTS memories_updated ON memories(updated_at DESC);
      CREATE TABLE IF NOT EXISTS memory_tags (memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE, tag_key TEXT NOT NULL, PRIMARY KEY(memory_id, tag_key));
      CREATE INDEX IF NOT EXISTS memory_tags_key ON memory_tags(tag_key, memory_id);
      CREATE TABLE IF NOT EXISTS imported_sources (sha256 TEXT PRIMARY KEY, filename TEXT NOT NULL, imported_at INTEGER NOT NULL, record_count INTEGER NOT NULL);
    `);
    try { this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, title, tags, category, content, tokenize='unicode61 remove_diacritics 2')"); this.ftsAvailable = true; }
    catch { this.ftsAvailable = false; }
    const insertMeta = this.db.prepare('INSERT OR IGNORE INTO memory_meta(key,value) VALUES(?,?)');
    insertMeta.run('schemaVersion', String(SQLITE_MEMORY_SCHEMA_VERSION));
    insertMeta.run('revision', '0'); insertMeta.run('updatedAt', String(nowMs()));
    insertMeta.run('logicalBytes', '0'); insertMeta.run('mutationsSinceBackup', '0');
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
  }

  insertRecord(record) {
    const logicalBytes = bytesOf(record);
    this.db.prepare(`INSERT INTO memories(id,title,content,category,tags_json,importance,pinned,source_type,source_label,created_at,updated_at,deleted_at,revision,logical_bytes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.title, record.content, record.category, JSON.stringify(record.tags), record.importance, record.pinned ? 1 : 0, record.source.type, record.source.label, record.createdAt, record.updatedAt, record.deletedAt, record.revision, logicalBytes);
    const tagInsert = this.db.prepare('INSERT OR IGNORE INTO memory_tags(memory_id,tag_key) VALUES(?,?)');
    for (const tag of record.tags) tagInsert.run(record.id, tag.toLocaleLowerCase('en-US'));
    if (this.ftsAvailable) this.db.prepare('INSERT INTO memories_fts(id,title,tags,category,content) VALUES(?,?,?,?,?)').run(record.id, record.title, record.tags.join(' '), record.category, record.content);
    return logicalBytes;
  }

  rowToRecord(row) {
    if (!row) return null;
    return {
      id: row.id, title: row.title, content: row.content, category: row.category,
      tags: JSON.parse(row.tags_json), importance: row.importance, pinned: Boolean(row.pinned),
      source: { type: row.source_type, label: row.source_label }, createdAt: row.created_at,
      updatedAt: row.updated_at, deletedAt: row.deleted_at === null ? null : row.deleted_at, revision: row.revision
    };
  }

  importRecords(records, revision, updatedAt, importedSources = []) {
    if (!Array.isArray(records) || records.length > MEMORY_LIMITS.maxRecords) {
      throw new MemoryStoreError(`Memory data exceeds the ${MEMORY_LIMITS.maxRecords.toLocaleString()} record limit.`, 413, 'MEMORY_LIMIT_REACHED');
    }
    const normalizedRecords = records.map(normalizeStoredRecord).filter((record) => !this.purgedIds.has(record.id));
    const totalBytes = normalizedRecords.reduce((total, record) => total + bytesOf(record), 0);
    if (totalBytes > MEMORY_LIMITS.maxLogicalBytes) throw new MemoryStoreError('Memory data exceeds the 32 MiB logical capacity limit.', 413, 'STORE_SIZE_LIMIT');
    if (!Array.isArray(importedSources) || importedSources.length > MEMORY_LIMITS.maxRecords) throw new MemoryStoreError('Imported-source metadata exceeds its safety limit.', 413, 'IMPORT_SOURCE_LIMIT');
    for (const item of importedSources) {
      if (!isPlainObject(item) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256) || typeof item.filename !== 'string' || item.filename.length > 200 || !Number.isSafeInteger(item.importedAt) || !Number.isInteger(item.recordCount) || item.recordCount < 1 || item.recordCount > MEMORY_LIMITS.maxRecords) throw new MemoryStoreError('Imported-source metadata is invalid.', 400, 'INVALID_IMPORT_SOURCE');
    }
    this.transaction(() => {
      this.db.exec('DELETE FROM memories; DELETE FROM memory_tags; DELETE FROM imported_sources;');
      if (this.ftsAvailable) this.db.exec('DELETE FROM memories_fts;');
      for (const record of normalizedRecords) this.insertRecord(record);
      const insertSource = this.db.prepare('INSERT INTO imported_sources(sha256,filename,imported_at,record_count) VALUES(?,?,?,?)');
      for (const item of importedSources) insertSource.run(item.sha256, item.filename, item.importedAt, item.recordCount);
      this.setMeta('revision', revision); this.setMeta('updatedAt', updatedAt); this.setMeta('logicalBytes', totalBytes); this.setMeta('mutationsSinceBackup', 0);
    });
  }

  setMeta(key, value) { this.db.prepare('INSERT INTO memory_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)); }
  getMeta(key) { const row = this.db.prepare('SELECT value FROM memory_meta WHERE key=?').get(key); return row ? row.value : null; }
  bumpRevision() { const next = Number(this.getMeta('revision') || 0) + 1; this.setMeta('revision', next); this.setMeta('updatedAt', nowMs()); this.setMeta('mutationsSinceBackup', Number(this.getMeta('mutationsSinceBackup') || 0) + 1); return next; }

  async loadPurgeManifest() {
    let parsed;
    try {
      const stat = await fs.stat(this.purgeManifestPath);
      if (stat.size > 16 * 1024 * 1024) throw new Error('Permanent-deletion manifest exceeds the 16 MB limit.');
      parsed = JSON.parse(await fs.readFile(this.purgeManifestPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        parsed = { schemaVersion: MEMORY_PURGE_SCHEMA_VERSION, updatedAt: nowMs(), ids: [] };
        await atomicWriteFile(this.purgeManifestPath, `${JSON.stringify(parsed, null, 2)}\n`);
      } else throw new MemoryStoreError(`The permanent-deletion manifest is unreadable. Memory startup stopped to protect deleted data: ${error.message}`, 500, 'PURGE_MANIFEST_RECOVERY_REQUIRED');
    }
    if (!isPlainObject(parsed) || parsed.schemaVersion !== MEMORY_PURGE_SCHEMA_VERSION || !Array.isArray(parsed.ids) || parsed.ids.length > MAX_PURGED_IDS || parsed.ids.some((id) => typeof id !== 'string' || !MEMORY_ID_PATTERN.test(id))) {
      throw new MemoryStoreError('The permanent-deletion manifest is invalid. Memory startup stopped to protect deleted data.', 500, 'PURGE_MANIFEST_RECOVERY_REQUIRED');
    }
    this.purgedIds = new Set(parsed.ids);
  }

  async persistPurgeManifest(ids) {
    if (ids.size > MAX_PURGED_IDS) throw new MemoryStoreError('The permanent-deletion manifest reached its safety limit.', 413, 'PURGE_MANIFEST_LIMIT');
    const payload = { schemaVersion: MEMORY_PURGE_SCHEMA_VERSION, updatedAt: nowMs(), ids: [...ids].sort() };
    await atomicWriteFile(this.purgeManifestPath, `${JSON.stringify(payload, null, 2)}\n`); this.purgedIds = new Set(ids);
  }

  async ensureFtsIndex() {
    if (!this.ftsAvailable) return;
    const records = Number(this.db.prepare('SELECT COUNT(*) AS n FROM memories').get().n);
    const indexed = Number(this.db.prepare('SELECT COUNT(*) AS n FROM memories_fts').get().n);
    if (records === indexed) return;
    this.transaction(() => {
      this.db.exec('DELETE FROM memories_fts');
      const rows = this.db.prepare('SELECT id,title,tags_json,category,content FROM memories').all();
      const insert = this.db.prepare('INSERT INTO memories_fts(id,title,tags,category,content) VALUES(?,?,?,?,?)');
      for (const row of rows) insert.run(row.id, row.title, JSON.parse(row.tags_json).join(' '), row.category, row.content);
    });
  }

  async applyTombstonesToDb() {
    if (!this.purgedIds.size) return;
    this.transaction(() => {
      const get = this.db.prepare('SELECT * FROM memories WHERE id=?');
      const remove = this.db.prepare('DELETE FROM memories WHERE id=?');
      let logicalBytes = Number(this.getMeta('logicalBytes') || 0);
      for (const id of this.purgedIds) { const row = get.get(id); if (row) { logicalBytes -= Number(row.logical_bytes); remove.run(id); if (this.ftsAvailable) this.db.prepare('DELETE FROM memories_fts WHERE id=?').run(id); } }
      this.setMeta('logicalBytes', Math.max(0, logicalBytes));
    });
    await this.scrubBackupsForPurgedIds();
  }

  getStatus() {
    if (!this.db) return { schemaVersion: SQLITE_MEMORY_SCHEMA_VERSION, revision: 0, updatedAt: null, count: 0, deletedCount: 0, storageBytes: 0, capacityBytes: MEMORY_LIMITS.maxLogicalBytes, maxRecords: MEMORY_LIMITS.maxRecords };
    const counts = this.db.prepare('SELECT SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted FROM memories').get();
    return { schemaVersion: SQLITE_MEMORY_SCHEMA_VERSION, revision: Number(this.getMeta('revision') || 0), updatedAt: Number(this.getMeta('updatedAt') || 0) || null, count: Number(counts.active || 0), deletedCount: Number(counts.deleted || 0), storageBytes: Number(this.getMeta('logicalBytes') || 0), capacityBytes: MEMORY_LIMITS.maxLogicalBytes, maxRecords: MEMORY_LIMITS.maxRecords };
  }

  get(id, { includeDeleted = false } = {}) {
    if (typeof id !== 'string') throw new MemoryStoreError('Invalid memory ID.');
    const row = this.db.prepare(`SELECT * FROM memories WHERE id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(id);
    if (!row) throw new MemoryStoreError('Memory not found.', 404, 'MEMORY_NOT_FOUND');
    return clone(this.rowToRecord(row));
  }

  list({ q = '', category, tag, includeDeleted = false, deletedOnly = false, limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
    if (typeof q !== 'string' || q.length > 200) throw new MemoryStoreError('Search text must be 200 characters or fewer.');
    if (category !== undefined && category !== '' && !MEMORY_CATEGORIES.includes(category)) throw new MemoryStoreError(`Category must be one of: ${MEMORY_CATEGORIES.join(', ')}.`);
    const normalizedTag = tag === undefined || tag === '' ? '' : textField(tag, 'Tag filter', MAX_TAG_LENGTH, true).toLocaleLowerCase('en-US');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new MemoryStoreError(`Limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new MemoryStoreError(`Offset must be an integer from 0 to ${MAX_OFFSET}.`);
    const query = q.normalize('NFKC').trim();
    let match = this.ftsAvailable ? ftsQuery(query, 'AND') : '';
    const buildWhere = (ftsMatch) => {
      const where = []; const params = [];
      if (deletedOnly) where.push('m.deleted_at IS NOT NULL'); else if (!includeDeleted) where.push('m.deleted_at IS NULL');
      if (category) { where.push('m.category=?'); params.push(category); }
      if (normalizedTag) { where.push('EXISTS(SELECT 1 FROM memory_tags mt WHERE mt.memory_id=m.id AND mt.tag_key=?)'); params.push(normalizedTag); }
      if (ftsMatch) { where.push('memories_fts MATCH ?'); params.push(ftsMatch); }
      else if (query && !this.ftsAvailable) {
        const escaped = `%${query.toLocaleLowerCase('en-US').replace(/[\\%_]/g, '\\$&')}%`;
        where.push("(lower(m.title) LIKE ? ESCAPE '\\' OR lower(m.content) LIKE ? ESCAPE '\\' OR lower(m.tags_json) LIKE ? ESCAPE '\\')"); params.push(escaped, escaped, escaped);
      } else if (query && this.ftsAvailable && !ftsMatch) {
        where.push('1=0');
      }
      return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
    };
    let { whereSql, params } = buildWhere(match);
    const countMatches = () => Number(this.db.prepare(match
      ? `SELECT COUNT(*) AS n FROM memories m JOIN memories_fts ON memories_fts.id=m.id ${whereSql}`
      : `SELECT COUNT(*) AS n FROM memories m ${whereSql}`).get(...params).n);
    let total = countMatches();
    // Prefer an all-terms match for relevance and speed; broaden only if it yields no results.
    if (match && total === 0 && tokenize(query).length > 1) {
      match = ftsQuery(query, 'OR');
      ({ whereSql, params } = buildWhere(match));
      total = countMatches();
    }
    const sortSql = match ? 'bm25(memories_fts,0.0,10.0,6.0,4.0,1.0) ASC, m.pinned DESC, m.updated_at DESC, m.created_at DESC' : 'm.pinned DESC, m.updated_at DESC, m.created_at DESC';
    const select = match ? `SELECT m.* FROM memories m JOIN memories_fts ON memories_fts.id=m.id ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?` : `SELECT m.* FROM memories m ${whereSql} ORDER BY ${sortSql} LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(select).all(...params, limit, offset);
    const items = rows.map((row) => this.rowToRecord(row));
    return { items, total, limit, offset, hasMore: offset + items.length < total };
  }

  enqueue(task) { const next = this.writeChain.then(task, task); this.writeChain = next.then(() => undefined, () => undefined); return next; }
  assertLoaded() { if (!this.db) throw new MemoryStoreError('The memory store has not been initialized.', 500, 'STORE_NOT_INITIALIZED'); }
  ensureCapacity(addCount, addBytes) {
    const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM memories').get().n);
    const bytes = Number(this.getMeta('logicalBytes') || 0);
    if (count + addCount > MEMORY_LIMITS.maxRecords) throw new MemoryStoreError(`The store has reached the ${MEMORY_LIMITS.maxRecords.toLocaleString()} memory limit. Archive or consolidate records first.`, 413, 'MEMORY_LIMIT_REACHED');
    if (bytes + addBytes > MEMORY_LIMITS.maxLogicalBytes) throw new MemoryStoreError('The local memory capacity (32 MiB) is full. Export, archive, or consolidate memories before adding more.', 413, 'STORE_SIZE_LIMIT');
  }
  makeNewRecord(input, { defaultSource = 'manual', timestamp = nowMs() } = {}) {
    if (!isPlainObject(input)) throw new MemoryStoreError('Memory body must be a JSON object.');
    allowedKeys(input, ['title','content','category','tags','importance','pinned','source'], 'memory');
    const content = textField(input.content, 'Memory content', MEMORY_LIMITS.maxNewContentChars, true);
    const titleCandidate = input.title === undefined || input.title === '' ? content.split(/\r?\n/,1)[0].replace(/^#{1,6}\s+/, '').slice(0, MAX_TITLE_LENGTH).trim() : input.title;
    const pinned = input.pinned === undefined ? false : input.pinned;
    if (typeof pinned !== 'boolean') throw new MemoryStoreError('Pinned must be a boolean.');
    return { id: randomUUID(), title: textField(titleCandidate || 'Untitled memory', 'Memory title', MAX_TITLE_LENGTH, true), content, category: categoryField(input.category), tags: tagsField(input.tags), importance: importanceField(input.importance), pinned, source: sourceField(input.source, defaultSource), createdAt: timestamp, updatedAt: timestamp, deletedAt: null, revision: 1 };
  }
  updateRecord(current, changes, timestamp = nowMs()) {
    if (!isPlainObject(changes)) throw new MemoryStoreError('Update body must be a JSON object.');
    allowedKeys(changes, ['title','content','category','tags','importance','pinned','source'], 'update');
    const next = { ...current };
    if (Object.hasOwn(changes, 'title')) next.title = textField(changes.title, 'Memory title', MAX_TITLE_LENGTH, true);
    if (Object.hasOwn(changes, 'content')) next.content = textField(changes.content, 'Memory content', MEMORY_LIMITS.maxNewContentChars, true);
    if (Object.hasOwn(changes, 'category')) next.category = categoryField(changes.category);
    if (Object.hasOwn(changes, 'tags')) next.tags = tagsField(changes.tags);
    if (Object.hasOwn(changes, 'importance')) next.importance = importanceField(changes.importance);
    if (Object.hasOwn(changes, 'pinned')) { if (typeof changes.pinned !== 'boolean') throw new MemoryStoreError('Pinned must be a boolean.'); next.pinned = changes.pinned; }
    if (Object.hasOwn(changes, 'source')) next.source = sourceField(changes.source);
    next.updatedAt = timestamp; next.revision = current.revision + 1;
    return next;
  }
  saveSnapshotLater() {
    const mutationCount = Number(this.getMeta('mutationsSinceBackup') || 0);
    if (mutationCount < SNAPSHOT_INTERVAL_MUTATIONS || this.backupScheduled) return;
    this.backupScheduled = true;
    this.pendingSnapshot = new Promise((resolve) => setImmediate(() => this.createBackupSnapshot().catch((error) => console.error('[memory] Snapshot failed:', error.message)).finally(() => { this.backupScheduled = false; resolve(); })));
  }
  commitRecord(record, current = null) {
    const oldBytes = current ? Number(this.db.prepare('SELECT logical_bytes FROM memories WHERE id=?').get(current.id)?.logical_bytes || 0) : 0;
    const newBytes = bytesOf(record);
    if (!current) this.ensureCapacity(1, newBytes);
    else {
      const projected = Number(this.getMeta('logicalBytes') || 0) - oldBytes + newBytes;
      if (projected > MEMORY_LIMITS.maxLogicalBytes) throw new MemoryStoreError('The local memory capacity (32 MiB) is full. Export, archive, or consolidate memories before updating this record.', 413, 'STORE_SIZE_LIMIT');
    }
    this.transaction(() => {
      if (current) {
        if (this.ftsAvailable) this.db.prepare('DELETE FROM memories_fts WHERE id=?').run(record.id);
        this.db.prepare('DELETE FROM memory_tags WHERE memory_id=?').run(record.id);
        this.db.prepare(`UPDATE memories SET title=?,content=?,category=?,tags_json=?,importance=?,pinned=?,source_type=?,source_label=?,created_at=?,updated_at=?,deleted_at=?,revision=?,logical_bytes=? WHERE id=?`)
          .run(record.title, record.content, record.category, JSON.stringify(record.tags), record.importance, record.pinned ? 1 : 0, record.source.type, record.source.label, record.createdAt, record.updatedAt, record.deletedAt, record.revision, newBytes, record.id);
      } else this.insertRecord(record);
      if (current) {
        const tagInsert = this.db.prepare('INSERT OR IGNORE INTO memory_tags(memory_id,tag_key) VALUES(?,?)');
        for (const tag of record.tags) tagInsert.run(record.id, tag.toLocaleLowerCase('en-US'));
        if (this.ftsAvailable) this.db.prepare('INSERT INTO memories_fts(id,title,tags,category,content) VALUES(?,?,?,?,?)').run(record.id, record.title, record.tags.join(' '), record.category, record.content);
      }
      this.setMeta('logicalBytes', Number(this.getMeta('logicalBytes') || 0) - oldBytes + newBytes); this.bumpRevision();
    });
    this.saveSnapshotLater();
  }

  create(input) { return this.enqueue(() => { this.assertLoaded(); const record = this.makeNewRecord(input); this.commitRecord(record); return clone(record); }); }
  update(id, changes) { return this.enqueue(() => { this.assertLoaded(); const current = this.get(id); const next = this.updateRecord(current, changes); this.commitRecord(next, current); return clone(next); }); }
  softDelete(id) { return this.enqueue(() => { const current = this.get(id); const timestamp = nowMs(); const next = { ...current, deletedAt: timestamp, updatedAt: timestamp, revision: current.revision + 1 }; this.commitRecord(next, current); return clone(next); }); }
  restore(id) { return this.enqueue(() => { const current = this.get(id, { includeDeleted: true }); if (!current.deletedAt) throw new MemoryStoreError('Deleted memory not found.', 404, 'MEMORY_NOT_FOUND'); const timestamp = nowMs(); const next = { ...current, deletedAt: null, updatedAt: timestamp, revision: current.revision + 1 }; this.commitRecord(next, current); return clone(next); }); }

  permanentlyDelete(id) { return this.enqueue(async () => {
    const current = this.get(id, { includeDeleted: true }); const ids = new Set(this.purgedIds); ids.add(id); await this.persistPurgeManifest(ids);
    this.transaction(() => { this.db.prepare('DELETE FROM memories WHERE id=?').run(id); if (this.ftsAvailable) this.db.prepare('DELETE FROM memories_fts WHERE id=?').run(id); this.setMeta('logicalBytes', Math.max(0, Number(this.getMeta('logicalBytes') || 0) - bytesOf(current))); this.bumpRevision(); });
    await this.scrubBackupsForPurgedIds(); this.saveSnapshotLater(); return { id, permanentlyDeleted: true };
  }); }

  applyBatch(operations) { return this.enqueue(() => {
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 60) throw new MemoryStoreError('Apply between 1 and 60 reviewed memory changes at a time.');
    let creates = 0; let projectedBytes = Number(this.getMeta('logicalBytes') || 0); const prepared = []; const touched = new Set(); const timestamp = nowMs();
    for (const operation of operations) {
      if (!isPlainObject(operation)) throw new MemoryStoreError('Each batch operation must be an object.');
      allowedKeys(operation, ['action','id','memory'], 'batch operation');
      if (!isPlainObject(operation.memory)) throw new MemoryStoreError('Each batch operation needs a memory object.');
      if (operation.action === 'create') {
        if (typeof operation.memory.content !== 'string' || operation.memory.content.length > MEMORY_LIMITS.maxAiMemoryChars) throw new MemoryStoreError(`AI-organized memories must be ${MEMORY_LIMITS.maxAiMemoryChars.toLocaleString()} characters or fewer.`, 413, 'AI_MEMORY_TOO_LONG');
        const record = this.makeNewRecord(operation.memory, { defaultSource: 'ai', timestamp }); prepared.push({ action: 'create', record }); creates += 1; projectedBytes += bytesOf(record);
      }
      else if (operation.action === 'update' && typeof operation.id === 'string') {
        if (touched.has(operation.id)) throw new MemoryStoreError('A memory can only be updated once per batch.'); touched.add(operation.id);
        if (Object.hasOwn(operation.memory, 'content') && (typeof operation.memory.content !== 'string' || operation.memory.content.length > MEMORY_LIMITS.maxAiMemoryChars)) throw new MemoryStoreError(`AI-organized memory updates must be ${MEMORY_LIMITS.maxAiMemoryChars.toLocaleString()} characters or fewer.`, 413, 'AI_MEMORY_TOO_LONG');
        const current = this.get(operation.id); const next = this.updateRecord(current, operation.memory, timestamp);
        projectedBytes += bytesOf(next) - bytesOf(current); prepared.push({ action: 'update', current, record: next });
      } else throw new MemoryStoreError('Batch action must be create or update with a valid memory ID.');
    }
    const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM memories').get().n);
    if (count + creates > MEMORY_LIMITS.maxRecords) throw new MemoryStoreError(`The store has reached the ${MEMORY_LIMITS.maxRecords.toLocaleString()} memory limit.`, 413, 'MEMORY_LIMIT_REACHED');
    if (projectedBytes > MEMORY_LIMITS.maxLogicalBytes) throw new MemoryStoreError('The local memory capacity (32 MiB) would be exceeded by this batch.', 413, 'STORE_SIZE_LIMIT');
    this.transaction(() => {
      for (const item of prepared) {
        if (item.action === 'create') this.insertRecord(item.record);
        else {
          if (this.ftsAvailable) this.db.prepare('DELETE FROM memories_fts WHERE id=?').run(item.record.id); this.db.prepare('DELETE FROM memory_tags WHERE memory_id=?').run(item.record.id);
          const r = item.record; const n = bytesOf(r);
          this.db.prepare('UPDATE memories SET title=?,content=?,category=?,tags_json=?,importance=?,pinned=?,source_type=?,source_label=?,created_at=?,updated_at=?,deleted_at=?,revision=?,logical_bytes=? WHERE id=?').run(r.title,r.content,r.category,JSON.stringify(r.tags),r.importance,r.pinned?1:0,r.source.type,r.source.label,r.createdAt,r.updatedAt,r.deletedAt,r.revision,n,r.id);
          const tagInsert = this.db.prepare('INSERT OR IGNORE INTO memory_tags(memory_id,tag_key) VALUES(?,?)'); for (const tag of r.tags) tagInsert.run(r.id,tag.toLocaleLowerCase('en-US'));
          if (this.ftsAvailable) this.db.prepare('INSERT INTO memories_fts(id,title,tags,category,content) VALUES(?,?,?,?,?)').run(r.id,r.title,r.tags.join(' '),r.category,r.content);
        }
      }
      this.setMeta('logicalBytes', projectedBytes); this.bumpRevision();
    });
    this.saveSnapshotLater(); return { items: prepared.map((item) => clone(item.record)), status: this.getStatus() };
  }); }

  async createBackupSnapshot() {
    if (!this.db) return null;
    const data = this.exportData(); const capturedMutationCount = Number(this.getMeta('mutationsSinceBackup') || 0); const contents = `${JSON.stringify(data, null, 2)}\n`;
    const name = `memory-backup-${timestampName()}-${randomUUID()}.json`;
    await atomicWriteFile(path.join(this.backupDirectory, name), contents);
    this.setMeta('mutationsSinceBackup', Math.max(0, Number(this.getMeta('mutationsSinceBackup') || 0) - capturedMutationCount));
    await this.trimBackups();
    return name;
  }
  exportData() {
    const rows = this.db.prepare('SELECT * FROM memories ORDER BY created_at,id').all();
    return { schemaVersion: 1, revision: Number(this.getMeta('revision') || 0), updatedAt: Number(this.getMeta('updatedAt') || nowMs()), memories: rows.map((row) => this.rowToRecord(row)).filter((record) => !this.purgedIds.has(record.id)), importedSources: this.db.prepare('SELECT sha256,filename,imported_at AS importedAt,record_count AS recordCount FROM imported_sources ORDER BY imported_at').all() };
  }
  async listBackupFiles() {
    const names = await fs.readdir(this.backupDirectory).catch(() => []); const out = [];
    for (const name of names) if (BACKUP_PATTERN.test(name)) {
      const filePath = path.join(this.backupDirectory,name);
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        // Windows filesystems may report identical/coarse mtimes for snapshots
        // written milliseconds apart. Rank snapshots by their logical database
        // revision first, then updatedAt, and only then use mtime/name as ties.
        // The JSON header is intentionally read as a tiny prefix, not by parsing
        // every full snapshot during each backup rotation.
        let revision = -1; let updatedAt = -1;
        const handle = await fs.open(filePath, 'r');
        try {
          const header = Buffer.alloc(1024);
          const { bytesRead } = await handle.read(header, 0, header.length, 0);
          const prefix = header.toString('utf8', 0, bytesRead);
          const revisionMatch = prefix.match(/"revision"\s*:\s*(\d+)/);
          const updatedAtMatch = prefix.match(/"updatedAt"\s*:\s*(\d+)/);
          if (revisionMatch) revision = Number(revisionMatch[1]);
          if (updatedAtMatch) updatedAt = Number(updatedAtMatch[1]);
        } finally { await handle.close(); }
        out.push({ name,filePath,sizeBytes:stat.size,modifiedAt:stat.mtimeMs,revision,updatedAt });
      } catch {}
    }
    return out.sort((a,b) => b.revision-a.revision || b.updatedAt-a.updatedAt || b.modifiedAt-a.modifiedAt || b.name.localeCompare(a.name));
  }
  async trimBackups() {
    const entries = await this.listBackupFiles(); let count=0; let bytes=0;
    for (const entry of entries) {
      if (count < MEMORY_LIMITS.maxBackups && (count === 0 || bytes + entry.sizeBytes <= MEMORY_LIMITS.maxBackupBytes)) { count += 1; bytes += entry.sizeBytes; }
      else await fs.rm(entry.filePath,{force:true}).catch(()=>{});
    }
    await fsyncDir(this.backupDirectory);
  }
  async readBackup(entryPath) {
    const stat = await fs.stat(entryPath); if (stat.size > MEMORY_LIMITS.maxBackupBytes) throw new Error('Backup exceeds size limit.');
    const raw = JSON.parse(await fs.readFile(entryPath,'utf8'));
    if (!isPlainObject(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.memories) || raw.memories.length > MEMORY_LIMITS.maxRecords) throw new Error('Invalid backup schema.');
    const records = raw.memories.map(normalizeStoredRecord).filter((record) => !this.purgedIds.has(record.id));
    if (records.reduce((n,r)=>n+bytesOf(r),0) > MEMORY_LIMITS.maxLogicalBytes) throw new Error('Backup exceeds memory store capacity.');
    const rawSources = raw.importedSources === undefined ? [] : raw.importedSources;
    if (!Array.isArray(rawSources) || rawSources.length > MEMORY_LIMITS.maxRecords) throw new Error('Backup imported-source manifest is invalid.');
    const importedSources = rawSources.map((item) => {
      if (!isPlainObject(item) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256) || typeof item.filename !== 'string' || item.filename.length > 200 || !Number.isSafeInteger(item.importedAt) || !Number.isInteger(item.recordCount) || item.recordCount < 1 || item.recordCount > MEMORY_LIMITS.maxRecords) throw new Error('Backup imported-source record is invalid.');
      return { sha256:item.sha256, filename:item.filename, importedAt:item.importedAt, recordCount:item.recordCount };
    });
    return { schemaVersion:1, revision:Number.isSafeInteger(raw.revision)?raw.revision:0, updatedAt:Number.isSafeInteger(raw.updatedAt)?raw.updatedAt:nowMs(), memories:records, importedSources };
  }
  async findLatestValidBackup() { for (const entry of await this.listBackupFiles()) { try { return { ...entry, data: await this.readBackup(entry.filePath) }; } catch {} } return null; }
  async scrubBackupsForPurgedIds() {
    if (!this.purgedIds.size) return;
    for (const entry of await this.listBackupFiles()) {
      try { const data = await this.readBackup(entry.filePath); await atomicWriteFile(entry.filePath, `${JSON.stringify(data,null,2)}\n`); }
      catch { await fs.rm(entry.filePath,{force:true}).catch(()=>{}); }
    }
    await this.trimBackups();
  }
  async listBackups() {
    const result=[];
    for (const entry of await this.listBackupFiles()) { try { const data=await this.readBackup(entry.filePath); result.push({name:entry.name,sizeBytes:entry.sizeBytes,createdAt:entry.modifiedAt,revision:data.revision,memoryCount:data.memories.length}); } catch {} }
    return result;
  }
  restoreBackup(backupName) { return this.enqueue(async () => {
    if (typeof backupName !== 'string' || !BACKUP_PATTERN.test(backupName) || path.basename(backupName)!==backupName) throw new MemoryStoreError('Choose a valid memory backup name.');
    const backupPath=path.join(this.backupDirectory,backupName); let restored;
    try { restored=await this.readBackup(backupPath); } catch (error) { if (error.code==='ENOENT') throw new MemoryStoreError('Memory backup not found.',404,'BACKUP_NOT_FOUND'); throw new MemoryStoreError('That memory backup is not valid and cannot be restored.',400,'INVALID_BACKUP'); }
    await this.createBackupSnapshot(); this.importRecords(restored.memories, Number(this.getMeta('revision')||0)+1, nowMs(), restored.importedSources); await this.scrubBackupsForPurgedIds(); await this.createBackupSnapshot();
    return { ...this.getStatus(), restoredFrom:backupName };
  }); }
  async scrubImportedSourceHash(hash) { this.db.prepare('DELETE FROM imported_sources WHERE sha256=?').run(hash); }
  async importRawDocument({ filename, content, hash }) { return this.enqueue(async () => {
    this.assertLoaded();
    const safeFilename=textField(filename,'Filename',200,true);
    if (typeof content!=='string' || !content.trim()) throw new MemoryStoreError('Imported file content cannot be empty.');
    const contentBytes=Buffer.byteLength(content,'utf8');
    if (contentBytes>MEMORY_LIMITS.maxImportFileBytes) throw new MemoryStoreError('Each imported file must be 2 MiB or smaller.',413,'IMPORT_FILE_TOO_LARGE');
    const computed=createHash('sha256').update(content).digest('hex');
    if (hash && hash !== computed) throw new MemoryStoreError('Import content hash did not match.');
    const existing=this.db.prepare('SELECT record_count FROM imported_sources WHERE sha256=?').get(computed);
    if(existing) return { duplicate:true, created:0, recordCount:existing.record_count, status:this.getStatus() };
    const chunks=[]; const max=7600; let start=0;
    while(start<content.length) { let end=Math.min(start+max,content.length); if(end<content.length) { if(/[\uD800-\uDBFF]/.test(content.charAt(end-1)) && /[\uDC00-\uDFFF]/.test(content.charAt(end))) end--; const p=content.lastIndexOf('\n\n',end); const l=content.lastIndexOf('\n',end); if(p>start+max*.55) end=p+2; else if(l>start+max*.55) end=l+1; } if(end<=start)end=Math.min(start+max,content.length); chunks.push(content.slice(start,end)); start=end; }
    if(chunks.length>MEMORY_LIMITS.maxRecords) throw new MemoryStoreError('Imported document creates too many memory records.',413,'MEMORY_LIMIT_REACHED');
    const timestamp=nowMs(); const base=safeFilename.replace(/\.(?:md|markdown|txt)$/i,'').replace(/[-_]+/g,' ').trim() || 'Imported note';
    const records=chunks.map((part,i)=>({ id:randomUUID(),title:(chunks.length>1?`${base} (Part ${i+1}/${chunks.length})`:base).slice(0,MAX_TITLE_LENGTH),content:textField(part,'Memory content',MEMORY_LIMITS.maxNewContentChars,true),category:'note',tags:tagsField(['imported',base.slice(0,40)]),importance:3,pinned:false,source:{type:'import',label:safeFilename},createdAt:timestamp,updatedAt:timestamp,deletedAt:null,revision:1 }));
    const addBytes=records.reduce((n,r)=>n+bytesOf(r),0); this.ensureCapacity(records.length,addBytes);
    this.transaction(()=>{for(const record of records)this.insertRecord(record); this.db.prepare('INSERT INTO imported_sources(sha256,filename,imported_at,record_count) VALUES(?,?,?,?)').run(computed,safeFilename,timestamp,records.length); this.setMeta('logicalBytes',Number(this.getMeta('logicalBytes')||0)+addBytes); this.bumpRevision();});
    this.saveSnapshotLater(); return {duplicate:false,created:records.length,recordCount:records.length,status:this.getStatus()};
  }); }

  async close() {
    if (this.backupScheduled) await this.pendingSnapshot.catch(() => {});
    if (!this.db) return;
    try { await this.createBackupSnapshot(); } catch (error) { console.error('[memory] Final SQLite snapshot failed:', error.message); }
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { this.db.close(); this.db = null; }
  }
}
