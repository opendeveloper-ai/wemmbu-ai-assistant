import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MEMORY_SCHEMA_VERSION = 1;
export const MEMORY_CATEGORIES = Object.freeze([
  'general', 'about', 'preference', 'project', 'instruction', 'fact', 'note'
]);
export const MEMORY_SOURCE_TYPES = Object.freeze([
  'manual', 'import', 'conversation', 'ai', 'system'
]);

const MAX_MEMORIES = 50_000;
const MAX_STORE_BYTES = 100 * 1024 * 1024;
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_TITLE_LENGTH = 160;
const MAX_CONTENT_LENGTH = 48_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;
const MAX_SOURCE_LABEL_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 1_000_000;
const MAX_BACKUPS = 20;
const MAX_PURGED_IDS = 250_000;
const BACKUP_PATTERN = /^memory-backup-[A-Za-z0-9-]+\.json$/;
const TEMP_WRITE_PATTERN = /^\.(?:memories\.json|permanent-deletions\.json|memory-backup-[A-Za-z0-9-]+\.json)\.\d+\.[0-9a-f-]{36}\.tmp$/i;
const STALE_TEMP_AGE_MS = 24 * 60 * 60 * 1000;
export const MEMORY_PURGE_SCHEMA_VERSION = 1;

export class MemoryStoreError extends Error {
  constructor(message, statusCode = 400, code = 'MEMORY_ERROR') {
    super(message);
    this.name = 'MemoryStoreError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const clone = (value) => structuredClone(value);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nowMs = () => Date.now();

function assertText(value, label, maxLength, { required = false } = {}) {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return '';
    throw new MemoryStoreError(`${label} must be text.`);
  }
  const text = value.trim();
  if (required && !text) throw new MemoryStoreError(`${label} cannot be empty.`);
  if (text.length > maxLength) throw new MemoryStoreError(`${label} must be ${maxLength.toLocaleString()} characters or fewer.`, 413, 'FIELD_TOO_LONG');
  if (text.includes('\u0000')) throw new MemoryStoreError(`${label} contains an invalid null character.`);
  return text;
}

function assertAllowedKeys(input, allowed, label) {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new MemoryStoreError(`Unsupported ${label} field(s): ${unknown.slice(0, 5).join(', ')}.`);
}

function normalizeTags(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new MemoryStoreError('Tags must be an array of text labels.');
  if (input.length > MAX_TAGS) throw new MemoryStoreError(`A memory can have at most ${MAX_TAGS} tags.`);
  const result = [];
  const seen = new Set();
  for (const rawTag of input) {
    const tag = assertText(rawTag, 'Each tag', MAX_TAG_LENGTH, { required: true });
    const key = tag.toLocaleLowerCase('en-US');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }
  return result;
}

function normalizeSource(input, defaultType = 'manual') {
  if (input === undefined) return { type: defaultType, label: '' };
  if (!isPlainObject(input)) throw new MemoryStoreError('Source must be an object with a supported type and optional label.');
  const type = input.type === undefined ? defaultType : input.type;
  if (!MEMORY_SOURCE_TYPES.includes(type)) {
    throw new MemoryStoreError(`Source type must be one of: ${MEMORY_SOURCE_TYPES.join(', ')}.`);
  }
  const label = assertText(input.label ?? '', 'Source label', MAX_SOURCE_LABEL_LENGTH);
  return { type, label };
}

function normalizeCategory(value, defaultCategory = 'general') {
  const category = value === undefined ? defaultCategory : value;
  if (!MEMORY_CATEGORIES.includes(category)) {
    throw new MemoryStoreError(`Category must be one of: ${MEMORY_CATEGORIES.join(', ')}.`);
  }
  return category;
}

function normalizeImportance(value, defaultValue = 3) {
  const importance = value === undefined ? defaultValue : value;
  if (!Number.isInteger(importance) || importance < 1 || importance > 5) {
    throw new MemoryStoreError('Importance must be an integer from 1 to 5.');
  }
  return importance;
}

function normalizeTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) throw new MemoryStoreError(`${label} must be a valid timestamp.`, 500, 'INVALID_STORE');
  return value;
}

function normalizeStoredRecord(raw) {
  if (!isPlainObject(raw)) throw new MemoryStoreError('A stored memory record is not an object.', 500, 'INVALID_STORE');
  if (typeof raw.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw.id)) {
    throw new MemoryStoreError('A stored memory has an invalid ID.', 500, 'INVALID_STORE');
  }
  const title = assertText(raw.title, 'Stored memory title', MAX_TITLE_LENGTH, { required: true });
  const content = assertText(raw.content, 'Stored memory content', MAX_CONTENT_LENGTH, { required: true });
  const category = normalizeCategory(raw.category);
  const tags = normalizeTags(raw.tags);
  const importance = normalizeImportance(raw.importance);
  if (typeof raw.pinned !== 'boolean') throw new MemoryStoreError('A stored memory has an invalid pinned flag.', 500, 'INVALID_STORE');
  if (!Number.isInteger(raw.revision) || raw.revision < 1) throw new MemoryStoreError('A stored memory has an invalid revision.', 500, 'INVALID_STORE');
  return {
    id: raw.id,
    title,
    content,
    category,
    tags,
    importance,
    pinned: raw.pinned,
    source: normalizeSource(raw.source),
    createdAt: normalizeTimestamp(raw.createdAt, 'Stored creation date'),
    updatedAt: normalizeTimestamp(raw.updatedAt, 'Stored update date'),
    deletedAt: normalizeTimestamp(raw.deletedAt, 'Stored deletion date', { nullable: true }),
    revision: raw.revision
  };
}

function normalizeStoreData(raw) {
  if (!isPlainObject(raw)) throw new MemoryStoreError('The memory store is not a JSON object.', 500, 'INVALID_STORE');
  if (raw.schemaVersion !== MEMORY_SCHEMA_VERSION) {
    throw new MemoryStoreError(
      `Unsupported memory store schema version ${String(raw.schemaVersion)}. This app supports version ${MEMORY_SCHEMA_VERSION}.`,
      500,
      'UNSUPPORTED_SCHEMA'
    );
  }
  if (!Array.isArray(raw.memories) || raw.memories.length > MAX_MEMORIES) {
    throw new MemoryStoreError('The memory store has an invalid or excessive memory list.', 500, 'INVALID_STORE');
  }
  const memories = raw.memories.map(normalizeStoredRecord);
  const ids = new Set();
  for (const memory of memories) {
    if (ids.has(memory.id)) throw new MemoryStoreError('The memory store contains duplicate memory IDs.', 500, 'INVALID_STORE');
    ids.add(memory.id);
  }
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new MemoryStoreError('The memory store has an invalid revision.', 500, 'INVALID_STORE');
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    revision: raw.revision,
    updatedAt: normalizeTimestamp(raw.updatedAt, 'Store update date'),
    memories
  };
}

function tokenize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}_-]+/gu) || [];
}

function addIndexTokens(index, memory, value, weight) {
  const tokens = new Set(tokenize(value));
  for (const token of tokens) {
    if (!index.has(token)) index.set(token, new Map());
    const postings = index.get(token);
    postings.set(memory.id, (postings.get(memory.id) || 0) + weight);
  }
}

function sortNewestFirst(a, b) {
  return Number(b.pinned) - Number(a.pinned)
    || b.updatedAt - a.updatedAt
    || b.createdAt - a.createdAt;
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Some Windows filesystems do not allow opening/fsyncing a directory.
    // The data file itself is fsynced before rename, so the durable write remains guarded.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function atomicWriteFile(targetPath, content) {
  const directory = path.dirname(targetPath);
  const tempPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(tempPath, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, targetPath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[^0-9TZ-]/g, '-');
}

export class MemoryStore {
  constructor(memoryDirectory) {
    this.directory = path.resolve(memoryDirectory);
    this.storePath = path.join(this.directory, 'memories.json');
    this.backupDirectory = path.join(this.directory, 'backups');
    this.purgeManifestPath = path.join(this.directory, 'permanent-deletions.json');
    this.purgedIds = new Set();
    this.data = null;
    this.index = new Map();
    this.writeChain = Promise.resolve();
    this.recoveryInfo = { recovered: false, source: null };
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.mkdir(this.backupDirectory, { recursive: true });
    await this.loadPurgeManifest();
    await this.cleanupStaleTemporaryFiles();

    try {
      const loaded = await this.readAndValidateStore(this.storePath);
      this.data = this.applyPurgeTombstones(loaded);
      if (this.data.memories.length !== loaded.memories.length) {
        await atomicWriteFile(this.storePath, `${JSON.stringify(this.data, null, 2)}\n`);
        this.recoveryInfo = { recovered: true, source: 'permanent-deletion manifest' };
      }
      if (this.purgedIds.size) await this.scrubBackupsForPurgedIds();
      this.rebuildIndex();
      return { ...this.getStatus(), recovery: this.recoveryInfo };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const preservedPath = await this.preserveInvalidMainStore().catch(() => null);
        const recovered = await this.findLatestValidBackup();
        if (!recovered) {
          // Put the invalid main file back if there is no valid backup to recover.
          if (preservedPath) await fs.rename(preservedPath, this.storePath).catch(() => {});
          throw new MemoryStoreError(
            `The local memory store is unreadable and no valid backup could be recovered. The original file was preserved. Details: ${error.message}`,
            500,
            'MEMORY_RECOVERY_REQUIRED'
          );
        }
        this.data = this.applyPurgeTombstones(recovered.data);
        await atomicWriteFile(this.storePath, `${JSON.stringify(this.data, null, 2)}\n`);
        await this.scrubBackupsForPurgedIds();
        this.recoveryInfo = { recovered: true, source: recovered.name };
        console.warn(`[memory] Recovered ${this.data.memories.length} memories from backup ${recovered.name}.`);
      } else {
        const recovered = await this.findLatestValidBackup();
        if (recovered) {
          this.data = this.applyPurgeTombstones(recovered.data);
          await atomicWriteFile(this.storePath, `${JSON.stringify(this.data, null, 2)}\n`);
          await this.scrubBackupsForPurgedIds();
          this.recoveryInfo = { recovered: true, source: recovered.name };
          console.warn(`[memory] Restored missing memory store from backup ${recovered.name}.`);
        } else {
          this.data = {
            schemaVersion: MEMORY_SCHEMA_VERSION,
            revision: 0,
            updatedAt: nowMs(),
            memories: []
          };
          await atomicWriteFile(this.storePath, `${JSON.stringify(this.data, null, 2)}\n`);
        }
      }
    }
    if (this.purgedIds.size) await this.scrubBackupsForPurgedIds();
    this.rebuildIndex();
    return { ...this.getStatus(), recovery: this.recoveryInfo };
  }

  async loadPurgeManifest() {
    let raw;
    try {
      const stat = await fs.stat(this.purgeManifestPath);
      if (stat.size > 16 * 1024 * 1024) throw new Error('Permanent-deletion manifest exceeds the 16 MB safety limit.');
      raw = JSON.parse(await fs.readFile(this.purgeManifestPath, 'utf8'));
    }
    catch (error) {
      if (error.code !== 'ENOENT') {
        throw new MemoryStoreError(`The permanent-deletion manifest is unreadable; memory startup stopped to avoid restoring deleted data. Details: ${error.message}`, 500, 'PURGE_MANIFEST_RECOVERY_REQUIRED');
      }
      const empty = { schemaVersion: MEMORY_PURGE_SCHEMA_VERSION, updatedAt: nowMs(), ids: [] };
      await atomicWriteFile(this.purgeManifestPath, `${JSON.stringify(empty, null, 2)}\n`);
      this.purgedIds = new Set();
      return;
    }
    if (!isPlainObject(raw) || raw.schemaVersion !== MEMORY_PURGE_SCHEMA_VERSION || !Array.isArray(raw.ids) || raw.ids.length > MAX_PURGED_IDS) {
      throw new MemoryStoreError('The permanent-deletion manifest is invalid or uses an unsupported version. Memory startup stopped to protect deleted records.', 500, 'PURGE_MANIFEST_RECOVERY_REQUIRED');
    }
    const ids = new Set();
    for (const id of raw.ids) {
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
        throw new MemoryStoreError('The permanent-deletion manifest contains an invalid memory ID.', 500, 'PURGE_MANIFEST_RECOVERY_REQUIRED');
      }
      ids.add(id);
    }
    this.purgedIds = ids;
  }

  applyPurgeTombstones(data) {
    if (!this.purgedIds.size) return data;
    const memories = data.memories.filter((memory) => !this.purgedIds.has(memory.id));
    return memories.length === data.memories.length ? data : { ...data, memories };
  }

  async persistPurgeManifest(ids) {
    const ordered = [...ids].sort();
    if (ordered.length > MAX_PURGED_IDS) throw new MemoryStoreError('The permanent-deletion manifest reached its safety limit.', 413, 'PURGE_MANIFEST_LIMIT');
    const manifest = { schemaVersion: MEMORY_PURGE_SCHEMA_VERSION, updatedAt: nowMs(), ids: ordered };
    await atomicWriteFile(this.purgeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    this.purgedIds = new Set(ordered);
  }

  async cleanupStaleTemporaryFiles() {
    const cutoff = Date.now() - STALE_TEMP_AGE_MS;
    let removed = 0;
    for (const directory of [this.directory, this.backupDirectory]) {
      let names = [];
      try { names = await fs.readdir(directory); } catch { continue; }
      for (const name of names) {
        if (!TEMP_WRITE_PATTERN.test(name)) continue;
        const filePath = path.join(directory, name);
        try {
          const stat = await fs.lstat(filePath);
          if (stat.mtimeMs < cutoff && (stat.isFile() || stat.isSymbolicLink())) {
            await fs.rm(filePath, { force: true });
            removed += 1;
          }
        } catch { /* Another process may have removed the temporary entry. */ }
      }
      if (removed) await syncDirectory(directory);
    }
    return removed;
  }

  async scrubBackupsForPurgedIds() {
    if (!this.purgedIds.size) return;
    for (const entry of await this.listBackupFiles()) {
      let rawText;
      try { rawText = await fs.readFile(entry.filePath, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      let normalized;
      try { normalized = normalizeStoreData(JSON.parse(rawText)); }
      catch {
        // A corrupt snapshot is not restorable. Remove it so stale secret text is not retained indefinitely.
        await fs.rm(entry.filePath, { force: true });
        continue;
      }
      const filtered = this.applyPurgeTombstones(normalized);
      if (filtered !== normalized) await atomicWriteFile(entry.filePath, `${JSON.stringify(filtered, null, 2)}\n`);
    }
    await syncDirectory(this.backupDirectory);
  }

  async readAndValidateStore(filePath) {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_STORE_BYTES) {
      throw new MemoryStoreError(`The memory store exceeds the ${Math.round(MAX_STORE_BYTES / (1024 * 1024))} MB safety limit.`, 500, 'STORE_TOO_LARGE');
    }
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return normalizeStoreData(raw);
  }

  async preserveInvalidMainStore() {
    try {
      await fs.access(this.storePath);
    } catch {
      return null;
    }
    const destination = path.join(this.backupDirectory, `memory-corrupt-${backupTimestamp()}-${randomUUID()}.json`);
    await fs.rename(this.storePath, destination);
    return destination;
  }

  async listBackupFiles() {
    const names = await fs.readdir(this.backupDirectory).catch(() => []);
    const entries = [];
    for (const name of names) {
      if (!BACKUP_PATTERN.test(name)) continue;
      const filePath = path.join(this.backupDirectory, name);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile()) entries.push({ name, filePath, sizeBytes: stat.size, modifiedAt: stat.mtimeMs });
      } catch {
        // Ignore a backup removed during enumeration.
      }
    }
    return entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async findLatestValidBackup() {
    for (const backup of await this.listBackupFiles()) {
      try {
        return { ...backup, data: await this.readAndValidateStore(backup.filePath) };
      } catch {
        // Continue to an older, valid snapshot if the newest one is damaged.
      }
    }
    return null;
  }

  async createBackupOfCurrent() {
    let priorData;
    try { priorData = await this.readAndValidateStore(this.storePath); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    priorData = this.applyPurgeTombstones(priorData);
    const priorContents = `${JSON.stringify(priorData, null, 2)}\n`;
    const backupName = `memory-backup-${backupTimestamp()}-${randomUUID()}.json`;
    const target = path.join(this.backupDirectory, backupName);
    // Write snapshots atomically as well: an interrupted copy must never look like a valid backup.
    await atomicWriteFile(target, priorContents);
    await syncDirectory(this.backupDirectory);
    await this.trimBackups();
    return backupName;
  }

  async trimBackups() {
    const backups = await this.listBackupFiles();
    let keptCount = 0;
    let keptBytes = 0;
    for (const backup of backups) {
      const withinCount = keptCount < MAX_BACKUPS;
      const withinBytes = keptCount === 0 || keptBytes + backup.sizeBytes <= MAX_BACKUP_BYTES;
      if (withinCount && withinBytes) {
        keptCount += 1;
        keptBytes += backup.sizeBytes;
      } else {
        await fs.rm(backup.filePath, { force: true }).catch(() => {});
      }
    }
    await syncDirectory(this.backupDirectory);
  }

  rebuildIndex() {
    this.index = new Map();
    if (!this.data) return;
    for (const memory of this.data.memories) {
      addIndexTokens(this.index, memory, memory.title, 8);
      addIndexTokens(this.index, memory, memory.tags.join(' '), 6);
      addIndexTokens(this.index, memory, memory.category, 4);
      addIndexTokens(this.index, memory, memory.content, 1);
    }
  }

  getStatus() {
    const memories = this.data?.memories || [];
    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      revision: this.data?.revision || 0,
      updatedAt: this.data?.updatedAt || null,
      count: memories.filter((memory) => !memory.deletedAt).length,
      deletedCount: memories.filter((memory) => Boolean(memory.deletedAt)).length
    };
  }

  async commit(nextData) {
    const normalized = normalizeStoreData(this.applyPurgeTombstones(nextData));
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
      throw new MemoryStoreError(`The memory store has reached the ${Math.round(MAX_STORE_BYTES / (1024 * 1024))} MB size limit.`, 413, 'STORE_SIZE_LIMIT');
    }
    await this.createBackupOfCurrent();
    await atomicWriteFile(this.storePath, serialized);
    this.data = normalized;
    this.rebuildIndex();
    await this.trimBackups();
    return this.getStatus();
  }

  enqueueWrite(task) {
    const operation = this.writeChain.then(task, task);
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  requireLoaded() {
    if (!this.data) throw new MemoryStoreError('The memory store has not been initialized.', 500, 'STORE_NOT_INITIALIZED');
  }

  get(id, { includeDeleted = false } = {}) {
    this.requireLoaded();
    const record = this.data.memories.find((memory) => memory.id === id);
    if (!record || (record.deletedAt && !includeDeleted)) throw new MemoryStoreError('Memory not found.', 404, 'MEMORY_NOT_FOUND');
    return clone(record);
  }

  list({ q = '', category, tag, includeDeleted = false, deletedOnly = false, limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
    this.requireLoaded();
    if (typeof q !== 'string' || q.length > 200) throw new MemoryStoreError('Search text must be 200 characters or fewer.');
    if (category !== undefined && category !== '' && !MEMORY_CATEGORIES.includes(category)) {
      throw new MemoryStoreError(`Category must be one of: ${MEMORY_CATEGORIES.join(', ')}.`);
    }
    const normalizedTag = tag === undefined || tag === '' ? '' : assertText(tag, 'Tag filter', MAX_TAG_LENGTH, { required: true }).toLocaleLowerCase('en-US');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new MemoryStoreError(`Limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) throw new MemoryStoreError(`Offset must be an integer from 0 to ${MAX_OFFSET}.`);

    const query = q.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    const queryTokens = [...new Set(tokenize(query))];
    let candidateScores = null;
    if (queryTokens.length) {
      candidateScores = new Map();
      for (const token of queryTokens) {
        for (const [id, weight] of this.index.get(token) || []) {
          candidateScores.set(id, (candidateScores.get(id) || 0) + weight);
        }
      }
    }

    let records = this.data.memories.filter((memory) => {
      if (deletedOnly) { if (!memory.deletedAt) return false; }
      else if (!includeDeleted && memory.deletedAt) return false;
      if (category && category !== '' && memory.category !== category) return false;
      if (normalizedTag && !memory.tags.some((item) => item.toLocaleLowerCase('en-US') === normalizedTag)) return false;
      if (candidateScores && !candidateScores.has(memory.id)) return false;
      return true;
    });

    if (candidateScores) {
      records.sort((a, b) => {
        const phraseScore = (memory) => {
          const title = memory.title.toLocaleLowerCase('en-US');
          const content = memory.content.toLocaleLowerCase('en-US');
          return (title.includes(query) ? 12 : 0) + (content.includes(query) ? 4 : 0);
        };
        return (phraseScore(b) + (candidateScores.get(b.id) || 0) + (b.pinned ? 2 : 0))
          - (phraseScore(a) + (candidateScores.get(a.id) || 0) + (a.pinned ? 2 : 0))
          || sortNewestFirst(a, b);
      });
    } else {
      records.sort(sortNewestFirst);
    }

    const total = records.length;
    const items = records.slice(offset, offset + limit).map(clone);
    return { items, total, limit, offset, hasMore: offset + items.length < total };
  }

  create(input) {
    return this.enqueueWrite(async () => {
      this.requireLoaded();
      if (!isPlainObject(input)) throw new MemoryStoreError('Memory body must be a JSON object.');
      assertAllowedKeys(input, ['title', 'content', 'category', 'tags', 'importance', 'pinned', 'source'], 'memory');
      if (this.data.memories.length >= MAX_MEMORIES) throw new MemoryStoreError(`The store has reached the ${MAX_MEMORIES.toLocaleString()} memory limit.`, 413, 'MEMORY_LIMIT_REACHED');
      const timestamp = nowMs();
      const content = assertText(input.content, 'Memory content', MAX_CONTENT_LENGTH, { required: true });
      const titleInput = input.title === undefined || input.title === '' ? content.split(/\r?\n/, 1)[0].replace(/^#{1,6}\s+/, '').slice(0, MAX_TITLE_LENGTH).trim() : input.title;
      const title = assertText(titleInput || 'Untitled memory', 'Memory title', MAX_TITLE_LENGTH, { required: true });
      const record = {
        id: randomUUID(),
        title,
        content,
        category: normalizeCategory(input.category),
        tags: normalizeTags(input.tags),
        importance: normalizeImportance(input.importance),
        pinned: input.pinned === undefined ? false : input.pinned,
        source: normalizeSource(input.source),
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        revision: 1
      };
      if (typeof record.pinned !== 'boolean') throw new MemoryStoreError('Pinned must be a boolean.');
      const next = { ...this.data, revision: this.data.revision + 1, updatedAt: timestamp, memories: [...this.data.memories, record] };
      await this.commit(next);
      return clone(record);
    });
  }

  update(id, changes) {
    return this.enqueueWrite(async () => {
      this.requireLoaded();
      if (!isPlainObject(changes)) throw new MemoryStoreError('Update body must be a JSON object.');
      assertAllowedKeys(changes, ['title', 'content', 'category', 'tags', 'importance', 'pinned', 'source'], 'update');
      const index = this.data.memories.findIndex((memory) => memory.id === id && !memory.deletedAt);
      if (index < 0) throw new MemoryStoreError('Memory not found.', 404, 'MEMORY_NOT_FOUND');
      const current = this.data.memories[index];
      const nextRecord = { ...current };
      if (Object.hasOwn(changes, 'title')) nextRecord.title = assertText(changes.title, 'Memory title', MAX_TITLE_LENGTH, { required: true });
      if (Object.hasOwn(changes, 'content')) nextRecord.content = assertText(changes.content, 'Memory content', MAX_CONTENT_LENGTH, { required: true });
      if (Object.hasOwn(changes, 'category')) nextRecord.category = normalizeCategory(changes.category);
      if (Object.hasOwn(changes, 'tags')) nextRecord.tags = normalizeTags(changes.tags);
      if (Object.hasOwn(changes, 'importance')) nextRecord.importance = normalizeImportance(changes.importance);
      if (Object.hasOwn(changes, 'pinned')) {
        if (typeof changes.pinned !== 'boolean') throw new MemoryStoreError('Pinned must be a boolean.');
        nextRecord.pinned = changes.pinned;
      }
      if (Object.hasOwn(changes, 'source')) nextRecord.source = normalizeSource(changes.source);
      const timestamp = nowMs();
      nextRecord.updatedAt = timestamp;
      nextRecord.revision = current.revision + 1;
      const memories = this.data.memories.slice();
      memories[index] = nextRecord;
      const next = { ...this.data, revision: this.data.revision + 1, updatedAt: timestamp, memories };
      await this.commit(next);
      return clone(nextRecord);
    });
  }

  softDelete(id) {
    return this.enqueueWrite(async () => {
      this.requireLoaded();
      const index = this.data.memories.findIndex((memory) => memory.id === id && !memory.deletedAt);
      if (index < 0) throw new MemoryStoreError('Memory not found.', 404, 'MEMORY_NOT_FOUND');
      const timestamp = nowMs();
      const memories = this.data.memories.slice();
      memories[index] = { ...memories[index], deletedAt: timestamp, updatedAt: timestamp, revision: memories[index].revision + 1 };
      await this.commit({ ...this.data, revision: this.data.revision + 1, updatedAt: timestamp, memories });
      return clone(memories[index]);
    });
  }

  restore(id) {
    return this.enqueueWrite(async () => {
      this.requireLoaded();
      const index = this.data.memories.findIndex((memory) => memory.id === id && Boolean(memory.deletedAt));
      if (index < 0) throw new MemoryStoreError('Deleted memory not found.', 404, 'MEMORY_NOT_FOUND');
      const timestamp = nowMs();
      const memories = this.data.memories.slice();
      memories[index] = { ...memories[index], deletedAt: null, updatedAt: timestamp, revision: memories[index].revision + 1 };
      await this.commit({ ...this.data, revision: this.data.revision + 1, updatedAt: timestamp, memories });
      return clone(memories[index]);
    });
  }

  permanentlyDelete(id) {
    return this.enqueueWrite(async () => {
      this.requireLoaded();
      const index = this.data.memories.findIndex((memory) => memory.id === id);
      if (index < 0) throw new MemoryStoreError('Memory not found.', 404, 'MEMORY_NOT_FOUND');

      // Persist a tombstone first. If the process stops at any later point, startup and
      // backup restore will still filter this ID, preventing an old snapshot from reviving it.
      const nextPurgedIds = new Set(this.purgedIds);
      nextPurgedIds.add(id);
      await this.persistPurgeManifest(nextPurgedIds);

      const timestamp = nowMs();
      const memories = this.data.memories.filter((memory) => memory.id !== id);
      const nextData = normalizeStoreData({ ...this.data, revision: this.data.revision + 1, updatedAt: timestamp, memories });
      const serialized = `${JSON.stringify(nextData, null, 2)}\n`;
      if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) throw new MemoryStoreError('The memory store exceeds its safety limit.', 413, 'STORE_SIZE_LIMIT');

      // Remove it from live reads immediately, even if disk cleanup subsequently fails.
      this.data = nextData;
      this.rebuildIndex();

      // Backups are scrubbed before the new main file is written. The tombstone protects
      // restore if power is interrupted during this pass; init retries cleanup on restart.
      await this.scrubBackupsForPurgedIds();
      await atomicWriteFile(this.storePath, serialized);
      await this.trimBackups();
      return { id, permanentlyDeleted: true };
    });
  }

  applyBatch(operations) {
    return this.enqueueWrite(async () => {
      this.requireLoaded();
      if (!Array.isArray(operations) || operations.length < 1 || operations.length > 60) {
        throw new MemoryStoreError('Apply between 1 and 60 reviewed memory changes at a time.');
      }
      const timestamp = nowMs();
      let memories = this.data.memories.slice();
      const results = [];
      const touchedIds = new Set();
      for (const operation of operations) {
        if (!isPlainObject(operation)) throw new MemoryStoreError('Each batch operation must be an object.');
        assertAllowedKeys(operation, ['action', 'id', 'memory'], 'batch operation');
        const action = operation.action;
        const input = operation.memory;
        if (!isPlainObject(input)) throw new MemoryStoreError('Each batch operation needs a memory object.');
        assertAllowedKeys(input, ['title', 'content', 'category', 'tags', 'importance', 'pinned', 'source'], 'memory');
        if (action === 'create') {
          if (memories.length >= MAX_MEMORIES) throw new MemoryStoreError(`The store has reached the ${MAX_MEMORIES.toLocaleString()} memory limit.`, 413, 'MEMORY_LIMIT_REACHED');
          const content = assertText(input.content, 'Memory content', MAX_CONTENT_LENGTH, { required: true });
          const titleInput = input.title === undefined || input.title === '' ? content.split(/\r?\n/, 1)[0].replace(/^#{1,6}\s+/, '').slice(0, MAX_TITLE_LENGTH).trim() : input.title;
          const record = {
            id: randomUUID(),
            title: assertText(titleInput || 'Untitled memory', 'Memory title', MAX_TITLE_LENGTH, { required: true }),
            content,
            category: normalizeCategory(input.category),
            tags: normalizeTags(input.tags),
            importance: normalizeImportance(input.importance),
            pinned: input.pinned === undefined ? false : input.pinned,
            source: normalizeSource(input.source, 'ai'),
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
            revision: 1
          };
          if (typeof record.pinned !== 'boolean') throw new MemoryStoreError('Pinned must be a boolean.');
          memories.push(record);
          results.push(clone(record));
          continue;
        }
        if (action !== 'update' || typeof operation.id !== 'string' || !operation.id) throw new MemoryStoreError('Batch action must be create or update with a valid memory ID.');
        if (touchedIds.has(operation.id)) throw new MemoryStoreError('A memory can only be updated once per batch.');
        touchedIds.add(operation.id);
        const index = memories.findIndex((memory) => memory.id === operation.id && !memory.deletedAt);
        if (index < 0) throw new MemoryStoreError(`Memory ${operation.id} no longer exists; refresh the review and try again.`, 409, 'MEMORY_CHANGED');
        const current = memories[index];
        const nextRecord = { ...current };
        if (Object.hasOwn(input, 'title')) nextRecord.title = assertText(input.title, 'Memory title', MAX_TITLE_LENGTH, { required: true });
        if (Object.hasOwn(input, 'content')) nextRecord.content = assertText(input.content, 'Memory content', MAX_CONTENT_LENGTH, { required: true });
        if (Object.hasOwn(input, 'category')) nextRecord.category = normalizeCategory(input.category);
        if (Object.hasOwn(input, 'tags')) nextRecord.tags = normalizeTags(input.tags);
        if (Object.hasOwn(input, 'importance')) nextRecord.importance = normalizeImportance(input.importance);
        if (Object.hasOwn(input, 'pinned')) {
          if (typeof input.pinned !== 'boolean') throw new MemoryStoreError('Pinned must be a boolean.');
          nextRecord.pinned = input.pinned;
        }
        if (Object.hasOwn(input, 'source')) nextRecord.source = normalizeSource(input.source, 'ai');
        nextRecord.updatedAt = timestamp;
        nextRecord.revision = current.revision + 1;
        memories[index] = nextRecord;
        results.push(clone(nextRecord));
      }
      await this.commit({ ...this.data, revision: this.data.revision + 1, updatedAt: timestamp, memories });
      return { items: results, status: this.getStatus() };
    });
  }

  async listBackups() {
    const entries = await this.listBackupFiles();
    const valid = [];
    for (const entry of entries) {
      try {
        const data = this.applyPurgeTombstones(await this.readAndValidateStore(entry.filePath));
        valid.push({ name: entry.name, sizeBytes: entry.sizeBytes, createdAt: entry.modifiedAt, revision: data.revision, memoryCount: data.memories.length });
      } catch {
        // Invalid snapshots are not exposed as restorable backups.
      }
    }
    return valid;
  }

  restoreBackup(backupName) {
    return this.enqueueWrite(async () => {
      this.requireLoaded();
      if (typeof backupName !== 'string' || !BACKUP_PATTERN.test(backupName) || path.basename(backupName) !== backupName) {
        throw new MemoryStoreError('Choose a valid memory backup name.');
      }
      const filePath = path.join(this.backupDirectory, backupName);
      let restored;
      try { restored = this.applyPurgeTombstones(await this.readAndValidateStore(filePath)); }
      catch (error) {
        if (error.code === 'ENOENT') throw new MemoryStoreError('Memory backup not found.', 404, 'BACKUP_NOT_FOUND');
        throw new MemoryStoreError('That memory backup is not valid and cannot be restored.', 400, 'INVALID_BACKUP');
      }
      const timestamp = nowMs();
      const next = {
        ...restored,
        revision: this.data.revision + 1,
        updatedAt: timestamp
      };
      await this.commit(next);
      return { ...this.getStatus(), restoredFrom: backupName };
    });
  }
}
