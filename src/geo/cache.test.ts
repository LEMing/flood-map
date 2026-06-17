// Pure-logic tests for the client-side HTTP cache.
//
// The IndexedDB layer is irreducibly IO and, under Node (vitest's default
// environment), `indexedDB` is undefined so `openDb()` resolves to null and
// every DB path fails soft to a no-op. That leaves the in-memory Map as the
// effective store, which lets us exercise the real caching invariants without
// mocking IndexedDB at all. We test:
//   - recordBytes: the pure size accounting per StoredKind (+ its fail-soft path)
//   - the write/read round-trip via putArrayBuffer/peekArrayBuffer
//   - the kind-discriminated hit logic (a key stored as one kind is NOT served
//     as another) for both peekArrayBuffer and the cached* fetch wrappers
//   - the fetch wrappers' miss->fetch / hit->no-fetch behaviour, HTTP-error
//     propagation, and opts.key overriding the URL as the cache key
//
// `memory` is a module-level Map shared across the suite, so every test uses a
// fresh, unique key/URL to stay order-independent and self-contained.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  recordBytes,
  putArrayBuffer,
  peekArrayBuffer,
  cachedArrayBuffer,
  cachedJson,
  cachedBlob,
} from './cache';

let keySeq = 0;
function freshKey(label: string): string {
  keySeq += 1;
  return `https://example.test/${label}/${keySeq}`;
}

function bufferOf(...bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recordBytes', () => {
  it('reports the byteLength of an ArrayBuffer', () => {
    expect(recordBytes('arraybuffer', new ArrayBuffer(0))).toBe(0);
    expect(recordBytes('arraybuffer', new ArrayBuffer(42))).toBe(42);
    expect(recordBytes('arraybuffer', bufferOf(1, 2, 3, 4))).toBe(4);
  });

  it('reports the size of a Blob', () => {
    expect(recordBytes('blob', new Blob([]))).toBe(0);
    // 5 single-byte ASCII chars -> 5 bytes.
    expect(recordBytes('blob', new Blob(['hello']))).toBe(5);
    expect(recordBytes('blob', new Blob([new Uint8Array(16)]))).toBe(16);
  });

  it('uses the JSON string length for json bodies', () => {
    const body = { a: 1, b: 'xy' };
    expect(recordBytes('json', body)).toBe(JSON.stringify(body).length);
    expect(recordBytes('json', [])).toBe('[]'.length);
    expect(recordBytes('json', null)).toBe('null'.length);
  });

  it('fails soft to 0 when a json body cannot be stringified (cycle)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic; // JSON.stringify throws on circular refs
    expect(recordBytes('json', cyclic)).toBe(0);
  });
});

describe('in-memory round-trip via putArrayBuffer / peekArrayBuffer', () => {
  it('returns undefined for a key that was never written', async () => {
    await expect(peekArrayBuffer(freshKey('never'))).resolves.toBeUndefined();
  });

  it('reads back the exact buffer that was stored', async () => {
    const key = freshKey('rt');
    const buf = bufferOf(9, 8, 7);
    putArrayBuffer(key, buf);

    const got = await peekArrayBuffer(key);
    expect(got).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(got!)).toEqual(new Uint8Array([9, 8, 7]));
    // Same identity object served from the in-memory layer.
    expect(got).toBe(buf);
  });

  it('overwrites a previously stored buffer for the same key', async () => {
    const key = freshKey('overwrite');
    putArrayBuffer(key, bufferOf(1, 1, 1));
    putArrayBuffer(key, bufferOf(2, 2));

    const got = await peekArrayBuffer(key);
    expect(new Uint8Array(got!)).toEqual(new Uint8Array([2, 2]));
  });
});

describe('cachedArrayBuffer', () => {
  it('fetches on a cold miss then serves the warm hit without re-fetching', async () => {
    const url = freshKey('cab-hit');
    const payload = bufferOf(4, 5, 6);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await cachedArrayBuffer(url);
    expect(new Uint8Array(first)).toEqual(new Uint8Array([4, 5, 6]));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await cachedArrayBuffer(url);
    expect(second).toBe(first); // identical cached object
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second network call
  });

  it('throws on a non-ok response and caches nothing', async () => {
    const url = freshKey('cab-404');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      arrayBuffer: async () => bufferOf(0),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(cachedArrayBuffer(url)).rejects.toThrow('HTTP 404');
    // Nothing was written, so a subsequent peek still misses.
    await expect(peekArrayBuffer(url)).resolves.toBeUndefined();
  });

  it('passes opts.init through to fetch', async () => {
    const url = freshKey('cab-init');
    const init: RequestInit = { headers: { Range: 'bytes=0-1' } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bufferOf(1),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cachedArrayBuffer(url, { init });
    expect(fetchMock).toHaveBeenCalledWith(url, init);
  });

  it('uses opts.key as the cache key so two URLs share one entry', async () => {
    const sharedKey = freshKey('shared');
    const urlA = freshKey('cab-urlA');
    const urlB = freshKey('cab-urlB');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bufferOf(7),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cachedArrayBuffer(urlA, { key: sharedKey });
    // Different URL, same key -> served from cache, fetch not called again.
    const fromB = await cachedArrayBuffer(urlB, { key: sharedKey });
    expect(new Uint8Array(fromB)).toEqual(new Uint8Array([7]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares the entry written by putArrayBuffer (no fetch on hit)', async () => {
    const key = freshKey('cab-prewarm');
    putArrayBuffer(key, bufferOf(3, 3, 3));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const got = await cachedArrayBuffer(key);
    expect(new Uint8Array(got)).toEqual(new Uint8Array([3, 3, 3]));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cachedJson', () => {
  it('fetches once then serves the parsed object from cache', async () => {
    const url = freshKey('json-hit');
    const data = { ok: true, items: [1, 2, 3] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => data,
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await cachedJson<typeof data>(url);
    expect(first).toEqual(data);
    const second = await cachedJson<typeof data>(url);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-ok response', async () => {
    const url = freshKey('json-500');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(cachedJson(url)).rejects.toThrow('HTTP 500');
  });
});

describe('cachedBlob', () => {
  it('fetches once then serves the blob from cache', async () => {
    const url = freshKey('blob-hit');
    const blob = new Blob(['abcd']);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await cachedBlob(url);
    expect(first).toBe(blob);
    const second = await cachedBlob(url);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-ok response', async () => {
    const url = freshKey('blob-403');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      blob: async () => new Blob([]),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(cachedBlob(url)).rejects.toThrow('HTTP 403');
  });
});

describe('kind-discriminated cache hits', () => {
  it('peekArrayBuffer ignores a hit stored under a different kind', async () => {
    const url = freshKey('kind-json-vs-ab');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stored: 'as-json' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cachedJson(url); // writes kind 'json' under this key
    // peekArrayBuffer only matches kind 'arraybuffer' -> miss despite a record.
    await expect(peekArrayBuffer(url)).resolves.toBeUndefined();
  });

  it('cachedArrayBuffer re-fetches when the cached entry is a different kind', async () => {
    const url = freshKey('kind-refetch');
    const jsonFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ a: 1 }),
    });
    vi.stubGlobal('fetch', jsonFetch);
    await cachedJson(url); // entry is now kind 'json'

    const abFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bufferOf(1, 2),
    });
    vi.stubGlobal('fetch', abFetch);

    // Same key, but the existing 'json' entry must not satisfy an arraybuffer
    // request, so a real fetch happens.
    const got = await cachedArrayBuffer(url);
    expect(new Uint8Array(got)).toEqual(new Uint8Array([1, 2]));
    expect(abFetch).toHaveBeenCalledTimes(1);
  });
});
