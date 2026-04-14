import { create } from 'zustand';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
import type {
  AuthConfig,
  CollectionFolderNode,
  Environment,
  EnvironmentVariable,
  ExecutedResponse,
  GitStatus,
  HistoryEntry,
  HttpMethod,
  HttpVersion,
  ProxyConfig,
  RecentWorkspace,
  RequestOptions,
  ScrapeDoConfig,
  ScrapemanRequest,
  SerializedExecutorError,
  WorkspaceInfo,
} from '@scrapeman/shared-types';
import { bridge } from './bridge.js';

// Per-tab in-flight request id, used by cancelSend() to abort the
// running request via the main-process IPC channel.
const inflightRequestIds = new Map<string, string>();

// LIFO stack of recently closed tabs for ⌘⇧T reopen. Bounded so a
// user who mass-closes tabs doesn't stash unbounded memory.
const CLOSED_TAB_STACK_LIMIT = 10;
const closedTabStack: Array<{ tab: Tab; index: number }> = [];

export interface HeaderRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface ParamRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface SettingsState {
  proxy: ProxyConfig;
  timeout: {
    connect: number | null;
    read: number | null;
    total: number | null;
  };
  redirect: {
    follow: boolean;
    maxCount: number;
  };
  tls: {
    ignoreInvalidCerts: boolean;
  };
  httpVersion: HttpVersion;
  scrapeDo: ScrapeDoConfig;
}

export interface BuilderState {
  method: HttpMethod;
  url: string;
  params: ParamRow[];
  headers: HeaderRow[];
  body: string;
  bodyType: 'none' | 'json' | 'text';
  auth: AuthConfig;
  settings: SettingsState;
  disabledAutoHeaders: string[];
}

export interface ExecutionState {
  status: 'idle' | 'sending' | 'success' | 'error';
  response: ExecutedResponse | null;
  error: SerializedExecutorError | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export type TabKind = 'file' | 'draft';

export type ResponseBodyMode = 'raw' | 'pretty' | 'tree' | 'preview';

export interface Tab {
  id: string;
  kind: TabKind;
  relPath: string | null;
  name: string;
  method: HttpMethod;
  builder: BuilderState;
  dirty: boolean;
  execution: ExecutionState;
  responseSearch: string;
  responseMode: ResponseBodyMode | null;
  sourceHistoryId?: string;
}

interface AppState {
  workspace: WorkspaceInfo | null;
  root: CollectionFolderNode | null;
  recents: RecentWorkspace[];

  environments: Environment[];
  activeEnvironment: string | null;

  history: HistoryEntry[];

  tabs: Tab[];
  activeTabId: string | null;

  // Workspace
  loadRecents: () => Promise<void>;
  pickAndOpenWorkspace: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;

  // Tabs
  saveDialogOpen: boolean;
  openSaveDialog: () => void;
  closeSaveDialog: () => void;

  // Bumped by ⌘L; RequestBuilder watches and focuses+selects the URL bar.
  focusUrlTick: number;
  focusUrl: () => void;

  // Ticks bumped by the command palette to open dialogs owned by RequestBuilder.
  importCurlTick: number;
  openImportCurl: () => void;
  loadTestTick: number;
  openLoadTest: () => void;

  newTab: () => void;
  closeTab: (id: string) => void;
  duplicateTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  activateTabByIndex: (index: number) => void;
  reopenClosedTab: () => void;
  reorderTab: (fromId: string, toId: string) => void;
  openRequest: (relPath: string) => Promise<void>;
  saveActive: () => Promise<void>;
  saveActiveAs: (parentRelPath: string, name: string) => Promise<void>;
  saveOrPrompt: () => Promise<void>;

  // Builder (operates on active tab)
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setBody: (body: string) => void;
  setBodyType: (type: BuilderState['bodyType']) => void;
  addHeader: () => void;
  updateHeader: (id: string, patch: Partial<HeaderRow>) => void;
  removeHeader: (id: string) => void;
  addParam: () => void;
  updateParam: (id: string, patch: Partial<ParamRow>) => void;
  removeParam: (id: string) => void;

  updateSettings: (patch: Partial<SettingsState>) => void;
  setAuth: (auth: AuthConfig) => void;
  setDisabledAutoHeaders: (keys: string[]) => void;

  send: () => Promise<void>;
  cancelSend: () => void;
  setResponseSearch: (search: string) => void;
  setResponseMode: (mode: ResponseBodyMode) => void;
  importCurlIntoActive: (input: string) => Promise<string | null>;

  loadEnvironments: () => Promise<void>;
  setActiveEnvironment: (name: string | null) => Promise<void>;
  saveEnvironment: (env: Environment) => Promise<void>;
  deleteEnvironment: (name: string) => Promise<void>;

  loadHistory: () => Promise<void>;
  deleteHistoryEntry: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  restoreHistoryEntry: (entry: HistoryEntry) => void;

  createRequest: (parentRelPath: string, name: string) => Promise<void>;
  createFolder: (parentRelPath: string, name: string) => Promise<void>;
  renameNode: (relPath: string, newName: string) => Promise<void>;
  deleteNode: (relPath: string) => Promise<void>;
  moveNode: (relPath: string, newParentRelPath: string) => Promise<string | null>;

  // Git
  gitStatus: GitStatus | null;
  gitLoaded: boolean;
  gitError: string | null;
  gitBusy: boolean;
  loadGitStatus: () => Promise<void>;
  stageFile: (relPath: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageFile: (relPath: string) => Promise<void>;
  unstageAll: () => Promise<void>;
  sidebarView: 'files' | 'git';
  setSidebarView: (view: 'files' | 'git') => void;
  discardFile: (relPath: string) => Promise<void>;
  commitChanges: (message: string) => Promise<void>;
  gitPush: () => Promise<void>;
  gitPull: () => Promise<void>;
}

function freshHeader(): HeaderRow {
  return { id: crypto.randomUUID(), key: '', value: '', enabled: true };
}

function freshParam(): ParamRow {
  return { id: crypto.randomUUID(), key: '', value: '', enabled: true };
}

function freshSettings(): SettingsState {
  return {
    proxy: { enabled: false, url: '' },
    timeout: { connect: null, read: null, total: null },
    redirect: { follow: true, maxCount: 10 },
    tls: { ignoreInvalidCerts: false },
    httpVersion: 'auto',
    scrapeDo: { enabled: false, token: '' },
  };
}

// Raw passthrough — we deliberately do NOT decode incoming param values
// or re-encode outgoing ones. The previous round-trip
// (decodeURIComponent → encodeURIComponent) double-encoded any value
// the user pasted in already-encoded form (e.g. `%20` → `%2520`).
//
// Today the cells display whatever bytes are in the URL after `?`,
// which means a pasted URL survives byte-for-byte through paste → edit
// → send → history. Users who want a decoded view can right-click a
// cell and pick "URL decode" (already wired in CellContextMenu).
function paramsFromUrl(url: string): ParamRow[] {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return [];
  const queryString = url.slice(qIndex + 1);
  if (!queryString) return [];
  const out: ParamRow[] = [];
  for (const pair of queryString.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const value = eq >= 0 ? pair.slice(eq + 1) : '';
    out.push({
      id: crypto.randomUUID(),
      key,
      value,
      enabled: true,
    });
  }
  return out;
}

function urlFromParams(url: string, params: ParamRow[]): string {
  const qIndex = url.indexOf('?');
  const base = qIndex < 0 ? url : url.slice(0, qIndex);
  const enabled = params.filter((p) => p.enabled && p.key.trim().length > 0);
  if (enabled.length === 0) return base;
  // Raw join — values are stored exactly as the user entered or pasted.
  return `${base}?${enabled.map((p) => `${p.key}=${p.value}`).join('&')}`;
}

function utf8ToBase64(text: string): string {
  if (!text) return '';
  // Robust UTF-8 → base64 (handles all unicode without throwing on
  // characters outside Latin1, unlike btoa(text) directly).
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(binary);
}

function freshExecution(): ExecutionState {
  return {
    status: 'idle',
    response: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

function builderFromRequest(request: ScrapemanRequest): BuilderState {
  const headers: HeaderRow[] = Object.entries(request.headers ?? {}).map(
    ([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true }),
  );
  if (headers.length === 0) headers.push(freshHeader());

  // params can come from request.params OR from the URL query string.
  const fromParamsField: ParamRow[] = Object.entries(request.params ?? {}).map(
    ([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true }),
  );
  const fromUrl = paramsFromUrl(request.url);
  const params = [...fromParamsField, ...fromUrl];
  if (params.length === 0) params.push(freshParam());

  let body = '';
  let bodyType: BuilderState['bodyType'] = 'none';
  if (request.body && request.body.type !== 'none') {
    if (
      request.body.type === 'json' ||
      request.body.type === 'text' ||
      request.body.type === 'xml' ||
      request.body.type === 'html' ||
      request.body.type === 'javascript'
    ) {
      body = request.body.content ?? '';
      bodyType = request.body.type === 'json' ? 'json' : 'text';
    }
  }

  const settings = freshSettings();
  if (request.proxy) {
    settings.proxy = { ...request.proxy };
  }
  if (request.options?.timeout) {
    settings.timeout = {
      connect: request.options.timeout.connect ?? null,
      read: request.options.timeout.read ?? null,
      total: request.options.timeout.total ?? null,
    };
  }
  if (request.options?.redirect) {
    settings.redirect = {
      follow: request.options.redirect.follow,
      maxCount: request.options.redirect.maxCount ?? 10,
    };
  }
  if (request.options?.tls) {
    settings.tls = {
      ignoreInvalidCerts: request.options.tls.ignoreInvalidCerts ?? false,
    };
  }
  if (request.options?.httpVersion) {
    settings.httpVersion = request.options.httpVersion;
  }
  if (request.scrapeDo) {
    settings.scrapeDo = { ...request.scrapeDo };
  }

  return {
    method: request.method,
    url: request.url,
    params,
    headers,
    body,
    bodyType,
    auth: request.auth ?? { type: 'none' },
    settings,
    disabledAutoHeaders: request.disabledAutoHeaders ?? [],
  };
}

function buildRequest(
  builder: BuilderState,
  meta: { name: string },
): ScrapemanRequest {
  const headers: Record<string, string> = {};
  for (const row of builder.headers) {
    if (row.enabled && row.key.trim()) headers[row.key.trim()] = row.value;
  }
  const request: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name: meta.name },
    method: builder.method,
    url: builder.url,
  };
  if (Object.keys(headers).length > 0) request.headers = headers;
  if (builder.bodyType !== 'none' && builder.body.trim().length > 0) {
    const contentType: 'json' | 'text' = builder.bodyType;
    request.body = { type: contentType, content: builder.body };
    if (!request.headers) request.headers = {};
    if (contentType === 'json' && !('Content-Type' in request.headers)) {
      request.headers['Content-Type'] = 'application/json';
    }
  }

  if (builder.auth.type !== 'none') {
    request.auth = builder.auth;
  }

  const s = builder.settings;
  if (s.proxy.enabled && s.proxy.url.trim()) {
    request.proxy = { ...s.proxy };
  }
  if (s.scrapeDo.enabled && s.scrapeDo.token.trim()) {
    request.scrapeDo = { ...s.scrapeDo };
  }
  const options: RequestOptions = {};
  const timeoutEntries: Record<string, number> = {};
  if (s.timeout.connect !== null) timeoutEntries['connect'] = s.timeout.connect;
  if (s.timeout.read !== null) timeoutEntries['read'] = s.timeout.read;
  if (s.timeout.total !== null) timeoutEntries['total'] = s.timeout.total;
  if (Object.keys(timeoutEntries).length > 0) options.timeout = timeoutEntries;
  if (!s.redirect.follow || s.redirect.maxCount !== 10) {
    options.redirect = { follow: s.redirect.follow, maxCount: s.redirect.maxCount };
  }
  if (s.tls.ignoreInvalidCerts) {
    options.tls = { ignoreInvalidCerts: true };
  }
  if (s.httpVersion !== 'auto') {
    options.httpVersion = s.httpVersion;
  }
  if (Object.keys(options).length > 0) request.options = options;
  if (builder.disabledAutoHeaders.length > 0) {
    request.disabledAutoHeaders = [...builder.disabledAutoHeaders];
  }

  return request;
}

function emptyDraftTab(): Tab {
  return {
    id: `draft:${crypto.randomUUID()}`,
    kind: 'draft',
    relPath: null,
    name: 'Untitled',
    method: 'GET',
    builder: {
      method: 'GET',
      url: '',
      params: [freshParam()],
      headers: [freshHeader()],
      body: '',
      bodyType: 'none',
      auth: { type: 'none' },
      settings: freshSettings(),
      disabledAutoHeaders: [],
    },
    dirty: false,
    execution: freshExecution(),
    responseSearch: '',
    responseMode: null,
  };
}

function fileBackedTab(relPath: string, request: ScrapemanRequest): Tab {
  return {
    id: `file:${relPath}`,
    kind: 'file',
    relPath,
    name: request.meta.name,
    method: request.method,
    builder: builderFromRequest(request),
    dirty: false,
    execution: freshExecution(),
    responseSearch: '',
    responseMode: null,
  };
}

export const useAppStore = create<AppState>((set, get) => {
  const mutateActive = (fn: (tab: Tab) => Tab): void => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({
      tabs: tabs.map((tab) => (tab.id === activeTabId ? fn(tab) : tab)),
    });
  };

  const patchBuilder = (patch: Partial<BuilderState>): void => {
    mutateActive((tab) => ({
      ...tab,
      builder: { ...tab.builder, ...patch },
      dirty: true,
    }));
  };

  return {
    workspace: null,
    root: null,
    recents: [],
    environments: [],
    activeEnvironment: null,
    history: [],
    tabs: [],
    activeTabId: null,
    gitStatus: null,
    gitLoaded: false,
    gitError: null,
    gitBusy: false,
    sidebarView: 'files',
    setSidebarView: (view) => set({ sidebarView: view }),
    saveDialogOpen: false,
    focusUrlTick: 0,
    importCurlTick: 0,
    loadTestTick: 0,

    loadRecents: async () => {
      const recents = await bridge.workspaceList();
      set({ recents });
    },

    pickAndOpenWorkspace: async () => {
      const picked = await bridge.workspacePickDir();
      if (picked) await get().openWorkspace(picked);
    },

    openWorkspace: async (path: string) => {
      const tree = await bridge.workspaceOpen(path);
      set({
        workspace: tree.workspace,
        root: tree.root,
        tabs: [],
        activeTabId: null,
        environments: [],
        activeEnvironment: null,
        history: [],
        gitStatus: null,
        gitLoaded: false,
        gitError: null,
      });
      await get().loadRecents();
      await get().loadEnvironments();
      await get().loadHistory();
      await get().loadGitStatus();
    },

    refreshTree: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      const tree = await bridge.workspaceOpen(workspace.path);
      set({ root: tree.root });
    },

    focusUrl: () => set({ focusUrlTick: get().focusUrlTick + 1 }),
    openImportCurl: () => set({ importCurlTick: get().importCurlTick + 1 }),
    openLoadTest: () => set({ loadTestTick: get().loadTestTick + 1 }),

    newTab: () => {
      const tab = emptyDraftTab();
      set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
    },

    closeTab: (id: string) => {
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      closedTabStack.push({ tab: tabs[idx]!, index: idx });
      if (closedTabStack.length > CLOSED_TAB_STACK_LIMIT) closedTabStack.shift();
      const next = tabs.filter((t) => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) {
        nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
      }
      set({ tabs: next, activeTabId: nextActive });
    },

    activateTabByIndex: (index: number) => {
      const { tabs } = get();
      if (tabs.length === 0) return;
      // 1-based from the caller's perspective (⌘1 = first tab). ⌘9
      // conventionally jumps to the last tab regardless of count.
      const target = index === 9 ? tabs[tabs.length - 1]! : tabs[index - 1];
      if (target) set({ activeTabId: target.id });
    },

    reopenClosedTab: () => {
      const entry = closedTabStack.pop();
      if (!entry) return;
      const { tabs } = get();
      // Drop stale snapshots of a tab that's already open again.
      if (tabs.some((t) => t.id === entry.tab.id)) {
        get().reopenClosedTab();
        return;
      }
      const insertAt = Math.min(entry.index, tabs.length);
      const next = [...tabs.slice(0, insertAt), entry.tab, ...tabs.slice(insertAt)];
      set({ tabs: next, activeTabId: entry.tab.id });
    },

    reorderTab: (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const { tabs } = get();
      const fromIdx = tabs.findIndex((t) => t.id === fromId);
      const toIdx = tabs.findIndex((t) => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...tabs];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved!);
      set({ tabs: next });
    },

    duplicateTab: (id: string) => {
      const { tabs } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const original = tabs[idx]!;
      // Deep copy through JSON since builder is plain data + UUIDs.
      const builderCopy: BuilderState = JSON.parse(
        JSON.stringify(original.builder),
      ) as BuilderState;
      // Re-mint row IDs so subsequent edits don't accidentally cross-update.
      builderCopy.headers = builderCopy.headers.map((row) => ({
        ...row,
        id: crypto.randomUUID(),
      }));
      builderCopy.params = builderCopy.params.map((row) => ({
        ...row,
        id: crypto.randomUUID(),
      }));

      const copy: Tab = {
        id: `draft:${crypto.randomUUID()}`,
        kind: 'draft',
        relPath: null,
        name: `${original.name} (copy)`,
        method: original.method,
        builder: builderCopy,
        dirty: false,
        execution: freshExecution(),
        responseSearch: '',
        responseMode: null,
      };

      // Insert immediately after the original.
      const next = [...tabs.slice(0, idx + 1), copy, ...tabs.slice(idx + 1)];
      set({ tabs: next, activeTabId: copy.id });
    },

    setActiveTab: (id: string) => {
      if (get().tabs.some((t) => t.id === id)) set({ activeTabId: id });
    },

    openRequest: async (relPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      const existing = get().tabs.find(
        (t) => t.kind === 'file' && t.relPath === relPath,
      );
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
      const request = await bridge.workspaceReadRequest(workspace.path, relPath);
      const tab = fileBackedTab(relPath, request);
      set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
    },

    saveActive: async () => {
      const workspace = get().workspace;
      const { activeTabId, tabs } = get();
      if (!workspace || !activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.kind !== 'file' || !tab.relPath) return;
      const request = buildRequest(tab.builder, { name: tab.name });
      await bridge.workspaceWriteRequest(workspace.path, tab.relPath, request);
      mutateActive((t) => ({ ...t, dirty: false, method: t.builder.method }));
      await get().refreshTree();
      void get().loadGitStatus();
    },

    openSaveDialog: () => set({ saveDialogOpen: true }),
    closeSaveDialog: () => set({ saveDialogOpen: false }),

    saveOrPrompt: async () => {
      const { activeTabId, tabs } = get();
      if (!activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;
      if (tab.kind === 'file') {
        await get().saveActive();
      } else {
        set({ saveDialogOpen: true });
      }
    },

    saveActiveAs: async (parentRelPath: string, name: string) => {
      const workspace = get().workspace;
      const { activeTabId, tabs } = get();
      if (!workspace || !activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;

      const relPath = await bridge.workspaceCreateRequest(
        workspace.path,
        parentRelPath,
        name,
      );
      const request = buildRequest(tab.builder, { name });
      await bridge.workspaceWriteRequest(workspace.path, relPath, request);

      // Convert the tab into a file-backed tab pointing at the new file.
      set({
        tabs: get().tabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                id: `file:${relPath}`,
                kind: 'file' as const,
                relPath,
                name,
                dirty: false,
              }
            : t,
        ),
        activeTabId: `file:${relPath}`,
      });
      await get().refreshTree();
    },

    setMethod: (method) =>
      mutateActive((tab) => ({
        ...tab,
        method,
        builder: { ...tab.builder, method },
        dirty: true,
      })),
    setUrl: (url) => {
      mutateActive((tab) => {
        // Re-parse params from the new URL whenever it contains a query string.
        // If the user typed a URL without ?, keep the existing params editor rows.
        const urlHasQuery = url.includes('?');
        const newParams = urlHasQuery
          ? (() => {
              const parsed = paramsFromUrl(url);
              return parsed.length > 0 ? parsed : [freshParam()];
            })()
          : tab.builder.params;
        return {
          ...tab,
          builder: { ...tab.builder, url, params: newParams },
          dirty: true,
        };
      });
    },
    setBody: (body) => patchBuilder({ body }),
    setBodyType: (bodyType) => patchBuilder({ bodyType }),

    addHeader: () => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      patchBuilder({ headers: [...active.builder.headers, freshHeader()] });
    },
    updateHeader: (id, patch) => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      patchBuilder({
        headers: active.builder.headers.map((row) =>
          row.id === id ? { ...row, ...patch } : row,
        ),
      });
    },
    removeHeader: (id) => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      patchBuilder({
        headers: active.builder.headers.filter((row) => row.id !== id),
      });
    },

    addParam: () => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      const newParams = [...active.builder.params, freshParam()];
      mutateActive((tab) => ({
        ...tab,
        builder: { ...tab.builder, params: newParams },
        dirty: true,
      }));
    },
    updateParam: (id, patch) => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      const newParams = active.builder.params.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      );
      mutateActive((tab) => ({
        ...tab,
        builder: {
          ...tab.builder,
          params: newParams,
          url: urlFromParams(tab.builder.url, newParams),
        },
        dirty: true,
      }));
    },
    removeParam: (id) => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      const newParams = active.builder.params.filter((row) => row.id !== id);
      mutateActive((tab) => ({
        ...tab,
        builder: {
          ...tab.builder,
          params: newParams,
          url: urlFromParams(tab.builder.url, newParams),
        },
        dirty: true,
      }));
    },

    updateSettings: (patch) => {
      mutateActive((tab) => ({
        ...tab,
        builder: {
          ...tab.builder,
          settings: { ...tab.builder.settings, ...patch },
        },
        dirty: true,
      }));
    },

    setAuth: (auth) => {
      mutateActive((tab) => ({
        ...tab,
        builder: { ...tab.builder, auth },
        dirty: true,
      }));
    },

    setDisabledAutoHeaders: (keys) => {
      mutateActive((tab) => ({
        ...tab,
        builder: { ...tab.builder, disabledAutoHeaders: keys },
        dirty: true,
      }));
    },

    send: async () => {
      const { activeTabId, tabs } = get();
      if (!activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || !tab.builder.url.trim()) return;

      mutateActive((t) => ({
        ...t,
        execution: {
          status: 'sending',
          response: null,
          error: null,
          startedAt: Date.now(),
          finishedAt: null,
        },
      }));

      const request = buildRequest(tab.builder, { name: tab.name });
      const workspace = get().workspace;
      const requestId = crypto.randomUUID();
      inflightRequestIds.set(tab.id, requestId);
      const result = await bridge.executeRequest(
        request,
        workspace?.path ?? undefined,
        requestId,
      );
      inflightRequestIds.delete(tab.id);
      const finishedAt = Date.now();

      mutateActive((t) => ({
        ...t,
        execution: result.ok
          ? {
              status: 'success',
              response: result.response,
              error: null,
              startedAt: t.execution.startedAt,
              finishedAt,
            }
          : {
              status: 'error',
              response: null,
              error: result.error,
              startedAt: t.execution.startedAt,
              finishedAt,
            },
      }));
      // Refresh history sidebar after every send so the new entry shows up.
      void get().loadHistory();
    },

    cancelSend: () => {
      const { activeTabId } = get();
      if (!activeTabId) return;
      const requestId = inflightRequestIds.get(activeTabId);
      if (!requestId) return;
      // Preload may be stale after a hot-reload that didn't rebuild the
      // preload bundle — guard so clicking Cancel doesn't crash the UI.
      if (typeof bridge.cancelRequest !== 'function') {
        console.warn(
          '[scrapeman] bridge.cancelRequest missing — restart the app to pick up the new preload.',
        );
        return;
      }
      void bridge.cancelRequest(requestId);
    },

    setResponseSearch: (search: string) => {
      mutateActive((tab) => ({ ...tab, responseSearch: search }));
    },

    setResponseMode: (mode) => {
      mutateActive((tab) => ({ ...tab, responseMode: mode }));
    },

    importCurlIntoActive: async (input: string) => {
      const result = await bridge.importCurl(input);
      if (!result.ok) return result.message;
      const request = result.request;
      mutateActive((tab) => ({
        ...tab,
        name: request.meta.name,
        method: request.method,
        builder: builderFromRequest(request),
        dirty: true,
      }));
      return null;
    },

    createRequest: async (parentRelPath: string, name: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      const relPath = await bridge.workspaceCreateRequest(
        workspace.path,
        parentRelPath,
        name,
      );
      await get().refreshTree();
      await get().openRequest(relPath);
    },

    createFolder: async (parentRelPath: string, name: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.workspaceCreateFolder(workspace.path, parentRelPath, name);
      await get().refreshTree();
    },

    renameNode: async (relPath: string, newName: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.workspaceRename(workspace.path, relPath, newName);
      await get().refreshTree();
    },

    moveNode: async (relPath: string, newParentRelPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return null;
      const oldParent = relPath.includes('/')
        ? relPath.slice(0, relPath.lastIndexOf('/'))
        : '';
      if (oldParent === newParentRelPath) return null;
      try {
        const newRelPath = await bridge.workspaceMove(
          workspace.path,
          relPath,
          newParentRelPath,
        );
        // Update any open tab pointing at the moved file.
        const oldId = `file:${relPath}`;
        const newId = `file:${newRelPath}`;
        const tabs = get().tabs;
        if (tabs.some((t) => t.id === oldId)) {
          set({
            tabs: tabs.map((t) =>
              t.id === oldId ? { ...t, id: newId, relPath: newRelPath } : t,
            ),
            activeTabId: get().activeTabId === oldId ? newId : get().activeTabId,
          });
        }
        await get().refreshTree();
        return newRelPath;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.alert(`Could not move: ${message}`);
        return null;
      }
    },

    deleteNode: async (relPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.workspaceDelete(workspace.path, relPath);
      const id = `file:${relPath}`;
      if (get().tabs.some((t) => t.id === id)) get().closeTab(id);
      await get().refreshTree();
    },

    loadEnvironments: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      const [environments, activeEnvironment] = await Promise.all([
        bridge.envList(workspace.path),
        bridge.envGetActive(workspace.path),
      ]);
      set({ environments, activeEnvironment });
    },

    setActiveEnvironment: async (name: string | null) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.envSetActive(workspace.path, name);
      set({ activeEnvironment: name });
    },

    saveEnvironment: async (env: Environment) => {
      const workspace = get().workspace;
      if (!workspace) {
        console.error('[scrapeman] saveEnvironment: no workspace open');
        return;
      }
      try {
        await bridge.envWrite(workspace.path, env);
        await get().loadEnvironments();
      } catch (err) {
        console.error('[scrapeman] saveEnvironment failed:', err);
        throw err;
      }
    },

    deleteEnvironment: async (name: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.envDelete(workspace.path, name);
      if (get().activeEnvironment === name) {
        await get().setActiveEnvironment(null);
      }
      await get().loadEnvironments();
    },

    loadHistory: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      const history = await bridge.historyList(workspace.path, { limit: 100 });
      set({ history });
    },

    deleteHistoryEntry: async (id: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.historyDelete(workspace.path, id);
      set({ history: get().history.filter((e) => e.id !== id) });
    },

    clearHistory: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.historyClear(workspace.path);
      set({ history: [] });
    },

    restoreHistoryEntry: (entry: HistoryEntry) => {
      // Dedup: if a tab is already restored from this exact entry, focus it
      // instead of opening another copy.
      const existing = get().tabs.find((t) => t.sourceHistoryId === entry.id);
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }

      const headers: HeaderRow[] = Object.entries(entry.headers).map(
        ([key, value]) => ({
          id: crypto.randomUUID(),
          key,
          value,
          enabled: true,
        }),
      );
      if (headers.length === 0) headers.push(freshHeader());

      const params = paramsFromUrl(entry.url);
      if (params.length === 0) params.push(freshParam());

      const bodyType: BuilderState['bodyType'] =
        entry.bodyPreview && entry.bodyPreview.trim().startsWith('{')
          ? 'json'
          : entry.bodyPreview
            ? 'text'
            : 'none';

      // Hydrate the response panel from the saved entry so clicking a history
      // row shows status/body/headers immediately, no re-send required.
      const contentType = entry.responseHeaders.find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1];

      const execution: ExecutionState = entry.error
        ? {
            status: 'error',
            response: null,
            error: entry.error,
            startedAt: null,
            finishedAt: null,
          }
        : {
            status: 'success',
            response: {
              status: entry.status,
              statusText: '',
              httpVersion: entry.protocol,
              headers: entry.responseHeaders,
              bodyBase64: utf8ToBase64(entry.responseBodyPreview ?? ''),
              // Trust new caps: stale truncated flags from older entries
              // (when the cap was 25MB) are ignored on restore. If we have
              // the full body in storage now, it is not truncated.
              bodyTruncated: false,
              sizeBytes: entry.responseSizeBytes,
              ...(contentType ? { contentType } : {}),
              timings: { totalMs: entry.durationMs },
              sentAt: entry.sentAt,
            },
            error: null,
            startedAt: null,
            finishedAt: new Date(entry.sentAt).getTime() + entry.durationMs,
          };

      const tab: Tab = {
        id: `draft:${crypto.randomUUID()}`,
        kind: 'draft',
        relPath: null,
        name: `${entry.method} ${new URL(entry.url, 'http://x').host}`,
        method: entry.method,
        builder: {
          method: entry.method,
          url: entry.url,
          params,
          headers,
          body: entry.bodyPreview,
          bodyType,
          auth: { type: 'none' },
          settings: freshSettings(),
          disabledAutoHeaders: [],
        },
        dirty: false,
        execution,
        responseSearch: '',
        responseMode: null,
        sourceHistoryId: entry.id,
      };

      set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
    },

    loadGitStatus: async () => {
      const workspace = get().workspace;
      if (!workspace) {
        set({ gitStatus: null, gitLoaded: false, gitError: null });
        return;
      }
      try {
        const status = await bridge.gitStatus(workspace.path);
        set({ gitStatus: status, gitError: null, gitLoaded: true });
      } catch (err) {
        set({
          gitStatus: null,
          gitError: err instanceof Error ? err.message : String(err),
          gitLoaded: true,
        });
      }
    },

    stageFile: async (relPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        await bridge.gitStage(workspace.path, relPath);
        await get().loadGitStatus();
      } catch (err) {
        set({ gitError: err instanceof Error ? err.message : String(err) });
      }
    },

    stageAll: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        await bridge.gitStageAll(workspace.path);
        await get().loadGitStatus();
      } catch (err) {
        set({ gitError: err instanceof Error ? err.message : String(err) });
      }
    },

    unstageFile: async (relPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        await bridge.gitUnstage(workspace.path, relPath);
        await get().loadGitStatus();
      } catch (err) {
        set({ gitError: err instanceof Error ? err.message : String(err) });
      }
    },

    unstageAll: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        await bridge.gitUnstageAll(workspace.path);
        await get().loadGitStatus();
      } catch (err) {
        set({ gitError: err instanceof Error ? err.message : String(err) });
      }
    },

    discardFile: async (relPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        await bridge.gitDiscard(workspace.path, relPath);
        await get().loadGitStatus();
      } catch (err) {
        set({ gitError: err instanceof Error ? err.message : String(err) });
      }
    },

    commitChanges: async (message: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        await bridge.gitCommit(workspace.path, message);
        await get().loadGitStatus();
      } catch (err) {
        set({ gitError: err instanceof Error ? err.message : String(err) });
      }
    },

    gitPush: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      set({ gitBusy: true, gitError: null });
      let actionError: string | null = null;
      try {
        const res = await bridge.gitPush(workspace.path);
        if (!res.ok) actionError = res.message ?? 'git push failed';
      } catch (err) {
        actionError = err instanceof Error ? err.message : String(err);
      }
      // Refresh first so ahead/behind counters update, then re-apply the
      // action error — loadGitStatus clears gitError on success and would
      // otherwise make the push failure flash and vanish.
      await get().loadGitStatus();
      set({ gitBusy: false, gitError: actionError });
    },

    gitPull: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      set({ gitBusy: true, gitError: null });
      let actionError: string | null = null;
      try {
        const res = await bridge.gitPull(workspace.path);
        if (!res.ok) actionError = res.message ?? 'git pull failed';
      } catch (err) {
        actionError = err instanceof Error ? err.message : String(err);
      }
      await get().loadGitStatus();
      set({ gitBusy: false, gitError: actionError });
    },
  };
});

export type { Environment, EnvironmentVariable };
