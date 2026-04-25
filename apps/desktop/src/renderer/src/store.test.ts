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
  readPersistedLastActiveWorkspace,
  readPersistedOpenWorkspaces,
  useAppStore,
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
