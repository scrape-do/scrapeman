import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    await store.insert(workspace, { ...draft({ url: 'https://a.com' }), sentAt: '2026-04-10T10:00:00.000Z' });
    await store.insert(workspace, { ...draft({ url: 'https://b.com' }), sentAt: '2026-04-10T11:00:00.000Z' });
    await store.insert(workspace, { ...draft({ url: 'https://c.com' }), sentAt: '2026-04-10T09:00:00.000Z' });
    const list = await store.list(workspace);
    expect(list.map((e) => e.url)).toEqual([
      'https://b.com',
      'https://a.com',
      'https://c.com',
    ]);
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
    const store = new HistoryStore({ rootDir: tmp, maxBodyPreviewBytes: 32 });
    const body = 'x'.repeat(1000);
    const entry = await store.insert(workspace, draft({ responseBodyPreview: body }));
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

  it('search filters by URL, method, or response body', async () => {
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

  it('prunes when exceeding maxEntries', async () => {
    const store = new HistoryStore({ rootDir: tmp, maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      await store.insert(workspace, {
        ...draft({ url: `https://${i}.com` }),
        sentAt: `2026-04-10T00:00:0${i}.000Z`,
      });
    }
    const list = await store.list(workspace);
    expect(list.map((e) => e.url)).toEqual([
      'https://4.com',
      'https://3.com',
      'https://2.com',
    ]);
  });

  it('isolates history by workspace path', async () => {
    await store.insert('/ws/a', draft({ url: 'https://a.com' }));
    await store.insert('/ws/b', draft({ url: 'https://b.com' }));
    expect((await store.list('/ws/a')).map((e) => e.url)).toEqual(['https://a.com']);
    expect((await store.list('/ws/b')).map((e) => e.url)).toEqual(['https://b.com']);
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
});
