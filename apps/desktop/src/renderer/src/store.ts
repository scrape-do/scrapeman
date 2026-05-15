import { create } from 'zustand';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
import type {
  AuthConfig,
  CollectionFolderNode,
  CollectionSettings,
  Environment,
  EnvironmentVariable,
  ExecutedResponse,
  FolderSettings,
  GitStatus,
  GlobalVariables,
  HistoryEntry,
  HttpMethod,
  HttpVersion,
  InheritedAuthInfo,
  LoadEvent,
  LoadFailedBodyEvent,
  LoadProgress,
  ProxyConfig,
  RateLimitConfig,
  RecentWorkspace,
  RequestOptions,
  RunnerEventPayload,
  RunnerMode,
  RunnerRequestResult,
  ScrapeDoConfig,
  ScrapemanRequest,
  SerializedExecutorError,
  UpdateInfo,
  WsConnectionState,
  WsEvent,
  WsMessage,
  WorkspaceInfo,
} from '@scrapeman/shared-types';
import { bridge } from './bridge.js';

// Per-tab in-flight request id, used by cancelSend() to abort the
// running request via the main-process IPC channel.
const inflightRequestIds = new Map<string, string>();

// Per-tab monotonically increasing token for parallel sends (sendParallel).
// Each fire bumps the counter; only the latest-completed token wins the
// response panel, so spamming Cmd+R reflects whichever response *finishes*
// last (not which one was started last). Mirrors Insomnia's behaviour.
const parallelSendTokens = new Map<string, number>();
// Track the highest token whose response has already been written for each
// tab, so an out-of-order completion from an older send doesn't clobber a
// newer (finished-first) one.
const lastWrittenParallelToken = new Map<string, number>();

// Per-tab inflight request count for parallel sends. Bounded by
// MAX_INFLIGHT_PARALLEL_SENDS so holding Cmd+R for more than ~1 s doesn't
// pile up hundreds of concurrent undici requests + IPC responses in main,
// which can OOM the app on large response bodies. Excess keystrokes are
// silently dropped; the burst HUD shows a "(N capped)" indicator.
const inflightParallelSends = new Map<string, number>();
const MAX_INFLIGHT_PARALLEL_SENDS = 32;

// Bound the visible burst log so a 5-second hold-down (~150 entries at the
// macOS default key-repeat rate) doesn't bloat the DOM. FIFO eviction.
const PARALLEL_BURST_LIMIT = 50;

function appendBurst(
  current: ParallelBurstEntry[] | undefined,
  entry: ParallelBurstEntry,
): ParallelBurstEntry[] {
  const next = [...(current ?? []), entry];
  if (next.length > PARALLEL_BURST_LIMIT) {
    return next.slice(next.length - PARALLEL_BURST_LIMIT);
  }
  return next;
}

function updateBurst(
  current: ParallelBurstEntry[] | undefined,
  id: string,
  patch: (entry: ParallelBurstEntry) => ParallelBurstEntry,
): ParallelBurstEntry[] | undefined {
  if (!current) return current;
  let changed = false;
  const next = current.map((entry) => {
    if (entry.id !== id) return entry;
    changed = true;
    return patch(entry);
  });
  return changed ? next : current;
}

// LIFO stack of recently closed tabs for ⌘⇧T reopen. Bounded so a
// user who mass-closes tabs doesn't stash unbounded memory.
// Note: this stack is process-global (not per-workspace) for Phase 1
// multi-workspace support. Reopening a closed tab from another workspace
// would land it in the active workspace, which is a known sharp edge —
// Phase 2 will key the stack by workspace.
const CLOSED_TAB_STACK_LIMIT = 10;
const closedTabStack: Array<{ tab: Tab; index: number }> = [];

// localStorage keys for multi-workspace persistence (issue #61, Phase 1).
const LS_OPEN_WORKSPACES = 'workspaces:open';
const LS_LAST_ACTIVE_WORKSPACE = 'workspaces:lastActive';

/**
 * Abort any running load test and clean up the inflight-request entry for a tab
 * that is about to be closed. Must be called before removing the tab from state
 * so that orphaned load:progress events don't silently pile up in the main process.
 *
 * If the tab is later reopened via ⌘⇧T the snapshot will have a stale runId;
 * the user would need to click Start again, which is correct — old run is dead.
 */
function disposeTabRuntime(tab: Tab): void {
  const { runId } = tab.loadTest;
  if (runId !== null && (tab.loadTest.progress === null || !tab.loadTest.progress.done)) {
    // Fire-and-forget — we don't need to await the IPC call.
    void bridge.loadStop(runId);
  }
  inflightRequestIds.delete(tab.id);
}

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
  /** If non-empty, response body is expected to contain this substring. */
  validateBody: string;
  /** Key from UA_PRESETS. 'scrapeman' = default versioned UA. */
  uaPreset: string;
  rateLimit: RateLimitConfig;
  /** Per-request cookie jar toggle. true = the workspace cookie jar is used
   *  (default); false = the jar is bypassed for this request, no Cookie
   *  header is added on send and no Set-Cookie is captured. */
  useCookieJar: boolean;
  /** When true, skip `{{var}}` substitution in the request body. URL,
   *  headers, params, auth still resolve. Default false (substitution on). */
  rawBody: boolean;
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
  preRequestScript: string;
  postResponseScript: string;
}

export interface ExecutionState {
  status: 'idle' | 'sending' | 'success' | 'error';
  response: ExecutedResponse | null;
  error: SerializedExecutorError | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export type TabKind = 'file' | 'draft';

export type ResponseBodyMode = 'raw' | 'pretty' | 'tree' | 'preview' | 'events';

export interface LoadTestState {
  config: {
    total: number;
    concurrency: number;
    delay: number;
    expectStatus: string;
    expectBody: string;
    /** Capture response bodies from failed iterations. */
    saveFailedBodies: boolean;
    /** Max failed bodies to keep per run (1–1000). */
    failedBodyLimit: number;
    /** Per-run override for watched headers. Empty array = use workspace list. */
    watchedHeaders: string[];
  };
  runId: string | null;
  progress: LoadProgress | null;
  events: LoadEvent[];
  /** Ring buffer of failed iteration bodies. Populated only when
   *  config.saveFailedBodies is true. Capped at config.failedBodyLimit. */
  failedBodies: LoadFailedBodyEvent[];
  starting: boolean;
  startError: string | null;
}

// ---------------------------------------------------------------------------
// Collection runner
// ---------------------------------------------------------------------------

export interface RunnerRunState {
  runId: string;
  /** Folder relPath that was used to launch the run. */
  folderRelPath: string;
  mode: RunnerMode;
  concurrency: number;
  delayMs: number;
  iterations: number;
  /** true while the run is in flight. */
  running: boolean;
  /** true when aborted by the user. */
  aborted: boolean;
  /** Incremental list of per-request results. */
  results: RunnerRequestResult[];
  /** Counts for the live progress bar. */
  totalRequests: number;
  totalIterations: number;
  completedRequests: number;
  succeeded: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export interface RunnerPanelState {
  open: boolean;
  /** Folder relPath pre-filled when opening from the sidebar context menu. */
  folderRelPath: string;
  mode: RunnerMode;
  concurrency: number;
  delayMs: number;
  iterations: number;
  /** CSV file content loaded from disk. */
  csvContent: string;
  /** Active run, null when no run is in progress or all runs have finished. */
  activeRunId: string | null;
  /** Map of completed/in-progress runs keyed by runId. */
  runs: Map<string, RunnerRunState>;
}

export interface Tab {
  id: string;
  kind: TabKind;
  relPath: string | null;
  name: string;
  method: HttpMethod;
  builder: BuilderState;
  dirty: boolean;
  execution: ExecutionState;
  loadTest: LoadTestState;
  activePane: BuilderPane;
  responseSearch: string;
  responseMode: ResponseBodyMode | null;
  sourceHistoryId?: string;
  /** Per-tab WebSocket panel state. Initialized lazily when the pane is first activated. */
  websocket?: WsTabState;
  /** Live entries for the parallel-send (Cmd+R) burst HUD. Bounded ring
   *  buffer; cleared once empty and acknowledged. */
  parallelBursts?: ParallelBurstEntry[];
}

export interface ParallelBurstEntry {
  /** Stable client-side id assigned at the moment the request was fired. */
  id: string;
  startedAt: number;
  status: 'pending' | 'success' | 'error';
  /** HTTP status code, when the request completed with a response. */
  httpStatus?: number;
  durationMs?: number;
  errorMessage?: string;
}

export type BuilderPane =
  | 'params'
  | 'headers'
  | 'auth'
  | 'body'
  | 'settings'
  | 'scripts'
  | 'code'
  | 'load'
  | 'websocket';

export interface WsTabState {
  /** Unique id for this connection (generated client-side, stable per tab). */
  connectionId: string;
  url: string;
  state: WsConnectionState;
  timeline: WsMessage[];
  /** Draft text in the send box. */
  sendDraft: string;
  connecting: boolean;
  error: string | null;
}

/**
 * Per-workspace UI state captured when the user switches away from a
 * workspace, so we can restore the same tabs / active env / sidebar view
 * when they switch back. Phase 1 of multi-workspace (issue #61).
 *
 * Snapshots are kept in memory only — they intentionally do NOT persist
 * across app restarts. The list of open workspaces does persist; their
 * tab state is rehydrated from disk on next boot.
 */
export interface WorkspaceSnapshot {
  tabs: Tab[];
  activeTabId: string | null;
  activeEnvironment: string | null;
  sidebarView: 'files' | 'git';
}

interface AppState {
  workspace: WorkspaceInfo | null;
  root: CollectionFolderNode | null;
  recents: RecentWorkspace[];

  // Multi-workspace, Phase 1 (issue #61). The renderer still mirrors a single
  // active workspace (workspace/root/tabs/...) but tracks the set of open
  // workspaces so the user can switch between them via the sidebar header.
  // openWorkspaces persists to localStorage; workspaceSnapshots do not.
  openWorkspaces: WorkspaceInfo[];
  workspaceSnapshots: Record<string, WorkspaceSnapshot>;

  environments: Environment[];
  activeEnvironment: string | null;

  history: HistoryEntry[];

  tabs: Tab[];
  activeTabId: string | null;

  // Workspace
  loadRecents: () => Promise<void>;
  pickAndOpenWorkspace: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
  closeWorkspace: (path: string) => Promise<void>;
  /** Rehydrate openWorkspaces + lastActive from localStorage and open the
   *  last-active workspace. Called once at app boot from App.tsx. */
  bootRestoreWorkspaces: () => Promise<void>;
  refreshTree: () => Promise<void>;

  // Tabs
  saveDialogOpen: boolean;
  openSaveDialog: () => void;
  closeSaveDialog: () => void;

  // Screenshot mode: hides sidebar + tab bar so capturePage grabs only the
  // active request/response view.
  screenshotMode: boolean;
  setScreenshotMode: (v: boolean) => void;

  // Screenshot result URL. Non-null while the ScreenshotModal is open.
  screenshotUrl: string | null;
  setScreenshotUrl: (url: string) => void;
  clearScreenshotUrl: () => void;


  // Bumped by ⌘L; RequestBuilder watches and focuses+selects the URL bar.
  focusUrlTick: number;
  focusUrl: () => void;

  // Bumped by command palette "Add URL parameter"; RequestBuilder switches to
  // the params pane, appends a row, and focuses its key cell.
  focusParamsTick: number;
  focusParams: () => void;

  // Bumped by ⌘F; ResponseViewer watches and focuses+selects the search input.
  focusSearchTick: number;
  focusSearch: () => void;

  // Active builder pane (Params / Headers / Body / Auth / Settings / Code / Load)
  // is stored per-tab on Tab.activePane. This setter updates the currently
  // active request tab.
  setActivePane: (pane: BuilderPane) => void;

  // Bumped by ⌘⇧F (global) or ⌘F (sidebar focused); Sidebar watches and focuses its search input.
  focusSidebarSearchTick: number;
  focusSidebarSearch: () => void;

  // Ticks bumped by the command palette to open dialogs owned by RequestBuilder.
  importCurlTick: number;
  openImportCurl: () => void;
  importOpenApiTick: number;
  openImportOpenApi: () => void;
  loadTestTick: number;
  openLoadTest: () => void;

  newTab: () => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (keepId: string) => void;
  closeTabsToRight: (fromId: string) => void;
  closeSavedTabs: () => void;
  closeAllTabs: () => void;
  duplicateTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  activateTabByIndex: (index: number) => void;
  reopenClosedTab: () => void;
  reorderTab: (fromId: string, toId: string) => void;

  // Signal the Sidebar to expand ancestors of a file and scroll it into view.
  revealInSidebarTick: number;
  revealInSidebarPath: string | null;
  revealInSidebar: (relPath: string) => void;
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
  /** Insert a fresh header row immediately after the row with the given id. Returns the new row id. */
  insertHeaderAfter: (afterId: string) => string;
  updateHeader: (id: string, patch: Partial<HeaderRow>) => void;
  removeHeader: (id: string) => void;
  /** Replace the entire headers array atomically (used by bulk-edit mode). */
  replaceHeaders: (next: HeaderRow[]) => void;
  /** Reorder: move `fromId` before or after `toId`. */
  reorderHeader: (
    fromId: string,
    toId: string,
    position?: 'before' | 'after',
  ) => void;
  addParam: () => void;
  /** Insert a fresh param row immediately after the row with the given id. Returns the new row id. */
  insertParamAfter: (afterId: string) => string;
  updateParam: (id: string, patch: Partial<ParamRow>) => void;
  removeParam: (id: string) => void;
  /** Reorder: move `fromId` before or after `toId`. */
  reorderParam: (
    fromId: string,
    toId: string,
    position?: 'before' | 'after',
  ) => void;

  updateSettings: (patch: Partial<SettingsState>) => void;
  setAuth: (auth: AuthConfig) => void;
  setDisabledAutoHeaders: (keys: string[]) => void;
  setPreRequestScript: (code: string) => void;
  setPostResponseScript: (code: string) => void;

  send: () => Promise<void>;
  /** Insomnia-style parallel send: fires another request without cancelling
   *  the in-flight one. The response panel ends up reflecting whichever
   *  parallel send *finishes* last. */
  sendParallel: () => Promise<void>;
  /** Drop the parallel-send burst HUD entries for the active tab. */
  clearParallelBursts: () => void;
  cancelSend: () => void;
  setResponseSearch: (search: string) => void;
  setResponseMode: (mode: ResponseBodyMode) => void;
  importCurlIntoActive: (input: string) => Promise<string | null>;

  // Load test — per-tab state management
  updateLoadTestConfig: (tabId: string, patch: Partial<LoadTestState['config']>) => void;
  /** Partial patch on the load test run fields (runId, starting, startError). */
  setLoadTestRun: (tabId: string, update: Partial<Pick<LoadTestState, 'runId' | 'starting' | 'startError'>>) => void;
  appendLoadEvent: (tabId: string, event: LoadEvent) => void;
  updateLoadProgress: (tabId: string, progress: LoadProgress) => void;
  clearLoadTest: (tabId: string) => void;
  /** Atomically reset run state for a fresh start. Clears events/progress,
   *  sets starting:true, stores the pre-generated runId, preserves config. */
  resetLoadTestForStart: (tabId: string, runId: string) => void;
  /** Called by the global onLoadProgress listener; routes the event to the correct tab. */
  handleLoadProgress: (p: LoadProgress) => void;
  /** Clear only the failed-bodies ring buffer for a tab (e.g. on export). */
  clearFailedBodies: (tabId: string) => void;

  loadEnvironments: () => Promise<void>;
  setActiveEnvironment: (name: string | null) => Promise<void>;
  saveEnvironment: (env: Environment) => Promise<void>;
  deleteEnvironment: (name: string) => Promise<void>;

  // Globals
  globals: GlobalVariables;
  loadGlobals: () => Promise<void>;
  saveGlobals: (globals: GlobalVariables) => Promise<void>;

  // Collection settings
  collectionSettings: CollectionSettings;
  loadCollectionSettings: () => Promise<void>;
  saveCollectionSettings: (settings: CollectionSettings) => Promise<void>;

  // Folder settings (keyed by folderRelPath)
  folderSettingsCache: Record<string, FolderSettings>;
  loadFolderSettings: (folderRelPath: string) => Promise<FolderSettings>;
  saveFolderSettings: (
    folderRelPath: string,
    settings: FolderSettings,
  ) => Promise<void>;

  // Auth inheritance resolve (on-demand, not cached in store)
  resolveInheritedAuth: (
    requestRelPath: string,
  ) => Promise<InheritedAuthInfo | null>;

  loadHistory: () => Promise<void>;
  deleteHistoryEntry: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  restoreHistoryEntry: (entry: HistoryEntry) => void;

  createRequest: (parentRelPath: string, name: string) => Promise<void>;
  createFolder: (parentRelPath: string, name: string) => Promise<void>;
  renameNode: (relPath: string, newName: string) => Promise<void>;
  deleteNode: (relPath: string) => Promise<void>;
  moveNode: (relPath: string, newParentRelPath: string) => Promise<string | null>;

  // WebSocket
  wsConnect: (tabId: string, url: string) => Promise<void>;
  wsSend: (tabId: string, data: string) => Promise<void>;
  wsDisconnect: (tabId: string) => Promise<void>;
  wsSetUrl: (tabId: string, url: string) => void;
  wsSetSendDraft: (tabId: string, draft: string) => void;
  handleWsEvent: (event: WsEvent) => void;

  // Collection runner
  runner: RunnerPanelState;
  openRunnerPanel: (folderRelPath: string) => void;
  closeRunnerPanel: () => void;
  updateRunnerConfig: (patch: Partial<Pick<RunnerPanelState, 'mode' | 'concurrency' | 'delayMs' | 'iterations' | 'csvContent'>>) => void;
  startRunner: () => Promise<void>;
  stopRunner: () => Promise<void>;
  handleRunnerEvent: (event: RunnerEventPayload) => void;
  exportRunnerReport: (format: 'json' | 'csv' | 'html') => Promise<void>;

  // Auto-update
  updateInfo: UpdateInfo | null;
  dismissedVersions: string[];
  setUpdateInfo: (info: UpdateInfo) => void;
  dismissUpdate: (version: string) => void;

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
  gitPull: (strategy?: import('@scrapeman/shared-types').GitPullStrategy) => Promise<{ diverged?: boolean }>;

  // Local-hide (issue #42): requests the user has hidden from git sync via
  // .git/info/exclude. Scoped per workspace; reloaded whenever the tree or
  // git status refreshes.
  hiddenRequests: Set<string>;
  loadHiddenRequests: () => Promise<void>;
  toggleHiddenRequest: (relPath: string) => Promise<void>;
}

function freshHeader(): HeaderRow {
  return { id: crypto.randomUUID(), key: '', value: '', enabled: true };
}

function freshParam(): ParamRow {
  return { id: crypto.randomUUID(), key: '', value: '', enabled: true };
}

// Read the user's global TLS default from localStorage. Defaults to
// `false` (verification on). The Settings dialog's Network tab writes
// here; new requests start from this value so a user who works through
// a self-signed corporate proxy doesn't have to flip it on every time.
function readGlobalIgnoreInvalidCerts(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('settings:tls:ignoreInvalidCerts') === 'true';
  } catch {
    return false;
  }
}

function freshSettings(): SettingsState {
  return {
    proxy: { enabled: false, url: '' },
    timeout: { connect: null, read: null, total: null },
    redirect: { follow: true, maxCount: 10 },
    tls: { ignoreInvalidCerts: readGlobalIgnoreInvalidCerts() },
    httpVersion: 'auto',
    scrapeDo: { enabled: false, token: '' },
    validateBody: '',
    uaPreset: 'scrapeman',
    rateLimit: { enabled: false, fixedDelayMs: 0 },
    useCookieJar: true,
    rawBody: false,
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
export function paramsFromUrl(url: string): ParamRow[] {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return [];
  const queryString = url.slice(qIndex + 1);
  if (!queryString) return [];

  // Greedy parse for the scrape.do-style nested URL pattern (#88):
  // `?url=https://target.com?a=1&b=2`. A spec-compliant client encodes
  // the inner `&`, but the convention in scraping land is to paste the
  // target URL raw. Without help, a naive `&` split would explode the
  // inner URL into separate rows. Heuristic: when the previous chunk's
  // value already contains a `?` (an inner-URL query separator), fold
  // every subsequent chunk back into that value with `&` re-inserted.
  // Falls back to the spec behaviour the moment a clean (non-`?`)
  // value appears.
  const chunks = queryString.split('&');
  const merged: string[] = [];
  for (const chunk of chunks) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined) {
      const eqInPrev = prev.indexOf('=');
      const prevValue = eqInPrev >= 0 ? prev.slice(eqInPrev + 1) : '';
      if (prevValue.includes('?')) {
        merged[merged.length - 1] = prev + '&' + chunk;
        continue;
      }
    }
    merged.push(chunk);
  }

  const out: ParamRow[] = [];
  for (const pair of merged) {
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

function freshLoadTest(): LoadTestState {
  return {
    config: {
      total: 100,
      concurrency: 10,
      delay: 0,
      expectStatus: '200',
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
  };
}

function builderFromRequest(request: ScrapemanRequest): BuilderState {
  const headers: HeaderRow[] = Object.entries(request.headers ?? {}).map(
    ([key, value]) => ({ id: crypto.randomUUID(), key, value, enabled: true }),
  );
  if (headers.length === 0) headers.push(freshHeader());

  // params can come from request.params OR from the URL query string.
  // request.params holds ALL params (enabled and disabled); disabledParams
  // lists the keys that are turned off so we can restore the enabled flag.
  const disabledSet = new Set(request.disabledParams ?? []);
  const fromParamsField: ParamRow[] = Object.entries(request.params ?? {}).map(
    ([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value,
      enabled: !disabledSet.has(key),
    }),
  );
  // Only parse URL query params that are not already present in request.params.
  // This avoids duplicating enabled params that were also encoded in the URL.
  const paramsFieldKeys = new Set(Object.keys(request.params ?? {}));
  const fromUrl = paramsFromUrl(request.url).filter((p) => !paramsFieldKeys.has(p.key));
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
  if (request.uaPreset) {
    settings.uaPreset = request.uaPreset;
  }
  if (request.rateLimit) {
    settings.rateLimit = { ...request.rateLimit };
  }
  if (request.options?.cookieJar?.enabled === false) {
    settings.useCookieJar = false;
  }
  if (request.options?.rawBody === true) {
    settings.rawBody = true;
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
    preRequestScript: request.scripts?.preRequest ?? '',
    postResponseScript: request.scripts?.postResponse ?? '',
  };
}

/** Prepend http:// when the URL has no schema. */
export function normalizeUrlSchema(raw: string): string {
  const url = raw.trim();
  if (!url) return url;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) return url;
  if (url.startsWith(':/')) return 'http://0.0.0.0' + url.slice(1);
  // When the URL starts with a `{{var}}` placeholder, the actual scheme
  // is unknown until the resolver runs in the main process. Prepending
  // http:// here would corrupt cases where the variable already contains
  // a full URL (e.g. `{{base_url}}/users` with `base_url=https://api.x`
  // would become `http://https://api.x/users` and fail to parse).
  // Leave it alone — `normalizeUrl` runs again post-resolve and adds the
  // scheme then if still missing.
  if (/^\{\{/.test(url)) return url;
  return 'http://' + url;
}

function buildRequest(
  builder: BuilderState,
  meta: { name: string },
): ScrapemanRequest {
  const headers: Record<string, string> = {};
  for (const row of builder.headers) {
    if (row.enabled && row.key.trim()) headers[row.key.trim()] = row.value;
  }
  // Persist ALL params (enabled + disabled) in row order so that reload
  // restores the exact UI ordering the user built. The executor skips
  // disabled keys and avoids duplicating keys already present in the URL
  // query string, so this does not introduce the duplicate-append bug.
  const allParams: Record<string, string> = {};
  const disabledParamKeys: string[] = [];
  for (const row of builder.params) {
    if (!row.key.trim()) continue;
    allParams[row.key.trim()] = row.value;
    if (!row.enabled) disabledParamKeys.push(row.key.trim());
  }

  const request: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name: meta.name },
    method: builder.method,
    url: builder.url,
  };
  if (Object.keys(allParams).length > 0) request.params = allParams;
  if (disabledParamKeys.length > 0) request.disabledParams = disabledParamKeys;
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
  // Proxy: include when enabled and either a single URL or a rotate list is set.
  const hasRotate =
    s.proxy.rotate && s.proxy.rotate.urls.length > 0;
  if (s.proxy.enabled && (s.proxy.url.trim() || hasRotate)) {
    request.proxy = { ...s.proxy };
  }
  if (s.scrapeDo.enabled && s.scrapeDo.token.trim()) {
    request.scrapeDo = { ...s.scrapeDo };
  }
  if (s.uaPreset && s.uaPreset !== 'scrapeman') {
    request.uaPreset = s.uaPreset;
  }
  if (s.rateLimit.enabled) {
    request.rateLimit = { ...s.rateLimit };
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
  // Persist cookieJar.enabled only when the user has turned it OFF — default
  // is true, so the absence of the field means "use the jar".
  if (!s.useCookieJar) {
    options.cookieJar = { enabled: false };
  }
  // Persist rawBody only when on; default false means substitute the body.
  if (s.rawBody) {
    options.rawBody = true;
  }
  if (Object.keys(options).length > 0) request.options = options;
  if (builder.disabledAutoHeaders.length > 0) {
    request.disabledAutoHeaders = [...builder.disabledAutoHeaders];
  }

  const hasPreRequest = builder.preRequestScript.trim().length > 0;
  const hasPostResponse = builder.postResponseScript.trim().length > 0;
  if (hasPreRequest || hasPostResponse) {
    request.scripts = {
      ...(hasPreRequest ? { preRequest: builder.preRequestScript } : {}),
      ...(hasPostResponse ? { postResponse: builder.postResponseScript } : {}),
    };
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
      preRequestScript: '',
      postResponseScript: '',
    },
    dirty: false,
    execution: freshExecution(),
    loadTest: freshLoadTest(),
    activePane: 'params',
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
    loadTest: freshLoadTest(),
    activePane: 'params',
    responseSearch: '',
    responseMode: null,
  };
}

/**
 * Read the persisted list of open workspaces from localStorage. Tolerant
 * of malformed JSON (returns []) so a corrupted entry can never wedge boot.
 */
export function readPersistedOpenWorkspaces(): WorkspaceInfo[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(LS_OPEN_WORKSPACES);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: WorkspaceInfo[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as { path?: unknown }).path === 'string' &&
        typeof (item as { name?: unknown }).name === 'string'
      ) {
        const w = item as WorkspaceInfo;
        out.push({ path: w.path, name: w.name });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function readPersistedLastActiveWorkspace(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(LS_LAST_ACTIVE_WORKSPACE);
}

function persistOpenWorkspaces(list: WorkspaceInfo[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_OPEN_WORKSPACES, JSON.stringify(list));
}

// Per-workspace tab snapshot key. Stores everything needed to rebuild
// open tabs (saved or not) on next boot. Live runtime state — current
// execution, websocket connection, load test progress, parallel burst
// HUD — is stripped out before serialising.
function snapshotKey(workspacePath: string): string {
  return `workspace:tabs:${workspacePath}`;
}

function stripTabForPersistence(tab: Tab): Tab {
  // Reset execution to idle so a stale "sending" / "success" doesn't
  // resurrect after restart with a response that is no longer in memory.
  const stripped: Tab = {
    ...tab,
    execution: {
      status: 'idle',
      response: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    },
    // loadTest config persists (the user configured it), but the live
    // run state is tied to a runId in main that is gone after restart.
    loadTest: { ...tab.loadTest, runId: null, progress: null, events: [], failedBodies: [], starting: false, startError: null },
  };
  // Drop optional, transient-only fields — websocket connection is dead
  // after restart, parallel-burst HUD is per-session noise.
  delete stripped.websocket;
  delete stripped.parallelBursts;
  return stripped;
}

export function persistWorkspaceSnapshot(
  workspacePath: string,
  snap: WorkspaceSnapshot,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload = {
      ...snap,
      tabs: snap.tabs.map(stripTabForPersistence),
    };
    localStorage.setItem(snapshotKey(workspacePath), JSON.stringify(payload));
  } catch {
    /* localStorage quota or serialise failure — drop silently */
  }
}

export function readWorkspaceSnapshot(
  workspacePath: string,
): WorkspaceSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(snapshotKey(workspacePath));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (!Array.isArray(parsed.tabs)) return null;
    return {
      tabs: parsed.tabs as Tab[],
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
      activeEnvironment:
        typeof parsed.activeEnvironment === 'string' ? parsed.activeEnvironment : null,
      sidebarView:
        parsed.sidebarView === 'git' || parsed.sidebarView === 'files'
          ? parsed.sidebarView
          : 'files',
    };
  } catch {
    return null;
  }
}

function persistLastActiveWorkspace(path: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (path === null) localStorage.removeItem(LS_LAST_ACTIVE_WORKSPACE);
  else localStorage.setItem(LS_LAST_ACTIVE_WORKSPACE, path);
}

/**
 * Capture the per-workspace UI state from a slice of the store. Pure so it
 * can be unit-tested without instantiating Zustand.
 */
export function captureWorkspaceSnapshot(state: {
  tabs: Tab[];
  activeTabId: string | null;
  activeEnvironment: string | null;
  sidebarView: 'files' | 'git';
}): WorkspaceSnapshot {
  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activeEnvironment: state.activeEnvironment,
    sidebarView: state.sidebarView,
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

  // Update a tab by explicit id, regardless of which tab is currently active.
  // Use this in async callbacks where activeTabId may have changed since the
  // operation was started.
  const mutateById = (tabId: string, fn: (tab: Tab) => Tab): void => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? fn(tab) : tab)),
    }));
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
    openWorkspaces: [],
    workspaceSnapshots: {},
    environments: [],
    activeEnvironment: null,
    globals: { variables: [] },
    collectionSettings: { variables: [] },
    folderSettingsCache: {},
    history: [],
    tabs: [],
    activeTabId: null,
    updateInfo: null,
    dismissedVersions: [],
    setUpdateInfo: (info) => {
      const { dismissedVersions } = get();
      if (dismissedVersions.includes(info.version)) return;
      set({ updateInfo: info });
    },
    dismissUpdate: (version) => {
      const { dismissedVersions } = get();
      bridge.dismissUpdate(version);
      set({
        updateInfo: null,
        dismissedVersions: [...dismissedVersions, version],
      });
    },

    gitStatus: null,
    gitLoaded: false,
    gitError: null,
    gitBusy: false,
    hiddenRequests: new Set<string>(),
    sidebarView: 'files',
    setSidebarView: (view) => set({ sidebarView: view }),
    saveDialogOpen: false,
    screenshotMode: false,
    setScreenshotMode: (v) => set({ screenshotMode: v }),
    screenshotUrl: null,
    setScreenshotUrl: (url) => set({ screenshotUrl: url }),
    clearScreenshotUrl: () => set({ screenshotUrl: null }),
    focusUrlTick: 0,
    focusParamsTick: 0,
    focusSearchTick: 0,
    setActivePane: (pane) => mutateActive((tab) => ({ ...tab, activePane: pane })),
    focusSidebarSearchTick: 0,
    importCurlTick: 0,
    importOpenApiTick: 0,
    loadTestTick: 0,
    revealInSidebarTick: 0,
    revealInSidebarPath: null,

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
      // Add to openWorkspaces if not already there. We splice in place so the
      // sidebar dropdown order stays stable across reopens.
      const existingOpen = get().openWorkspaces;
      const alreadyOpen = existingOpen.some((w) => w.path === tree.workspace.path);
      const nextOpen = alreadyOpen
        ? existingOpen
        : [...existingOpen, tree.workspace];

      // Read the persisted tab snapshot SYNCHRONOUSLY before we touch the
      // store. If we instead let the store go through an intermediate
      // `tabs: []` state, the persistence subscriber's RAF would run during
      // the await window below and overwrite the saved snapshot with the
      // empty placeholder — wiping the user's tabs before we got a chance
      // to read them. In-memory snapshot wins for the workspace-switch
      // flow; localStorage is the cold-boot fallback.
      const snap =
        get().workspaceSnapshots[tree.workspace.path] ??
        readWorkspaceSnapshot(tree.workspace.path);

      set({
        workspace: tree.workspace,
        root: tree.root,
        openWorkspaces: nextOpen,
        tabs: snap?.tabs ?? [],
        activeTabId: snap?.activeTabId ?? null,
        sidebarView: snap?.sidebarView ?? 'files',
        environments: [],
        activeEnvironment: null,
        globals: { variables: [] },
        collectionSettings: { variables: [] },
        folderSettingsCache: {},
        history: [],
        gitStatus: null,
        gitLoaded: false,
        gitError: null,
        hiddenRequests: new Set<string>(),
      });
      persistOpenWorkspaces(nextOpen);
      persistLastActiveWorkspace(tree.workspace.path);
      await get().loadRecents();
      await get().loadEnvironments();
      await get().loadGlobals();
      await get().loadCollectionSettings();
      await get().loadHistory();
      await get().loadGitStatus();
      await get().loadHiddenRequests();

      // Active-environment restore is deferred to here because it depends
      // on `loadEnvironments` having populated the env list — we only
      // re-activate an environment that still exists on disk.
      if (snap && snap.activeEnvironment !== null) {
        const envs = get().environments;
        if (envs.some((e) => e.name === snap.activeEnvironment)) {
          if (snap.activeEnvironment !== get().activeEnvironment) {
            set({ activeEnvironment: snap.activeEnvironment });
            // Fire-and-forget: push to disk so subsequent sends pick it up.
            void bridge.envSetActive(tree.workspace.path, snap.activeEnvironment);
          }
        }
      }
    },

    switchWorkspace: async (path: string) => {
      const current = get().workspace;
      if (current && current.path === path) return;
      // Snapshot the outgoing workspace's UI state before openWorkspace
      // wipes it. Capture from the live store, not from a stale closure.
      if (current) {
        const snap = captureWorkspaceSnapshot({
          tabs: get().tabs,
          activeTabId: get().activeTabId,
          activeEnvironment: get().activeEnvironment,
          sidebarView: get().sidebarView,
        });
        set({
          workspaceSnapshots: {
            ...get().workspaceSnapshots,
            [current.path]: snap,
          },
        });
        persistWorkspaceSnapshot(current.path, snap);
      }
      await get().openWorkspace(path);
    },

    closeWorkspace: async (path: string) => {
      const { workspace, openWorkspaces, workspaceSnapshots } = get();
      const nextOpen = openWorkspaces.filter((w) => w.path !== path);
      // Drop the snapshot — closing means we don't preserve UI state.
      const nextSnaps = { ...workspaceSnapshots };
      delete nextSnaps[path];
      const wasActive = workspace?.path === path;

      // Persist + commit the new open list immediately so the dropdown
      // updates even if we don't switch (e.g. closing a non-active one).
      persistOpenWorkspaces(nextOpen);
      set({ openWorkspaces: nextOpen, workspaceSnapshots: nextSnaps });

      if (!wasActive) return;

      if (nextOpen.length === 0) {
        // No remaining workspaces — fall back to the empty-state picker.
        persistLastActiveWorkspace(null);
        set({
          workspace: null,
          root: null,
          tabs: [],
          activeTabId: null,
          environments: [],
          activeEnvironment: null,
          history: [],
          gitStatus: null,
          gitLoaded: false,
          gitError: null,
          hiddenRequests: new Set<string>(),
        });
        return;
      }
      // Switch to the next workspace in the open list. We don't track
      // recency separately in Phase 1 — most-recent-used would require
      // either an LRU array or a per-workspace lastTouchedAt; the issue
      // says "most recently used" but Phase 1 keeps it simple by using
      // the rightmost remaining one (the most recently added).
      const fallback = nextOpen[nextOpen.length - 1]!;
      await get().openWorkspace(fallback.path);
    },

    bootRestoreWorkspaces: async () => {
      const persisted = readPersistedOpenWorkspaces();
      if (persisted.length === 0) return;
      // Seed openWorkspaces synchronously so the dropdown can render even
      // before the active workspace finishes loading from disk.
      set({ openWorkspaces: persisted });
      const lastActive = readPersistedLastActiveWorkspace();
      const target =
        lastActive && persisted.some((w) => w.path === lastActive)
          ? lastActive
          : persisted[0]!.path;
      try {
        await get().openWorkspace(target);
      } catch (err) {
        // If the target is gone (deleted folder, permission revoked) drop it
        // from openWorkspaces so the user isn't stuck in a boot loop.
        const remaining = get().openWorkspaces.filter((w) => w.path !== target);
        persistOpenWorkspaces(remaining);
        set({ openWorkspaces: remaining, workspace: null, root: null });
        console.error('[scrapeman] bootRestoreWorkspaces failed for', target, err);
      }
    },

    refreshTree: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      const tree = await bridge.workspaceOpen(workspace.path);
      set({ root: tree.root });
    },

    focusUrl: () => set({ focusUrlTick: get().focusUrlTick + 1 }),
    focusParams: () => {
      mutateActive((tab) => ({ ...tab, activePane: 'params' }));
      set({ focusParamsTick: get().focusParamsTick + 1 });
    },
    focusSearch: () => set({ focusSearchTick: get().focusSearchTick + 1 }),
    focusSidebarSearch: () =>
      set({ focusSidebarSearchTick: get().focusSidebarSearchTick + 1 }),
    openImportCurl: () => set({ importCurlTick: get().importCurlTick + 1 }),
    openImportOpenApi: () => set({ importOpenApiTick: get().importOpenApiTick + 1 }),
    openLoadTest: () => set({ loadTestTick: get().loadTestTick + 1 }),

    newTab: () => {
      const tab = emptyDraftTab();
      // Bump focusUrlTick so RequestBuilder auto-focuses the URL input on
      // fresh tabs. History restore and openRequest intentionally do NOT
      // touch this counter, so they never steal focus.
      set({
        tabs: [...get().tabs, tab],
        activeTabId: tab.id,
        focusUrlTick: get().focusUrlTick + 1,
      });
    },

    closeTab: (id: string) => {
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      disposeTabRuntime(tabs[idx]!);
      closedTabStack.push({ tab: tabs[idx]!, index: idx });
      if (closedTabStack.length > CLOSED_TAB_STACK_LIMIT) closedTabStack.shift();
      const next = tabs.filter((t) => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) {
        nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
      }
      set({ tabs: next, activeTabId: nextActive });
    },

    // Bulk-close helpers snapshot every removed tab onto closedTabStack so
    // ⌘⇧T reopen still works, then commit in one set() to avoid N renders.
    closeOtherTabs: (keepId: string) => {
      const { tabs } = get();
      if (tabs.length <= 1) return;
      const kept = tabs.find((t) => t.id === keepId);
      if (!kept) return;
      // Push in reverse so the rightmost closed tab pops first on ⌘⇧T
      // (VS Code most-recent-first semantics).
      for (let i = tabs.length - 1; i >= 0; i -= 1) {
        const tab = tabs[i]!;
        if (tab.id === keepId) continue;
        disposeTabRuntime(tab);
        closedTabStack.push({ tab, index: i });
        if (closedTabStack.length > CLOSED_TAB_STACK_LIMIT) closedTabStack.shift();
      }
      set({ tabs: [kept], activeTabId: keepId });
    },

    closeTabsToRight: (fromId: string) => {
      const { tabs, activeTabId } = get();
      const idx = tabs.findIndex((t) => t.id === fromId);
      if (idx < 0 || idx === tabs.length - 1) return;
      for (let i = tabs.length - 1; i > idx; i -= 1) {
        disposeTabRuntime(tabs[i]!);
        closedTabStack.push({ tab: tabs[i]!, index: i });
        if (closedTabStack.length > CLOSED_TAB_STACK_LIMIT) closedTabStack.shift();
      }
      const next = tabs.slice(0, idx + 1);
      const stillActive = next.some((t) => t.id === activeTabId);
      set({
        tabs: next,
        activeTabId: stillActive ? activeTabId : fromId,
      });
    },

    closeSavedTabs: () => {
      const { tabs, activeTabId } = get();
      const keepers: Tab[] = [];
      const removed: Array<{ tab: Tab; index: number }> = [];
      tabs.forEach((tab, index) => {
        if (tab.dirty) {
          keepers.push(tab);
          return;
        }
        removed.push({ tab, index });
      });
      if (removed.length === 0) return;
      for (let i = removed.length - 1; i >= 0; i -= 1) {
        disposeTabRuntime(removed[i]!.tab);
        closedTabStack.push(removed[i]!);
        if (closedTabStack.length > CLOSED_TAB_STACK_LIMIT) closedTabStack.shift();
      }
      const stillActive = keepers.some((t) => t.id === activeTabId);
      set({
        tabs: keepers,
        activeTabId: stillActive ? activeTabId : (keepers[0]?.id ?? null),
      });
    },

    closeAllTabs: () => {
      const { tabs } = get();
      if (tabs.length === 0) return;
      for (let i = tabs.length - 1; i >= 0; i -= 1) {
        disposeTabRuntime(tabs[i]!);
        closedTabStack.push({ tab: tabs[i]!, index: i });
        if (closedTabStack.length > CLOSED_TAB_STACK_LIMIT) closedTabStack.shift();
      }
      set({ tabs: [], activeTabId: null });
    },

    revealInSidebar: (relPath: string) =>
      set({
        revealInSidebarPath: relPath,
        revealInSidebarTick: get().revealInSidebarTick + 1,
      }),

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
        loadTest: freshLoadTest(),
    activePane: 'params',
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
      const oldRelPath = tab.relPath;
      // writeRequest may migrate `.req.yaml` → `.sman` and return the new
      // path. When that happens we rewrite the open tab's id + relPath so
      // subsequent saves hit the new file and git status attributes lines
      // to the right path.
      const newRelPath = await bridge.workspaceWriteRequest(
        workspace.path,
        oldRelPath,
        request,
      );
      if (newRelPath !== oldRelPath) {
        const oldId = `file:${oldRelPath}`;
        const newId = `file:${newRelPath}`;
        set({
          tabs: get().tabs.map((t) =>
            t.id === oldId
              ? { ...t, id: newId, relPath: newRelPath, dirty: false, method: t.builder.method }
              : t,
          ),
          activeTabId:
            get().activeTabId === oldId ? newId : get().activeTabId,
        });
      } else {
        mutateActive((t) => ({ ...t, dirty: false, method: t.builder.method }));
      }
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
        // Merge freshly parsed URL params with existing rows PRESERVING
        // their order. Disabled rows stay in place untouched. Enabled rows
        // get their value refreshed from the URL — if the user removed
        // their key from the URL bar (or cleared the URL entirely), the
        // enabled row is dropped. New keys from the URL are appended after
        // the existing rows. `paramsFromUrl` returns [] for any URL with
        // no `?`, so the merge correctly empties enabled rows when the
        // user clears the URL bar.
        const fromUrl = paramsFromUrl(url);
        const fromUrlByKey = new Map(fromUrl.map((p) => [p.key, p.value]));
        const existingKeys = new Set<string>();
        const merged: ParamRow[] = [];
        for (const row of tab.builder.params) {
          existingKeys.add(row.key);
          if (!row.enabled) {
            merged.push(row);
            continue;
          }
          const v = fromUrlByKey.get(row.key);
          if (v !== undefined) merged.push({ ...row, value: v });
          // enabled but removed from URL → drop the row
        }
        for (const p of fromUrl) {
          if (!existingKeys.has(p.key)) merged.push(p);
        }
        const newParams = merged.length > 0 ? merged : [freshParam()];
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
    insertHeaderAfter: (afterId) => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      const row = freshHeader();
      if (!active) return row.id;
      const idx = active.builder.headers.findIndex((h) => h.id === afterId);
      const next = [...active.builder.headers];
      // Insert after the found index; if not found, append at end.
      next.splice(idx < 0 ? next.length : idx + 1, 0, row);
      patchBuilder({ headers: next });
      return row.id;
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
    replaceHeaders: (next) => {
      patchBuilder({ headers: next });
    },
    reorderHeader: (fromId, toId, position = 'before') => {
      if (fromId === toId) return;
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      const rows = active.builder.headers;
      const moved = rows.find((r) => r.id === fromId);
      if (!moved) return;
      const without = rows.filter((r) => r.id !== fromId);
      const toIdxInWithout = without.findIndex((r) => r.id === toId);
      if (toIdxInWithout < 0) return;
      const insertAt = position === 'after' ? toIdxInWithout + 1 : toIdxInWithout;
      const next = [...without];
      next.splice(insertAt, 0, moved);
      patchBuilder({ headers: next });
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
    insertParamAfter: (afterId) => {
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      const row = freshParam();
      if (!active) return row.id;
      const idx = active.builder.params.findIndex((p) => p.id === afterId);
      const next = [...active.builder.params];
      // Insert after the found index; if not found, append at end.
      next.splice(idx < 0 ? next.length : idx + 1, 0, row);
      mutateActive((tab) => ({
        ...tab,
        builder: {
          ...tab.builder,
          params: next,
          url: urlFromParams(tab.builder.url, next),
        },
        dirty: true,
      }));
      return row.id;
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
    reorderParam: (fromId, toId, position = 'before') => {
      if (fromId === toId) return;
      const active = get().tabs.find((t) => t.id === get().activeTabId);
      if (!active) return;
      const rows = active.builder.params;
      const moved = rows.find((r) => r.id === fromId);
      if (!moved) return;
      const without = rows.filter((r) => r.id !== fromId);
      const toIdxInWithout = without.findIndex((r) => r.id === toId);
      if (toIdxInWithout < 0) return;
      const insertAt = position === 'after' ? toIdxInWithout + 1 : toIdxInWithout;
      const next = [...without];
      next.splice(insertAt, 0, moved);
      mutateActive((tab) => ({
        ...tab,
        builder: {
          ...tab.builder,
          params: next,
          url: urlFromParams(tab.builder.url, next),
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

    setPreRequestScript: (code) => {
      patchBuilder({ preRequestScript: code });
    },

    setPostResponseScript: (code) => {
      patchBuilder({ postResponseScript: code });
    },

    send: async () => {
      const { activeTabId, tabs } = get();
      if (!activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || !tab.builder.url.trim()) return;

      // Capture the tab id at call time. The user may switch tabs before the
      // async response arrives, so we must update the originating tab — not
      // whatever tab happens to be active when the callback fires.
      const targetTabId = tab.id;

      mutateById(targetTabId, (t) => ({
        ...t,
        execution: {
          status: 'sending',
          response: null,
          error: null,
          startedAt: Date.now(),
          finishedAt: null,
        },
      }));

      const normalizedBuilder = {
        ...tab.builder,
        url: normalizeUrlSchema(tab.builder.url),
      };
      const request = buildRequest(normalizedBuilder, { name: tab.name });
      const workspace = get().workspace;
      const requestId = crypto.randomUUID();
      inflightRequestIds.set(targetTabId, requestId);
      const result = await bridge.executeRequest(
        request,
        workspace?.path ?? undefined,
        requestId,
      );
      inflightRequestIds.delete(targetTabId);
      const finishedAt = Date.now();

      mutateById(targetTabId, (t) => ({
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

    // Insomnia-style: every press fires a new request without touching
    // anything in flight. The response panel reflects whichever parallel
    // send *finishes* last — out-of-order completions from earlier presses
    // are dropped so they don't clobber a newer finished response.
    sendParallel: async () => {
      const { activeTabId, tabs } = get();
      if (!activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || !tab.builder.url.trim()) return;

      const targetTabId = tab.id;

      // Drop the keystroke when the per-tab cap is reached. Holding Cmd+R
      // at the OS key-repeat rate would otherwise pile up hundreds of
      // concurrent IPC executes — large response bodies + history writes
      // can crash the main process. The cap is high enough that a typical
      // burst (1–2 s hold) still fans out fully.
      const inflight = inflightParallelSends.get(targetTabId) ?? 0;
      if (inflight >= MAX_INFLIGHT_PARALLEL_SENDS) return;
      inflightParallelSends.set(targetTabId, inflight + 1);

      const startedAt = Date.now();
      const burstId = crypto.randomUUID();

      const nextToken = (parallelSendTokens.get(targetTabId) ?? 0) + 1;
      parallelSendTokens.set(targetTabId, nextToken);

      // Reflect "in flight" only if the tab isn't already showing a finished
      // response — leaving the panel as-is during a parallel burst keeps the
      // user reading whichever response landed most recently.
      const currentStatus = tab.execution.status;
      const newPending: ParallelBurstEntry = {
        id: burstId,
        startedAt,
        status: 'pending',
      };
      mutateById(targetTabId, (t) => ({
        ...t,
        execution:
          currentStatus === 'idle' || currentStatus === 'error'
            ? {
                status: 'sending',
                response: null,
                error: null,
                startedAt,
                finishedAt: null,
              }
            : t.execution,
        parallelBursts: appendBurst(t.parallelBursts, newPending),
      }));

      const normalizedBuilder = {
        ...tab.builder,
        url: normalizeUrlSchema(tab.builder.url),
      };
      const request = buildRequest(normalizedBuilder, { name: tab.name });
      const workspace = get().workspace;
      const requestId = crypto.randomUUID();

      let result;
      try {
        result = await bridge.executeRequest(
          request,
          workspace?.path ?? undefined,
          requestId,
        );
      } finally {
        // Always decrement, even on bridge error, so the cap doesn't
        // permanently lock new sends after a transient main-process glitch.
        const cur = inflightParallelSends.get(targetTabId) ?? 1;
        if (cur <= 1) inflightParallelSends.delete(targetTabId);
        else inflightParallelSends.set(targetTabId, cur - 1);
      }
      const finishedAt = Date.now();
      const durationMs = finishedAt - startedAt;

      // Drop the result if a later parallel send already wrote a response.
      const lastWritten = lastWrittenParallelToken.get(targetTabId) ?? 0;
      const winsResponsePanel = nextToken > lastWritten;
      if (winsResponsePanel) {
        lastWrittenParallelToken.set(targetTabId, nextToken);
      }

      mutateById(targetTabId, (t) => {
        const updated = updateBurst(t.parallelBursts, burstId, (entry) => ({
          ...entry,
          status: result.ok ? 'success' : 'error',
          durationMs,
          ...(result.ok ? { httpStatus: result.response.status } : {}),
          ...(result.ok ? {} : { errorMessage: result.error.message }),
        }));
        return {
          ...t,
          execution: winsResponsePanel
            ? result.ok
              ? {
                  status: 'success',
                  response: result.response,
                  error: null,
                  startedAt,
                  finishedAt,
                }
              : {
                  status: 'error',
                  response: null,
                  error: result.error,
                  startedAt,
                  finishedAt,
                }
            : t.execution,
          ...(updated !== undefined ? { parallelBursts: updated } : {}),
        };
      });
      void get().loadHistory();
    },

    clearParallelBursts: () => {
      const { activeTabId } = get();
      if (!activeTabId) return;
      mutateById(activeTabId, (t) => {
        if (!t.parallelBursts || t.parallelBursts.length === 0) return t;
        return { ...t, parallelBursts: [] };
      });
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

    // ------------------------------------------------------------------ //
    // Load test — per-tab state                                           //
    // ------------------------------------------------------------------ //

    updateLoadTestConfig: (tabId, patch) => {
      mutateById(tabId, (tab) => ({
        ...tab,
        loadTest: { ...tab.loadTest, config: { ...tab.loadTest.config, ...patch } },
      }));
    },

    setLoadTestRun: (tabId, update) => {
      mutateById(tabId, (tab) => ({
        ...tab,
        loadTest: { ...tab.loadTest, ...update },
      }));
    },

    resetLoadTestForStart: (tabId, runId) => {
      mutateById(tabId, (tab) => ({
        ...tab,
        loadTest: {
          // Preserve user config across runs.
          config: tab.loadTest.config,
          runId,
          progress: null,
          events: [],
          failedBodies: [],
          starting: true,
          startError: null,
        },
      }));
    },

    appendLoadEvent: (tabId, event) => {
      mutateById(tabId, (tab) => {
        const prev = tab.loadTest.events;
        const next = prev.length >= 500 ? [...prev.slice(-499), event] : [...prev, event];
        return { ...tab, loadTest: { ...tab.loadTest, events: next } };
      });
    },

    updateLoadProgress: (tabId, progress) => {
      mutateById(tabId, (tab) => ({
        ...tab,
        loadTest: { ...tab.loadTest, progress },
      }));
    },

    clearLoadTest: (tabId) => {
      mutateById(tabId, (tab) => ({
        ...tab,
        loadTest: { ...freshLoadTest(), config: tab.loadTest.config },
      }));
    },

    clearFailedBodies: (tabId) => {
      mutateById(tabId, (tab) => ({
        ...tab,
        loadTest: { ...tab.loadTest, failedBodies: [] },
      }));
    },

    handleLoadProgress: (p) => {
      // Find which tab owns this runId and dispatch to it.
      const { tabs } = get();
      const target = tabs.find((t) => t.loadTest.runId === p.runId);
      if (!target) return;
      get().updateLoadProgress(target.id, p);
      if (p.lastEvent) {
        get().appendLoadEvent(target.id, p.lastEvent);
      }
      if (p.lastFailedBodyEvent) {
        // Append to the ring buffer; cap at the configured limit.
        mutateById(target.id, (tab) => {
          const limit = tab.loadTest.config.failedBodyLimit;
          const prev = tab.loadTest.failedBodies;
          const next =
            prev.length >= limit
              ? [...prev.slice(-(limit - 1)), p.lastFailedBodyEvent!]
              : [...prev, p.lastFailedBodyEvent!];
          return { ...tab, loadTest: { ...tab.loadTest, failedBodies: next } };
        });
      }
    },

    // ------------------------------------------------------------------ //
    // WebSocket                                                           //
    // ------------------------------------------------------------------ //

    wsConnect: async (tabId, url) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab) return;

      // Initialize or reuse the WsTabState for this tab.
      const connectionId = tab.websocket?.connectionId ?? crypto.randomUUID();

      mutateById(tabId, (t) => ({
        ...t,
        websocket: {
          connectionId,
          url,
          state: 'CONNECTING',
          timeline: t.websocket?.timeline ?? [],
          sendDraft: t.websocket?.sendDraft ?? '',
          connecting: true,
          error: null,
        },
      }));

      try {
        await bridge.wsConnect(connectionId, url, {});
        mutateById(tabId, (t) => {
          if (t.websocket?.connectionId !== connectionId) return t;
          return {
            ...t,
            websocket: { ...t.websocket, state: 'OPEN', connecting: false },
          };
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        mutateById(tabId, (t) => {
          if (t.websocket?.connectionId !== connectionId) return t;
          return {
            ...t,
            websocket: { ...t.websocket, state: 'CLOSED', connecting: false, error: message },
          };
        });
      }
    },

    wsSend: async (tabId, data) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab?.websocket) return;
      const { connectionId } = tab.websocket;
      await bridge.wsSend(connectionId, data);
    },

    wsDisconnect: async (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (!tab?.websocket) return;
      const { connectionId } = tab.websocket;
      mutateById(tabId, (t) => {
        if (!t.websocket) return t;
        return { ...t, websocket: { ...t.websocket, state: 'CLOSING' } };
      });
      await bridge.wsDisconnect(connectionId);
    },

    wsSetUrl: (tabId, url) => {
      mutateById(tabId, (t) => {
        if (!t.websocket) {
          return {
            ...t,
            websocket: {
              connectionId: crypto.randomUUID(),
              url,
              state: 'CLOSED' as WsConnectionState,
              timeline: [],
              sendDraft: '',
              connecting: false,
              error: null,
            },
          };
        }
        return { ...t, websocket: { ...t.websocket, url } };
      });
    },

    wsSetSendDraft: (tabId, draft) => {
      mutateById(tabId, (t) => {
        if (!t.websocket) return t;
        return { ...t, websocket: { ...t.websocket, sendDraft: draft } };
      });
    },

    handleWsEvent: (event) => {
      const { connectionId, message } = event;
      const { tabs } = get();
      const target = tabs.find((t) => t.websocket?.connectionId === connectionId);
      if (!target) return;
      const tabId = target.id;
      mutateById(tabId, (t) => {
        if (!t.websocket) return t;
        const newTimeline = [...t.websocket.timeline, message];
        // Infer connection state from status messages.
        let state = t.websocket.state;
        if (message.direction === 'status') {
          if (message.data === 'OPEN') state = 'OPEN';
          else if (message.data.startsWith('CLOSED')) state = 'CLOSED';
          else if (message.data.startsWith('ERROR')) state = 'CLOSED';
        }
        return {
          ...t,
          websocket: {
            ...t.websocket,
            state,
            timeline: newTimeline,
            connecting: state === 'CONNECTING',
            error: message.direction === 'status' && message.data.startsWith('ERROR')
              ? message.data
              : t.websocket.error,
          },
        };
      });
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
      const newRelPath = await bridge.workspaceRename(workspace.path, relPath, newName);
      // If the renamed node is open as a file-backed tab, update its id /
      // relPath / display name in place so the tab strip stays in sync.
      // Mirrors the moveNode pattern; without this the tab keeps the old
      // name and tries to save against a path that no longer exists.
      const oldId = `file:${relPath}`;
      const newId = `file:${newRelPath}`;
      const tabs = get().tabs;
      if (tabs.some((t) => t.id === oldId)) {
        set({
          tabs: tabs.map((t) =>
            t.id === oldId
              ? {
                  ...t,
                  id: newId,
                  relPath: newRelPath,
                  name: newName,
                }
              : t,
          ),
          activeTabId:
            get().activeTabId === oldId ? newId : get().activeTabId,
        });
      }
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
          preRequestScript: '',
          postResponseScript: '',
        },
        dirty: false,
        execution,
        loadTest: freshLoadTest(),
    activePane: 'params',
        responseSearch: '',
        responseMode: null,
        sourceHistoryId: entry.id,
      };

      set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
    },

    // ------------------------------------------------------------------ //
    // Collection runner                                                    //
    // ------------------------------------------------------------------ //

    runner: {
      open: false,
      folderRelPath: '',
      mode: 'sequential',
      concurrency: 5,
      delayMs: 0,
      iterations: 1,
      csvContent: '',
      activeRunId: null,
      runs: new Map(),
    },

    openRunnerPanel: (folderRelPath) => {
      set((state) => ({
        runner: { ...state.runner, open: true, folderRelPath },
      }));
    },

    closeRunnerPanel: () => {
      set((state) => ({ runner: { ...state.runner, open: false } }));
    },

    updateRunnerConfig: (patch) => {
      set((state) => ({ runner: { ...state.runner, ...patch } }));
    },

    startRunner: async () => {
      const { runner, workspace, root } = get();
      if (!workspace || !root) return;

      // Collect requests in the target folder.
      const collectRequests = (
        nodes: import('@scrapeman/shared-types').CollectionNode[],
        folderRelPath: string,
      ): Array<{ request: ScrapemanRequest; name: string }> => {
        // We can't read file content here — we build minimal stubs from tree
        // nodes. The main process resolves variables; the runner reads the
        // actual request from disk via the workspace manager.
        // We pass the ScrapemanRequest structures from the tree nodes through
        // IPC. Since we don't have the full bodies in the tree, the runner
        // will need them. We read each request file here.
        return [];
      };
      void collectRequests; // will be used below

      // Gather request objects from open tabs or by reading from disk.
      // We read each request from the workspace to get full details.
      const gatherRequests = async (
        folderRelPath: string,
      ): Promise<Array<{ request: ScrapemanRequest; name: string }>> => {
        // Walk the collection tree to find all requests in the folder.
        const findRequests = (
          nodes: import('@scrapeman/shared-types').CollectionNode[],
          inFolder: string,
        ): Array<{ relPath: string; name: string }> => {
          const out: Array<{ relPath: string; name: string }> = [];
          for (const node of nodes) {
            if (node.kind === 'folder') {
              // Include requests from subfolders of the target.
              const isTarget =
                inFolder === '' ||
                node.relPath === inFolder ||
                node.relPath.startsWith(`${inFolder}/`);
              if (isTarget || inFolder === '') {
                out.push(...findRequests(node.children, inFolder));
              }
            } else if (node.kind === 'request') {
              const parentFolder = node.relPath.includes('/')
                ? node.relPath.slice(0, node.relPath.lastIndexOf('/'))
                : '';
              const inTarget =
                inFolder === '' ||
                parentFolder === inFolder ||
                parentFolder.startsWith(`${inFolder}/`);
              if (inTarget) {
                out.push({ relPath: node.relPath, name: node.name });
              }
            }
          }
          return out;
        };

        const found = findRequests(root.children, folderRelPath);
        const requests = await Promise.all(
          found.map(async ({ relPath, name }) => {
            const req = await bridge.workspaceReadRequest(workspace.path, relPath);
            return { request: req, name };
          }),
        );
        return requests;
      };

      const requests = await gatherRequests(runner.folderRelPath);
      if (requests.length === 0) return;

      const runId = crypto.randomUUID();
      const newRun: RunnerRunState = {
        runId,
        folderRelPath: runner.folderRelPath,
        mode: runner.mode,
        concurrency: runner.concurrency,
        delayMs: runner.delayMs,
        iterations: runner.csvContent.trim()
          ? 0 // will be determined by CSV row count
          : runner.iterations,
        running: true,
        aborted: false,
        results: [],
        totalRequests: requests.length,
        totalIterations: runner.iterations,
        completedRequests: 0,
        succeeded: 0,
        failed: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      };

      set((state) => {
        const runs = new Map(state.runner.runs);
        runs.set(runId, newRun);
        return {
          runner: { ...state.runner, activeRunId: runId, runs },
        };
      });

      try {
        await bridge.runnerStart({
          runId,
          requests: requests.map(({ request, name }) => ({ request, name })),
          mode: runner.mode,
          ...(runner.concurrency !== 5 ? { concurrency: runner.concurrency } : {}),
          ...(runner.delayMs > 0 ? { delayMs: runner.delayMs } : {}),
          ...(runner.csvContent.trim()
            ? { csvContent: runner.csvContent }
            : { iterations: runner.iterations }),
          workspacePath: workspace.path,
        });
      } catch (err) {
        set((state) => {
          const runs = new Map(state.runner.runs);
          const run = runs.get(runId);
          if (run) {
            runs.set(runId, {
              ...run,
              running: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          return { runner: { ...state.runner, runs } };
        });
      }
    },

    stopRunner: async () => {
      const { runner } = get();
      if (!runner.activeRunId) return;
      await bridge.runnerStop(runner.activeRunId);
    },

    handleRunnerEvent: (event) => {
      const { runId } = event;
      set((state) => {
        const runs = new Map(state.runner.runs);
        const run = runs.get(runId);
        if (!run) return {};

        if (event.kind === 'start') {
          runs.set(runId, {
            ...run,
            totalRequests: event.totalRequests,
            totalIterations: event.totalIterations,
          });
        } else if (event.kind === 'request-complete') {
          const result: RunnerRequestResult = {
            iteration: event.iteration,
            requestIndex: event.requestIndex,
            requestName: event.requestName,
            url: '',
            method: '',
            status: event.status,
            durationMs: event.durationMs,
            ok: event.status >= 200 && event.status < 400,
            bodyPreview: event.bodyPreview,
            responseHeaders: event.responseHeaders,
            startedAt: new Date().toISOString(),
          };
          runs.set(runId, {
            ...run,
            results: [...run.results, result],
            completedRequests: run.completedRequests + 1,
            succeeded: run.succeeded + (result.ok ? 1 : 0),
          });
        } else if (event.kind === 'request-failed') {
          const result: RunnerRequestResult = {
            iteration: event.iteration,
            requestIndex: event.requestIndex,
            requestName: event.requestName,
            url: '',
            method: '',
            status: 0,
            durationMs: event.durationMs,
            ok: false,
            bodyPreview: '',
            responseHeaders: [],
            errorKind: event.errorKind,
            errorMessage: event.errorMessage,
            startedAt: new Date().toISOString(),
          };
          runs.set(runId, {
            ...run,
            results: [...run.results, result],
            completedRequests: run.completedRequests + 1,
            failed: run.failed + 1,
          });
        } else if (event.kind === 'done') {
          runs.set(runId, {
            ...run,
            running: false,
            finishedAt: new Date().toISOString(),
          });
        } else if (event.kind === 'aborted') {
          runs.set(runId, {
            ...run,
            running: false,
            aborted: true,
            finishedAt: new Date().toISOString(),
          });
        }

        return { runner: { ...state.runner, runs } };
      });
    },

    exportRunnerReport: async (format) => {
      const { runner } = get();
      const runId = runner.activeRunId;
      if (!runId) return;
      await bridge.runnerExportReport(runId, format);
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

    gitPull: async (strategy) => {
      const workspace = get().workspace;
      if (!workspace) return {};
      set({ gitBusy: true, gitError: null });
      let actionError: string | null = null;
      let diverged = false;
      try {
        const res = await bridge.gitPull(workspace.path, strategy);
        if (!res.ok) {
          if (res.diverged) {
            diverged = true;
          } else {
            actionError = res.message ?? 'git pull failed';
          }
        }
      } catch (err) {
        actionError = err instanceof Error ? err.message : String(err);
      }
      await get().loadGitStatus();
      set({ gitBusy: false, gitError: actionError });
      return diverged ? { diverged: true } : {};
    },

    loadHiddenRequests: async () => {
      const workspace = get().workspace;
      if (!workspace) {
        set({ hiddenRequests: new Set<string>() });
        return;
      }
      try {
        const list = await bridge.gitLocalHiddenList(workspace.path);
        set({ hiddenRequests: new Set(list) });
      } catch {
        set({ hiddenRequests: new Set<string>() });
      }
    },

    toggleHiddenRequest: async (relPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return;
      const current = get().hiddenRequests;
      try {
        if (current.has(relPath)) {
          await bridge.gitLocalUnhide(workspace.path, relPath);
        } else {
          await bridge.gitLocalHide(workspace.path, relPath);
        }
        await get().loadHiddenRequests();
        await get().loadGitStatus();
      } catch (err) {
        set({ gitError: err instanceof Error ? err.message : String(err) });
      }
    },

    loadGlobals: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        const globals = await bridge.globalsRead(workspace.path);
        set({ globals });
      } catch (err) {
        console.error('[scrapeman] loadGlobals failed:', err);
      }
    },

    saveGlobals: async (globals: GlobalVariables) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.globalsWrite(workspace.path, globals);
      set({ globals });
    },

    loadCollectionSettings: async () => {
      const workspace = get().workspace;
      if (!workspace) return;
      try {
        const collectionSettings = await bridge.collectionSettingsRead(workspace.path);
        set({ collectionSettings });
      } catch (err) {
        console.error('[scrapeman] loadCollectionSettings failed:', err);
      }
    },

    saveCollectionSettings: async (settings: CollectionSettings) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.collectionSettingsWrite(workspace.path, settings);
      set({ collectionSettings: settings });
    },

    loadFolderSettings: async (folderRelPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return { variables: [] };
      try {
        const settings = await bridge.folderSettingsRead(
          workspace.path,
          folderRelPath,
        );
        set((state) => ({
          folderSettingsCache: {
            ...state.folderSettingsCache,
            [folderRelPath]: settings,
          },
        }));
        return settings;
      } catch (err) {
        console.error('[scrapeman] loadFolderSettings failed:', err);
        return { variables: [] };
      }
    },

    saveFolderSettings: async (
      folderRelPath: string,
      settings: FolderSettings,
    ) => {
      const workspace = get().workspace;
      if (!workspace) return;
      await bridge.folderSettingsWrite(workspace.path, folderRelPath, settings);
      set((state) => ({
        folderSettingsCache: {
          ...state.folderSettingsCache,
          [folderRelPath]: settings,
        },
      }));
    },

    resolveInheritedAuth: async (requestRelPath: string) => {
      const workspace = get().workspace;
      if (!workspace) return null;
      return bridge.resolveInheritedAuth(workspace.path, requestRelPath);
    },
  };
});

export type { Environment, EnvironmentVariable };

// Derived selector: true when any top-level modal is blocking the UI.
// Starts with screenshot; extend as more modals are promoted to global state.
export const selectIsModalOpen = (s: AppState): boolean => s.screenshotUrl !== null;

// Persist the active workspace's tab snapshot to localStorage on every
// change so unsaved tabs survive an app restart (#71). Coalesces rapid
// edits into a single write per animation frame; localStorage is
// synchronous, so writing on every keystroke would be wasteful.
let scheduledSnapshotWrite: number | null = null;
let lastPersistedTabsRef: Tab[] | null = null;
let lastPersistedActiveTabId: string | null = null;
let lastPersistedActiveEnv: string | null = null;
let lastPersistedSidebarView: 'files' | 'git' = 'files';

useAppStore.subscribe((state) => {
  const ws = state.workspace;
  if (!ws) return;
  // Bail early when nothing snapshot-relevant changed. References stay
  // stable when other fields mutate, so this skips most updates.
  if (
    state.tabs === lastPersistedTabsRef &&
    state.activeTabId === lastPersistedActiveTabId &&
    state.activeEnvironment === lastPersistedActiveEnv &&
    state.sidebarView === lastPersistedSidebarView
  ) {
    return;
  }
  lastPersistedTabsRef = state.tabs;
  lastPersistedActiveTabId = state.activeTabId;
  lastPersistedActiveEnv = state.activeEnvironment;
  lastPersistedSidebarView = state.sidebarView;

  if (scheduledSnapshotWrite !== null) return;
  const flush = (): void => {
    scheduledSnapshotWrite = null;
    const live = useAppStore.getState();
    if (!live.workspace) return;
    persistWorkspaceSnapshot(
      live.workspace.path,
      captureWorkspaceSnapshot({
        tabs: live.tabs,
        activeTabId: live.activeTabId,
        activeEnvironment: live.activeEnvironment,
        sidebarView: live.sidebarView,
      }),
    );
  };
  // requestAnimationFrame coalesces rapid edits into one write per frame.
  // In the test runtime (no DOM, no RAF) fall back to a microtask so the
  // subscriber doesn't throw and the test can still assert against the
  // localStorage write after a `flushPromises()`.
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    scheduledSnapshotWrite = window.requestAnimationFrame(flush);
  } else {
    scheduledSnapshotWrite = 1;
    queueMicrotask(flush);
  }
});
