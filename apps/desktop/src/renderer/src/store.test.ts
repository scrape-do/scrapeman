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
  builderFromRequest,
  captureWorkspaceSnapshot,
  normalizeUrlSchema,
  paramsFromUrl,
  persistWorkspaceSnapshot,
  readPersistedLastActiveWorkspace,
  readPersistedOpenWorkspaces,
  readWorkspaceSnapshot,
  urlFromParams,
  useAppStore,
  type ParamRow,
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

describe('paramsFromUrl — plain query split (URL-bar parse)', () => {
  // The Params table is the source of truth; paramsFromUrl only runs when the
  // user edits the URL bar directly. A query string is delimited by '&': we
  // split on '&' and treat a '?' inside a value as a literal character, which
  // is exactly how every server parses the query it receives. The old fold
  // heuristic (#88), which glued trailing params into a nested `url=` value,
  // is gone — it corrupted the table on any host that wasn't scrape.do.

  it('treats an inner "?" as a literal, not a delimiter (the reported bug)', () => {
    // `test=1` after a nested `url=` stays its own row instead of being
    // absorbed into the url value.
    const rows = paramsFromUrl(
      'https://httpbin.co/anything?token=t&url=https://example.com/path?parameter=new&test=1',
    );
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['token', 't'],
      ['url', 'https://example.com/path?parameter=new'],
      ['test', '1'],
    ]);
  });

  it('keeps plain side-by-side params separate', () => {
    const rows = paramsFromUrl('https://api.example.com?foo=bar&baz=qux&n=1');
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['foo', 'bar'],
      ['baz', 'qux'],
      ['n', '1'],
    ]);
  });

  it('decodes an encoded inner "&" (%26) back into one readable value', () => {
    // urlFromParams encodes a nested value's inner '&' as %26 so it does not
    // split; paramsFromUrl reverses that for display in the cell.
    const rows = paramsFromUrl(
      'https://httpbin.co/anything?url=https://example.com/path?a=1%26b=2&test=1',
    );
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['url', 'https://example.com/path?a=1&b=2'],
      ['test', '1'],
    ]);
  });

  it('a raw (unencoded) inner "&" pasted into the URL bar splits into rows', () => {
    // Accepted limitation: a raw query string is genuinely ambiguous. To keep
    // a nested URL's query as one value, edit it in the Params table (which
    // encodes the inner '&') rather than pasting the whole thing raw.
    const rows = paramsFromUrl(
      'https://proxy.example.com/?target=https://x.com?a=1&b=2&c=3',
    );
    expect(rows.map((r) => [r.key, r.value])).toEqual([
      ['target', 'https://x.com?a=1'],
      ['b', '2'],
      ['c', '3'],
    ]);
  });

  it('normalizes a pre-encoded %26 to & for display but keeps the wire bytes', () => {
    // A value the user pre-encoded with %26 shows as & in the cell after a
    // URL-bar parse. Re-encoding produces the byte-identical URL, so the server
    // still receives %26 — a display normalization, not a wire change. (We
    // cannot encode a literal '%' to keep this fully verbatim without
    // reintroducing the %20 -> %2520 double-encode bug, so this is the
    // deliberate trade.)
    const url = 'https://httpbin.co/anything?key=a%26b';
    const rows = paramsFromUrl(url);
    expect(rows.map((r) => [r.key, r.value])).toEqual([['key', 'a&b']]);
    expect(urlFromParams('https://httpbin.co/anything', rows)).toBe(url);
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

describe('urlFromParams ↔ paramsFromUrl round-trip', () => {
  // The core guarantee: a param list survives list → URL → list unchanged,
  // even when a value carries its own query with multiple params. This is what
  // keeps the Params table stable when the URL bar re-parses on an edit.
  const row = (key: string, value: string): ParamRow => ({
    id: `id-${key}-${value}`,
    key,
    value,
    enabled: true,
  });

  const cases: Array<{ name: string; rows: ParamRow[] }> = [
    {
      name: 'nested url with a single inner param + trailing param',
      rows: [
        row('token', 'token'),
        row('super', 'true'),
        row('url', 'https://example.com/path?parameter=new'),
        row('test', '1'),
      ],
    },
    {
      name: 'nested url with TWO inner params + trailing param (the hard case)',
      rows: [
        row('token', 'token'),
        row('url', 'https://example.com/path?parameter=new&parameter2=new2'),
        row('test', '1'),
      ],
    },
    {
      name: 'duplicate keys',
      rows: [
        row('url', 'https://a.example.com?x=1'),
        row('url', 'https://b.example.com?y=2'),
        row('n', '3'),
      ],
    },
  ];

  for (const c of cases) {
    it(`round-trips: ${c.name}`, () => {
      const url = urlFromParams('https://httpbin.co/anything', c.rows);
      const back = paramsFromUrl(url);
      expect(back.map((r) => [r.key, r.value])).toEqual(
        c.rows.map((r) => [r.key, r.value]),
      );
    });
  }
});

describe('param-list stability on state update (the reported bug)', () => {
  // The reported bug, driven WITHOUT any UI: a param whose value is a URL
  // carrying its own query string. On a state update, the params AFTER it used
  // to get swallowed into its value and their own rows vanished. These assert
  // the two paths that re-touch the params: a URL-bar edit and a reload.
  beforeEach(() => {
    useAppStore.getState().newTab();
  });

  it('a URL-bar edit keeps the list intact (inner query + trailing param)', () => {
    const tabId = useAppStore.getState().activeTabId!;
    const rows: ParamRow[] = [
      { id: 'r1', key: 'token', value: 'token', enabled: true },
      { id: 'r2', key: 'super', value: 'true', enabled: true },
      {
        id: 'r3',
        key: 'url',
        value: 'https://example.com/path?parameter=new&parameter2=new2',
        enabled: true,
      },
      { id: 'r4', key: 'test', value: '1', enabled: true },
    ];
    // The URL the app derives from that list (this is what the URL bar shows).
    const builtUrl = urlFromParams('https://httpbin.co/anything', rows);

    useAppStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, builder: { ...t.builder, url: builtUrl, params: rows } }
          : t,
      ),
    }));

    // The URL bar re-emits its current value (what happens on any edit).
    useAppStore.getState().setUrl(builtUrl);

    const tab = useAppStore.getState().tabs.find((t) => t.id === tabId)!;
    const got = tab.builder.params
      .filter((p) => p.key.length > 0)
      .map((p) => [p.key, p.value]);
    expect(got).toEqual([
      ['token', 'token'],
      ['super', 'true'],
      ['url', 'https://example.com/path?parameter=new&parameter2=new2'],
      ['test', '1'],
    ]);
  });

  it('a reload loads the rows from the params list, not the URL', () => {
    // builderFromRequest is the reload/hydration path. It must take the rows
    // from the structured list verbatim — including a nested-url value, a
    // duplicate key, and a disabled row — and never re-parse request.url.
    const builder = builderFromRequest({
      scrapeman: '1.0',
      meta: { name: 'r' },
      method: 'GET',
      // A stale/ambiguous URL — must be ignored in favour of the list.
      url: 'https://httpbin.co/anything?url=https://example.com/path?a=1&b=2&test=1',
      params: [
        { key: 'url', value: 'https://example.com/path?a=1&b=2', enabled: true },
        { key: 'url', value: 'https://second.example.com?c=3', enabled: true },
        { key: 'test', value: '1', enabled: true },
        { key: 'debug', value: 'yes', enabled: false },
      ],
    });
    expect(builder.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['url', 'https://example.com/path?a=1&b=2', true],
      ['url', 'https://second.example.com?c=3', true],
      ['test', '1', true],
      ['debug', 'yes', false],
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
