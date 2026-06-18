// Persistent client-side cache so reopening the same area does not re-download
// the DEM, satellite tiles, OSM or land cover. Entries live in IndexedDB
// (survives reloads/sessions) fronted by an in-memory Map (instant repeat reads
// within a session). Everything fails soft: if IndexedDB is missing or throws,
// callers transparently fall back to a plain network fetch.

const CACHE_VERSION = 'v1'; // bump to invalidate every cached entry
const DB_NAME = `flood-map-cache-${CACHE_VERSION}`;
const STORE = 'entries';
const SIZE_BUDGET_BYTES = 250 * 1024 * 1024;
// The in-RAM mirror is bounded separately and much tighter than IndexedDB: it
// holds decoded DEM ArrayBuffers + satellite tile Blobs, which otherwise pile up
// in the JS heap for every location loaded in a session (a slow leak).
const MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;

type StoredKind = 'arraybuffer' | 'blob' | 'json';

interface CacheRecord {
  key: string;
  kind: StoredKind;
  body: ArrayBuffer | Blob | unknown;
  bytes: number;
  lastUsed: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key: string): Promise<CacheRecord | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await reqToPromise(txStore(db, 'readonly').get(key) as IDBRequest<CacheRecord | undefined>);
  } catch {
    return undefined;
  }
}

async function dbPut(record: CacheRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await reqToPromise(txStore(db, 'readwrite').put(record));
    await evictIfNeeded(db);
  } catch {
    /* fail soft — caching is best effort */
  }
}

async function dbTouch(key: string, lastUsed: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const store = txStore(db, 'readwrite');
    const record = await reqToPromise(store.get(key) as IDBRequest<CacheRecord | undefined>);
    if (record) {
      record.lastUsed = lastUsed;
      store.put(record);
    }
  } catch {
    /* ignore — touch is only an LRU hint */
  }
}

// Evict least-recently-used records until total bytes fit the budget.
async function evictIfNeeded(db: IDBDatabase): Promise<void> {
  try {
    const all = await reqToPromise(txStore(db, 'readonly').getAll() as IDBRequest<CacheRecord[]>);
    let total = all.reduce((sum, r) => sum + r.bytes, 0);
    if (total <= SIZE_BUDGET_BYTES) return;
    const byOldest = all.sort((a, b) => a.lastUsed - b.lastUsed);
    const store = txStore(db, 'readwrite');
    for (const record of byOldest) {
      if (total <= SIZE_BUDGET_BYTES) break;
      store.delete(record.key);
      total -= record.bytes;
    }
  } catch {
    /* ignore — over-budget is tolerable, eviction is opportunistic */
  }
}

const memory = new Map<string, CacheRecord>();
let memoryBytes = 0;

// Insert/replace into the RAM mirror, tracking total bytes and evicting the
// least-recently-used entries once over budget (the IndexedDB copy survives, so
// an evicted entry just costs one re-read instead of a re-download).
function memorySet(record: CacheRecord): void {
  const prev = memory.get(record.key);
  if (prev) memoryBytes -= prev.bytes;
  memory.set(record.key, record);
  memoryBytes += record.bytes;
  if (memoryBytes <= MEMORY_BUDGET_BYTES) return;
  for (const r of [...memory.values()].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (memoryBytes <= MEMORY_BUDGET_BYTES || r.key === record.key) continue;
    memory.delete(r.key);
    memoryBytes -= r.bytes;
  }
}

function now(): number {
  return Date.now();
}

export function recordBytes(kind: StoredKind, body: ArrayBuffer | Blob | unknown): number {
  if (kind === 'arraybuffer') return (body as ArrayBuffer).byteLength;
  if (kind === 'blob') return (body as Blob).size;
  try {
    return JSON.stringify(body).length;
  } catch {
    return 0;
  }
}

async function readCache(key: string): Promise<CacheRecord | undefined> {
  const hit = memory.get(key);
  if (hit) {
    hit.lastUsed = now();
    void dbTouch(key, hit.lastUsed);
    return hit;
  }
  const record = await dbGet(key);
  if (record) {
    record.lastUsed = now();
    memorySet(record);
    void dbTouch(key, record.lastUsed);
  }
  return record;
}

function writeCache(key: string, kind: StoredKind, body: ArrayBuffer | Blob | unknown): void {
  const record: CacheRecord = { key, kind, body, bytes: recordBytes(kind, body), lastUsed: now() };
  memorySet(record);
  void dbPut(record);
}

export interface CacheOpts {
  key?: string;
  init?: RequestInit;
}

export async function cachedArrayBuffer(url: string, opts: CacheOpts = {}): Promise<ArrayBuffer> {
  const key = opts.key ?? url;
  const hit = await readCache(key);
  if (hit && hit.kind === 'arraybuffer') return hit.body as ArrayBuffer;

  const resp = await fetch(url, opts.init);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  writeCache(key, 'arraybuffer', buf);
  return buf;
}

export async function cachedJson<T = unknown>(url: string, opts: CacheOpts = {}): Promise<T> {
  const key = opts.key ?? url;
  const hit = await readCache(key);
  if (hit && hit.kind === 'json') return hit.body as T;

  const resp = await fetch(url, opts.init);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = (await resp.json()) as T;
  writeCache(key, 'json', json);
  return json;
}

export async function cachedBlob(url: string, opts: CacheOpts = {}): Promise<Blob> {
  const key = opts.key ?? url;
  const hit = await readCache(key);
  if (hit && hit.kind === 'blob') return hit.body as Blob;

  const resp = await fetch(url, opts.init);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  writeCache(key, 'blob', blob);
  return blob;
}

// Loads an Image from a cached Blob via an object URL. blob: URLs are
// same-origin, so the decode canvas stays untainted (no crossOrigin needed).
export function cachedImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    cachedBlob(url).then(
      (blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error(`Image decode failed: ${url}`));
        };
        img.src = objectUrl;
      },
      reject,
    );
  });
}

// Decodes a cached Blob to an ImageBitmap. Unlike cachedImage (HTMLImageElement),
// this works on a Web Worker too — the DEM/bathymetry decode path uses it so the
// geo build can run off the main thread.
export async function cachedBitmap(url: string): Promise<ImageBitmap> {
  const blob = await cachedBlob(url);
  return createImageBitmap(blob);
}

// Store an already-fetched/validated body so a caller that did its own fetch
// (e.g. with retry + size validation) can still populate the cache.
export function putArrayBuffer(key: string, buf: ArrayBuffer): void {
  writeCache(key, 'arraybuffer', buf);
}

export async function peekArrayBuffer(key: string): Promise<ArrayBuffer | undefined> {
  const hit = await readCache(key);
  return hit && hit.kind === 'arraybuffer' ? (hit.body as ArrayBuffer) : undefined;
}
