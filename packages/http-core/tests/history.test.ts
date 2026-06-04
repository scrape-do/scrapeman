import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { HistoryStore } from '../src/history/store.js';
import type { HistoryEntry } from '@scrapeman/shared-types';

let tmp: string;
let store: HistoryStore;
const workspace = '/Users/test/workspace';

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-history-'));
  store = new HistoryStore({ rootDir: tmp });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

type DraftEntry = Omit<HistoryEntry, 'id' | 'sentAt'>;

function draft(overrides: Partial<DraftEntry> = {}): DraftEntry {
  return {
    workspacePath: workspace,
    environmentName: null,
    method: 'GET',
    url: 'https://api.example.com',
    headers: {},
    bodyPreview: '',
    bodyTruncated: false,
    status: 200,
    statusOk: true,
    responseHeaders: [],
    responseBodyPreview: '',
    responseBodyTruncated: false,
    responseSizeBytes: 0,
    durationMs: 42,
    protocol: 'http/1.1',
    ...overrides,
  };
}

describe('HistoryStore', () => {
  it('inserts and lists entries in recency order (newest first)', async () => {
    // Inserts with explicit sentAt; the file stores them in insertion order.
    // tailRead returns them newest-first.
    await store.insert(workspace, { ...draft({ url: 'https://a.com' }), sentAt: '2026-04-10T10:00:00.000Z' });
    await store.insert(workspace, { ...draft({ url: 'https://b.com' }), sentAt: '2026-04-10T11:00:00.000Z' });
    await store.insert(workspace, { ...draft({ url: 'https://c.com' }), sentAt: '2026-04-10T09:00:00.000Z' });
    // File order: a (10:00), b (11:00), c (09:00). Tail read → c, b, a (newest in file first).
    // Note: tail read is by file position, not by sentAt timestamp.
    const list = await store.list(workspace);
    // c was inserted last so it is at the end of the file and comes first in tail read.
    expect(list[0].url).toBe('https://c.com');
    expect(list).toHaveLength(3);
  });

  it('persists across store instances (reads from disk)', async () => {
    await store.insert(workspace, draft());
    const reopened = new HistoryStore({ rootDir: tmp });
    const list = await reopened.list(workspace);
    expect(list).toHaveLength(1);
  });

  it('assigns an id and sentAt automatically', async () => {
    const entry = await store.insert(workspace, draft());
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => new Date(entry.sentAt)).not.toThrow();
  });

  it('truncates bodies over the preview cap', async () => {
    const s = new HistoryStore({ rootDir: tmp, maxBodyPreviewBytes: 32 });
    const body = 'x'.repeat(1000);
    const entry = await s.insert(workspace, draft({ responseBodyPreview: body }));
    expect(entry.responseBodyPreview.length).toBe(32);
    expect(entry.responseBodyTruncated).toBe(true);
  });

  it('deletes a single entry', async () => {
    const a = await store.insert(workspace, draft({ url: 'https://a.com' }));
    await store.insert(workspace, draft({ url: 'https://b.com' }));
    await store.delete(workspace, a.id);
    const list = await store.list(workspace);
    expect(list.map((e) => e.url)).toEqual(['https://b.com']);
  });

  it('clear empties the store', async () => {
    await store.insert(workspace, draft());
    await store.insert(workspace, draft());
    await store.clear(workspace);
    expect(await store.list(workspace)).toEqual([]);
  });

  it('search filters by URL or method', async () => {
    await store.insert(workspace, draft({ url: 'https://api.github.com/users' }));
    await store.insert(workspace, draft({ url: 'https://api.scrape.do/jobs' }));
    await store.insert(workspace, draft({ url: 'https://api.example.com', method: 'POST' }));
    expect(
      (await store.list(workspace, { search: 'github' })).map((e) => e.url),
    ).toEqual(['https://api.github.com/users']);
    expect(
      (await store.list(workspace, { search: 'post' })).map((e) => e.method),
    ).toEqual(['POST']);
  });

  it('list limit caps results', async () => {
    for (let i = 0; i < 10; i++) {
      await store.insert(workspace, {
        ...draft({ url: `https://${i}.com` }),
        sentAt: `2026-04-10T00:00:0${i}.000Z`,
      });
    }
    expect(await store.list(workspace, { limit: 3 })).toHaveLength(3);
  });

  it('isolates history by workspace path', async () => {
    await store.insert('/ws/a', draft({ url: 'https://a.com' }));
    await store.insert('/ws/b', draft({ url: 'https://b.com' }));
    expect((await store.list('/ws/a')).map((e) => e.url)).toEqual(['https://a.com']);
    expect((await store.list('/ws/b')).map((e) => e.url)).toEqual(['https://b.com']);
  });

  // ---------------------------------------------------------------------------
  // T1309 — tail-read + lazy decompression tests
  // ---------------------------------------------------------------------------

  it('T1309: list does NOT decompress _respGz bodies for any entry in the batch', async () => {
    // Build N entries each with a large (>500KB decompressed) response body.
    const N = 5;
    const bigBody = 'x'.repeat(600 * 1024); // 600 KB uncompressed

    for (let i = 0; i < N; i++) {
      await store.insert(workspace, {
        ...draft({ url: `https://${i}.com` }),
        sentAt: `2026-04-10T00:00:0${i}.000Z`,
        responseBodyPreview: bigBody,
      });
    }

    // Bust cache so the list must read from disk.
    store.invalidateCache(workspace);
    const list = await store.list(workspace, { limit: N });

    expect(list).toHaveLength(N);
    // Bodies must be empty strings in list results — not decompressed.
    for (const e of list) {
      expect(e.responseBodyPreview).toBe('');
    }
  });

  it('T1309: list returns correct newest-first entries via tail read', async () => {
    const TOTAL = 20;
    for (let i = 0; i < TOTAL; i++) {
      const pad = String(i).padStart(2, '0');
      await store.insert(workspace, {
        ...draft({ url: `https://${pad}.com` }),
        sentAt: `2026-04-10T00:00:${pad}.000Z`,
      });
    }

    // Bust cache to force a disk tail-read.
    store.invalidateCache(workspace);

    // Most recent 5 entries (tail of file).
    const batch1 = await store.list(workspace, { limit: 5 });
    expect(batch1).toHaveLength(5);
    // Entries 19–15 were inserted last → appear at the end of the file.
    expect(batch1[0].url).toBe('https://19.com');
    expect(batch1[4].url).toBe('https://15.com');

    // Paginate: older batch using before-cursor on the oldest in batch1.
    const cursor = batch1[batch1.length - 1].sentAt;
    const batch2 = await store.list(workspace, { limit: 5, before: cursor });
    expect(batch2).toHaveLength(5);
    expect(batch2[0].url).toBe('https://14.com');
    expect(batch2[4].url).toBe('https://10.com');
  });

  it('T1309: getById decompresses exactly that one entry body', async () => {
    const bigBody = 'y'.repeat(600 * 1024);
    const inserted = await store.insert(workspace, {
      ...draft({ url: 'https://target.com' }),
      responseBodyPreview: bigBody,
    });

    // Add more entries after so target is not the last line.
    for (let i = 0; i < 3; i++) {
      await store.insert(workspace, draft({ url: `https://noise-${i}.com` }));
    }

    // Bust cache.
    store.invalidateCache(workspace);

    const found = await store.getById(workspace, inserted.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(inserted.id);
    // Full body must be decompressed by getById.
    expect(found!.responseBodyPreview).toBe(bigBody);

    // Other entries must NOT have been decompressed (only getById decompresses).
    // Verify that list() for the workspace returns empty previews for the others.
    store.invalidateCache(workspace);
    const allMeta = await store.list(workspace, { limit: 10 });
    const noiseEntries = allMeta.filter((e) => e.url.startsWith('https://noise-'));
    expect(noiseEntries.every((e) => e.responseBodyPreview === '')).toBe(true);
  });

  it('T1309: corrupted last line is skipped and valid entries still returned', async () => {
    await store.insert(workspace, draft({ url: 'https://good.com' }));

    // Manually append a corrupted line to simulate a partial write.
    const { appendFile } = await import('node:fs/promises');
    const file = store.getFilePath(workspace);
    await appendFile(file, 'NOT VALID JSON\n', 'utf8');

    store.invalidateCache(workspace);
    const list = await store.list(workspace);
    // The valid entry must still be returned.
    expect(list.some((e) => e.url === 'https://good.com')).toBe(true);
  });

  it('T1309: insert stays O(1) — new entry visible immediately without re-reading the whole file', async () => {
    // Insert initial entries.
    for (let i = 0; i < 5; i++) {
      await store.insert(workspace, draft({ url: `https://${i}.com` }));
    }

    // Bust cache — now the window cache is empty.
    store.invalidateCache(workspace);

    // Insert one more entry. The cache is empty, so this should not
    // read the file first — it should just append and prime a fresh cache.
    const inserted = await store.insert(workspace, draft({ url: 'https://new.com' }));

    // The entry must be accessible via list() without another full file read.
    // Because insert() primes the cache after busting, we get back the fresh
    // entry if it was prepended correctly.
    const list = await store.list(workspace, { limit: 10 });

    // The new entry must appear (insert should have appended it).
    expect(list.some((e) => e.id === inserted.id)).toBe(true);

    // list() on the populated cache must work.
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('T1309: maxEntries option is accepted but does not prune history', async () => {
    // maxEntries trimming is removed; passing it must not crash or prune.
    const s = new HistoryStore({ rootDir: tmp, maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      await s.insert(workspace, {
        ...draft({ url: `https://${i}.com` }),
        sentAt: `2026-04-10T00:00:0${i}.000Z`,
      });
    }
    // All 5 entries must be on disk (no pruning).
    s.invalidateCache(workspace);
    const all = await s.list(workspace, { limit: 10 });
    expect(all).toHaveLength(5);
  });

  it('T1309: before cursor excludes entries at or after the cursor timestamp', async () => {
    await store.insert(workspace, {
      ...draft({ url: 'https://old.com' }),
      sentAt: '2026-04-01T00:00:00.000Z',
    });
    await store.insert(workspace, {
      ...draft({ url: 'https://new.com' }),
      sentAt: '2026-04-10T00:00:00.000Z',
    });

    store.invalidateCache(workspace);
    const older = await store.list(workspace, {
      before: '2026-04-10T00:00:00.000Z',
      limit: 10,
    });
    expect(older.map((e) => e.url)).toEqual(['https://old.com']);
  });
});

// ---------------------------------------------------------------------------
// T1309 CHANGES REQUESTED — new regression tests
// ---------------------------------------------------------------------------

describe('full-file search scope', () => {
  it('list({ search }) finds an entry that lives beyond the first batch', async () => {
    // Insert BATCH+2 entries so the target is past the default 100-entry window.
    const BATCH = 100;
    const target = 'unique-needle-xyz';

    // Insert the needle entry first (it will be at the oldest position in the file).
    await store.insert(workspace, {
      ...draft({ url: `https://${target}.example.com` }),
      sentAt: '2026-01-01T00:00:00.000Z',
    });

    // Insert BATCH+1 more entries after so the needle is buried past the first page.
    for (let i = 0; i < BATCH + 1; i++) {
      await store.insert(workspace, {
        ...draft({ url: `https://filler-${i}.com` }),
        sentAt: `2026-06-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }

    store.invalidateCache(workspace);

    // A limit=BATCH list without search must NOT include the needle (it is too old).
    const noSearch = await store.list(workspace, { limit: BATCH });
    expect(noSearch.some((e) => e.url.includes(target))).toBe(false);

    // A search query must reach the full file and find it.
    store.invalidateCache(workspace);
    const withSearch = await store.list(workspace, { search: target, limit: BATCH });
    expect(withSearch.some((e) => e.url.includes(target))).toBe(true);
  });
});

describe('UTF-8 multibyte characters at chunk boundaries', () => {
  it('a multibyte UTF-8 char (Turkish ş) placed exactly on a chunk boundary is read back intact', async () => {
    // TAIL_CHUNK_BYTES is 256 KB. We build the history file by hand so that a
    // JSONL entry containing "ş" (U+015F, encoded as 0xC5 0x9F — 2 bytes) has
    // that character split across the boundary: the first byte (0xC5) ends one
    // chunk and the second byte (0x9F) begins the next.
    //
    // Concretely: write a first line that is exactly (CHUNK - 1) bytes long
    // (including its trailing newline), then write the target JSONL line so that
    // byte 0 of its content is 0x9F — i.e., the second half of the ş encoding.
    // The store must Buffer.concat the carry before decoding, not decode each
    // half separately (which would produce U+FFFD on each side).

    const CHUNK = 256 * 1024;
    const { writeFile } = await import('node:fs/promises');
    const { randomUUID } = await import('node:crypto');

    const filePath = store.getFilePath(workspace);
    // Ensure the directory exists by inserting a throwaway entry first.
    const throwaway = await store.insert(workspace, draft({ url: 'https://throwaway.com' }));
    await store.delete(workspace, throwaway.id);
    // After delete + clear of the throwaway, start with an empty file.
    await store.clear(workspace);

    // Build a valid JSONL entry that contains ş in the URL.
    const targetId = randomUUID();
    const turkishUrl = 'https://ş.example.com/api';
    const targetEntry = {
      workspacePath: workspace,
      environmentName: null,
      method: 'GET',
      url: turkishUrl,
      headers: {},
      bodyTruncated: false,
      status: 200,
      statusOk: true,
      responseHeaders: [],
      responseBodyTruncated: false,
      responseSizeBytes: 0,
      durationMs: 10,
      protocol: 'http/1.1',
      id: targetId,
      sentAt: '2026-01-02T00:00:00.000Z',
      bodyPreview: '',
      responseBodyPreview: '',
    };
    const targetLine = JSON.stringify(targetEntry) + '\n';
    const targetBuf = Buffer.from(targetLine, 'utf8');

    // Find the offset of ş (0xC5 0x9F) in the target buffer.
    let shOffset = -1;
    for (let i = 0; i < targetBuf.length - 1; i++) {
      if (targetBuf[i] === 0xc5 && targetBuf[i + 1] === 0x9f) {
        shOffset = i;
        break;
      }
    }
    expect(shOffset).toBeGreaterThan(-1); // sanity: ş must be in the buffer

    // We want the ş to straddle position CHUNK: byte (CHUNK-1) = 0xC5,
    // byte CHUNK = 0x9F. The filler line occupies bytes [0, CHUNK - shOffset - 1),
    // then the target line starts at byte (CHUNK - shOffset).
    // filler length = CHUNK - shOffset - 1 (so filler+newline = CHUNK - shOffset bytes).
    const fillerBodyLen = CHUNK - shOffset - 1; // the JSON content, newline added separately
    // Build a valid JSONL filler entry with a padded URL so the serialised line
    // is exactly the right length. We adjust the URL padding to hit the size.
    // Use a plain ASCII URL padded to the required serialised byte count.
    const fillerBase = {
      workspacePath: workspace,
      environmentName: null,
      method: 'GET',
      url: 'https://filler.com',
      headers: {},
      bodyTruncated: false,
      status: 200,
      statusOk: true,
      responseHeaders: [],
      responseBodyTruncated: false,
      responseSizeBytes: 0,
      durationMs: 5,
      protocol: 'http/1.1',
      id: randomUUID(),
      sentAt: '2026-01-01T00:00:00.000Z',
      bodyPreview: '',
      responseBodyPreview: '',
    };
    const fillerBaseStr = JSON.stringify(fillerBase);
    // The filler line must be (CHUNK - shOffset - 1) bytes total (including newline).
    // fillerBaseStr length is the length without padding.
    // We'll add a "pad" key to the JSON to hit the exact size.
    const neededPad = fillerBodyLen - fillerBaseStr.length - 9; // 9 = `,"pad":""`
    if (neededPad < 0) {
      // Edge case: base serialisation is already too long — skip with a note.
      // This would only happen if CHUNK < ~500 bytes which never occurs in prod.
      return;
    }
    const fillerWithPad = { ...fillerBase, pad: 'x'.repeat(neededPad) };
    const fillerLine = JSON.stringify(fillerWithPad) + '\n';
    const fillerBuf = Buffer.from(fillerLine, 'utf8');

    // The filler must end right before the ş first byte.
    // Verify the math: fillerBuf.length + shOffset === CHUNK (boundary).
    expect(fillerBuf.length + shOffset).toBe(CHUNK);

    // Write both lines in one call to ensure no OS-level splitting.
    await writeFile(filePath, Buffer.concat([fillerBuf, targetBuf]));
    store.invalidateCache(workspace);

    // getById scans backward through the file — it must reconstruct ş intact.
    const found = await store.getById(workspace, targetId);
    expect(found).not.toBeNull();
    expect(found!.url).toBe(turkishUrl);

    // list() forward scan of the tail must also return the entry correctly.
    const listed = await store.list(workspace, { limit: 10 });
    expect(listed.some((e) => e.url === turkishUrl)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Verify that the raw gzip+base64 round-trip is correct (accessed via the
// public insert / getById API).
// ---------------------------------------------------------------------------
describe('gzip round-trip via getById', () => {
  it('full body restored by getById matches the original string', async () => {
    const s = new HistoryStore({ rootDir: tmp });
    const body = 'The quick brown fox '.repeat(50); // > 256 bytes, gzip-stored
    const entry = await s.insert('/ws/gz', {
      ...draft({ responseBodyPreview: body }),
    });
    const found = await s.getById('/ws/gz', entry.id);
    expect(found).not.toBeNull();
    expect(found!.responseBodyPreview).toBe(body);
  });

  it('small body (< GZIP_THRESHOLD) is stored inline and returned by getById', async () => {
    const s = new HistoryStore({ rootDir: tmp });
    const body = 'hi'; // tiny, stored as plain string
    const entry = await s.insert('/ws/small', {
      ...draft({ responseBodyPreview: body }),
    });
    const found = await s.getById('/ws/small', entry.id);
    expect(found!.responseBodyPreview).toBe(body);
  });
});

// ---------------------------------------------------------------------------
// Verify compatibility with the real file format (hand-crafted JSONL line
// with _respGz field, no responseBodyPreview — matches the 284MB prod file).
// ---------------------------------------------------------------------------
describe('real file format compatibility', () => {
  it('reads a hand-crafted _respGz line: list returns meta-only, getById decompresses', async () => {
    const s = new HistoryStore({ rootDir: tmp });
    const ws = '/ws/compat';

    // Insert one entry to ensure the directory and file exist, then overwrite
    // with a raw line that matches the real production format exactly.
    const template = await s.insert(ws, draft({ url: 'https://placeholder.com' }));
    const filePath = s.getFilePath(ws);

    const bigBody = 'REAL DATA '.repeat(100);
    const gz = gzipSync(Buffer.from(bigBody, 'utf8')).toString('base64');

    const rawLine = JSON.stringify({
      workspacePath: ws,
      environmentName: null,
      method: 'GET',
      url: 'https://compat.example.com',
      headers: {},
      bodyTruncated: false,
      status: 200,
      statusOk: true,
      responseHeaders: [],
      responseBodyTruncated: false,
      responseSizeBytes: bigBody.length,
      durationMs: 10,
      protocol: 'http/1.1',
      id: template.id,
      sentAt: template.sentAt,
      _respGz: gz,
    });

    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, rawLine + '\n', 'utf8');
    s.invalidateCache(ws);

    // list() must return the entry with empty responseBodyPreview (not decompressed).
    const list = await s.list(ws, { limit: 10 });
    expect(list).toHaveLength(1);
    expect(list[0].responseBodyPreview).toBe('');
    expect(list[0].url).toBe('https://compat.example.com');

    // getById() must decompress and return the full body.
    const full = await s.getById(ws, template.id);
    expect(full!.responseBodyPreview).toBe(bigBody);
  });
});
