import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs BEFORE any ESM import in this file is evaluated, which is
// the only way to satisfy ./bridge.ts (it reads bare `window.scrapeman` at
// module load) without bringing jsdom into the test runtime.
vi.hoisted(() => {
  const g = globalThis as unknown as {
    window?: Record<string, unknown>;
    document?: Record<string, unknown>;
    localStorage?: Storage;
  };
  if (!g.window) g.window = {};
  (g.window as { scrapeman?: unknown }).scrapeman = {};
  if (!g.document) g.document = { body: { innerHTML: '' } };
  if (!g.localStorage) {
    const store = new Map<string, string>();
    const ls: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k) => (store.has(k) ? (store.get(k) ?? null) : null),
      key: (i) => Array.from(store.keys())[i] ?? null,
      removeItem: (k) => {
        store.delete(k);
      },
      setItem: (k, v) => {
        store.set(k, String(v));
      },
    };
    g.localStorage = ls;
    (g.window as { localStorage?: Storage }).localStorage = ls;
  }
});

import {
  captureWorkspaceSnapshot,
  normalizeUrlSchema,
  paramsFromUrl,
  persistWorkspaceSnapshot,
  readPersistedLastActiveWorkspace,
  readPersistedOpenWorkspaces,
  readWorkspaceSnapshot,
  useAppStore,
  type Tab,
  type WorkspaceSnapshot,
} from './store.js';

beforeEach(() => {
  localStorage.clear();
  // Reset relevant slices on the singleton store between tests.
  useAppStore.setState({
    workspace: null,
    root: null,
    openWorkspaces: [],
    workspaceSnapshots: {},
    tabs: [],
    activeTabId: null,
    activeEnvironment: null,
    sidebarView: 'files',
  });
});

afterEach(() => {
  localStorage.clear();
});

describe('captureWorkspaceSnapshot', () => {
  it('captures the four UI fields verbatim', () => {
    const snap = captureWorkspaceSnapshot({
      tabs: [],
      activeTabId: 'draft:abc',
      activeEnvironment: 'staging',
      sidebarView: 'git',
    });
    expect(snap).toEqual({
      tabs: [],
      activeTabId: 'draft:abc',
      activeEnvironment: 'staging',
      sidebarView: 'git',
    });
  });

  it('round-trips activeTabId, env, and sidebar view', () => {
    const snap = captureWorkspaceSnapshot({
      tabs: [],
      activeTabId: 'file:foo.sman',
      activeEnvironment: 'prod',
      sidebarView: 'files',
    });
    expect(snap.activeTabId).toBe('file:foo.sman');
    expect(snap.activeEnvironment).toBe('prod');
    expect(snap.sidebarView).toBe('files');
  });
});

describe('readPersistedOpenWorkspaces', () => {
  it('returns [] when nothing is stored', () => {
    expect(readPersistedOpenWorkspaces()).toEqual([]);
  });

  it('returns [] when stored value is malformed JSON', () => {
    localStorage.setItem('workspaces:open', '{not json');
    expect(readPersistedOpenWorkspaces()).toEqual([]);
  });

  it('returns [] when stored value is not an array', () => {
    localStorage.setItem('workspaces:open', '{"path":"x","name":"y"}');
    expect(readPersistedOpenWorkspaces()).toEqual([]);
  });

  it('keeps only entries with string path + name and strips extras', () => {
    localStorage.setItem(
      'workspaces:open',
      JSON.stringify([
        { path: '/a', name: 'A', extra: 'ignored' },
        { path: 12, name: 'bad' },
        { name: 'no path' },
        { path: '/b', name: 'B' },
      ]),
    );
    expect(readPersistedOpenWorkspaces()).toEqual([
      { path: '/a', name: 'A' },
      { path: '/b', name: 'B' },
    ]);
  });
});

describe('readPersistedLastActiveWorkspace', () => {
  it('returns null when missing', () => {
    expect(readPersistedLastActiveWorkspace()).toBeNull();
  });

  it('returns the stored path', () => {
    localStorage.setItem('workspaces:lastActive', '/Users/me/work');
    expect(readPersistedLastActiveWorkspace()).toBe('/Users/me/work');
  });
});

describe('persistWorkspaceSnapshot / readWorkspaceSnapshot', () => {
  function makeTab(overrides: Partial<Tab> = {}): Tab {
    const base = useAppStore.getState();
    void base;
    return {
      id: 'draft:abc',
      kind: 'draft',
      relPath: null,
      name: 'My Request',
      method: 'GET',
      builder: {
        method: 'GET',
        url: 'https://example.com',
        params: [],
        headers: [],
        bodyType: 'none',
        body: '',
        bodyFields: {},
        bodyParts: [],
        bodyFile: '',
        graphql: { query: '', variables: '' },
        auth: { type: 'none' },
        settings: {
          proxy: { enabled: false, url: '' },
          timeout: { connect: null, read: null, total: null },
          redirect: { follow: true, maxCount: 10 },
          tls: { ignoreInvalidCerts: false },
          httpVersion: 'auto',
          scrapeDo: { enabled: false, token: '' },
          validateBody: '',
          uaPreset: 'scrapeman',
          rateLimit: { enabled: false, fixedDelayMs: 0 },
          useCookieJar: true,
        },
        disabledAutoHeaders: [],
        preRequestScript: '',
        postResponseScript: '',
      },
      dirty: true,
      execution: {
        status: 'idle',
        response: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      },
      loadTest: {
        config: {
          total: 100,
          concurrency: 10,
          delay: 0,
          expectStatus: '',
          expectBody: '',
          saveFailedBodies: false,
          failedBodyLimit: 50,
          watchedHeaders: [],
        },
        runId: null,
        progress: null,
        events: [],
        failedBodies: [],
        starting: false,
        startError: null,
      },
      activePane: 'params',
      responseSearch: '',
      responseMode: null,
      ...overrides,
    } as Tab;
  }

  it('round-trips a draft tab through localStorage', () => {
    const snap: WorkspaceSnapshot = {
      tabs: [makeTab({ name: 'Draft 1' })],
      activeTabId: 'draft:abc',
      activeEnvironment: 'staging',
      sidebarView: 'files',
    };
    persistWorkspaceSnapshot('/work', snap);
    const round = readWorkspaceSnapshot('/work');
    expect(round).not.toBeNull();
    expect(round!.tabs).toHaveLength(1);
    expect(round!.tabs[0]!.name).toBe('Draft 1');
    expect(round!.tabs[0]!.builder.url).toBe('https://example.com');
    expect(round!.tabs[0]!.dirty).toBe(true);
    expect(round!.activeTabId).toBe('draft:abc');
    expect(round!.activeEnvironment).toBe('staging');
  });

  it('strips transient fields from the persisted form', () => {
    const tab = makeTab({
      execution: {
        status: 'success',
        response: { body: 'huge' } as unknown as Tab['execution']['response'],
        error: null,
        startedAt: 1000,
        finishedAt: 2000,
      },
      websocket: {
        connectionId: 'ws-1',
        url: 'wss://x',
        state: 'OPEN',
        timeline: [],
        sendDraft: '',
        connecting: false,
        error: null,
      } as Tab['websocket'],
      parallelBursts: [
        { id: 'b1', startedAt: 0, status: 'success', httpStatus: 200, durationMs: 100 },
      ],
    } as Partial<Tab>);
    persistWorkspaceSnapshot('/work', {
      tabs: [tab],
      activeTabId: tab.id,
      activeEnvironment: null,
      sidebarView: 'files',
    });
    const round = readWorkspaceSnapshot('/work');
    const restored = round!.tabs[0]!;
    expect(restored.execution.status).toBe('idle');
    expect(restored.execution.response).toBeNull();
    expect(restored.websocket).toBeUndefined();
    expect(restored.parallelBursts).toBeUndefined();
  });

  it('returns null for missing or malformed snapshots', () => {
    expect(readWorkspaceSnapshot('/missing')).toBeNull();
    localStorage.setItem('workspace:tabs:/bad', '{not json');
    expect(readWorkspaceSnapshot('/bad')).toBeNull();
    localStorage.setItem('workspace:tabs:/notarray', '{"tabs":42}');
    expect(readWorkspaceSnapshot('/notarray')).toBeNull();
  });
});

describe('closeWorkspace', () => {
  it('drops a non-active workspace from openWorkspaces and snapshot', async () => {
    useAppStore.setState({
      workspace: { path: '/a', name: 'A' },
      openWorkspaces: [
        { path: '/a', name: 'A' },
        { path: '/b', name: 'B' },
      ],
      workspaceSnapshots: {
        '/b': {
          tabs: [],
          activeTabId: null,
          activeEnvironment: null,
          sidebarView: 'files',
        },
      },
    });
    await useAppStore.getState().closeWorkspace('/b');
    const s = useAppStore.getState();
    expect(s.openWorkspaces.map((w) => w.path)).toEqual(['/a']);
    expect(s.workspaceSnapshots['/b']).toBeUndefined();
    expect(s.workspace?.path).toBe('/a');
  });

  it('clears active workspace when closing the only workspace', async () => {
    useAppStore.setState({
      workspace: { path: '/solo', name: 'Solo' },
      openWorkspaces: [{ path: '/solo', name: 'Solo' }],
    });
    await useAppStore.getState().closeWorkspace('/solo');
    const s = useAppStore.getState();
    expect(s.openWorkspaces).toEqual([]);
    expect(s.workspace).toBeNull();
  });

  it('persists the updated openWorkspaces list to localStorage', async () => {
    useAppStore.setState({
      workspace: { path: '/a', name: 'A' },
      openWorkspaces: [
        { path: '/a', name: 'A' },
        { path: '/b', name: 'B' },
      ],
    });
    await useAppStore.getState().closeWorkspace('/b');
    expect(JSON.parse(localStorage.getItem('workspaces:open') ?? '[]')).toEqual([
      { path: '/a', name: 'A' },
    ]);
  });
});

describe('normalizeUrlSchema', () => {
  it('passes through URLs that already have a scheme', () => {
    expect(normalizeUrlSchema('https://api.example.com')).toBe('https://api.example.com');
    expect(normalizeUrlSchema('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('prepends http:// when no scheme is present', () => {
    expect(normalizeUrlSchema('localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(normalizeUrlSchema('api.example.com/users')).toBe('http://api.example.com/users');
  });

  it('handles port-only and empty-host shapes', () => {
    expect(normalizeUrlSchema(':/path')).toBe('http://0.0.0.0/path');
  });

  it('does not prepend http:// when the URL starts with a {{var}}', () => {
    // Issue #86 — when {{base_url}} resolves to a full URL like
    // 'https://api.example.com', prepending http:// would produce
    // 'http://https://api.example.com' which undici rejects.
    expect(normalizeUrlSchema('{{base_url}}/users')).toBe('{{base_url}}/users');
    expect(normalizeUrlSchema('{{host}}')).toBe('{{host}}');
  });

  it('still prepends http:// when {{var}} appears mid-URL', () => {
    // The host segment is concrete; the variable is a path piece.
    expect(normalizeUrlSchema('api.example.com/{{userId}}')).toBe(
      'http://api.example.com/{{userId}}',
    );
  });
});

describe('paramsFromUrl — nested-URL heuristic (#88)', () => {
  it('returns the whole nested URL as a single param value', () => {
    const rows = paramsFromUrl(
      'https://sample.com?url=https://httpbin.co/anything?hello=world&merhaba=dunya&abc=1',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe('url');
    expect(rows[0]!.value).toBe(
      'https://httpbin.co/anything?hello=world&merhaba=dunya&abc=1',
    );
  });

  it('keeps plain side-by-side params separate when none has an inner ?', () => {
    const rows = paramsFromUrl('https://api.example.com?foo=bar&baz=qux&n=1');
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['foo', 'bar'],
      ['baz', 'qux'],
      ['n', '1'],
    ]);
  });

  it('still works for a URL-typed value that has no inner query string', () => {
    // `api_url=https://api.example.com` — no `?` inside the value, so
    // the next param stays separate. This is the common scrape.do
    // `?url=...&token=...` shape when the user encoded the target URL.
    const rows = paramsFromUrl(
      'https://sample.com?api_url=https://api.example.com&token=abc',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.key).toBe('api_url');
    expect(rows[0]!.value).toBe('https://api.example.com');
    expect(rows[1]!.key).toBe('token');
    expect(rows[1]!.value).toBe('abc');
  });

  it('returns [] for an empty query string', () => {
    expect(paramsFromUrl('https://example.com')).toEqual([]);
    expect(paramsFromUrl('https://example.com?')).toEqual([]);
  });

  it('handles keys without values', () => {
    const rows = paramsFromUrl('https://example.com?debug&verbose=1');
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['debug', ''],
      ['verbose', '1'],
    ]);
  });
});

describe('setUrl — Params sync', () => {
  beforeEach(() => {
    useAppStore.getState().newTab();
  });

  it('removes enabled params when the URL is cleared', () => {
    const tabId = useAppStore.getState().activeTabId!;
    useAppStore.getState().setUrl('https://api.example.com?foo=1&bar=2');
    let tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
    const enabledKeys = tab.builder.params.filter((p) => p.enabled).map((p) => p.key);
    expect(enabledKeys).toEqual(['foo', 'bar']);

    useAppStore.getState().setUrl('');
    tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.builder.params.filter((p) => p.enabled && p.key.length > 0)).toEqual([]);
  });

  it('removes enabled params when the URL loses its query string', () => {
    const tabId = useAppStore.getState().activeTabId!;
    useAppStore.getState().setUrl('https://api.example.com?foo=1');
    useAppStore.getState().setUrl('https://api.example.com');
    const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
    expect(tab.builder.params.filter((p) => p.enabled && p.key.length > 0)).toEqual([]);
  });

  it('preserves disabled rows when the URL is cleared', () => {
    const tabId = useAppStore.getState().activeTabId!;
    useAppStore.getState().setUrl('https://api.example.com?foo=1&bar=2');
    // Manually flip foo's enabled bit off via setState.
    useAppStore.setState((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          builder: {
            ...t.builder,
            params: t.builder.params.map((p) =>
              p.key === 'foo' ? { ...p, enabled: false } : p,
            ),
          },
        };
      }),
    }));

    useAppStore.getState().setUrl('');
    const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
    const remaining = tab.builder.params.filter((p) => p.key.length > 0);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.key).toBe('foo');
    expect(remaining[0]!.enabled).toBe(false);
  });
});
