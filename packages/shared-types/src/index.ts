// Public types shared across @scrapeman packages.
// Keep this file dependency-free so both Node and renderer can consume it.

// Writer version. New files (`.sman`) are tagged with this. Older `.req.yaml`
// files tagged `1.0` remain readable — see FORMAT_VERSION_ACCEPTED.
export const FORMAT_VERSION = '2.0' as const;

// Versions the parser accepts. `1.0` is legacy `.req.yaml` from pre-`.sman`
// workspaces; `2.0` is the current `.sman` format. Both are structurally
// identical YAML — the version bump accompanies the extension rename so git
// history can tell them apart.
export const FORMAT_VERSION_ACCEPTED = ['1.0', '2.0'] as const;
export type AcceptedFormatVersion = (typeof FORMAT_VERSION_ACCEPTED)[number];

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | (string & {});

export type HttpVersion = 'auto' | 'http1' | 'http2';

export interface RequestMeta {
  name: string;
  description?: string;
  tags?: string[];
}

export type KeyValue = Record<string, string>;

export type AuthConfig =
  | { type: 'none' }
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; key: string; value: string; in: 'header' | 'query' }
  | {
      type: 'oauth2';
      flow: 'clientCredentials' | 'authorizationCode';
      tokenUrl: string;
      authUrl?: string;
      clientId: string;
      clientSecret: string;
      scope?: string;
      audience?: string;
      usePkce?: boolean;
    }
  | {
      type: 'awsSigV4';
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
      region: string;
      service: string;
    };

export type BodyConfig =
  | { type: 'none' }
  | {
      type: 'json' | 'xml' | 'text' | 'html' | 'javascript';
      content?: string;
      file?: string;
      forceSidecar?: boolean;
    }
  | { type: 'formUrlEncoded'; fields: KeyValue }
  | {
      type: 'multipart';
      parts: MultipartPart[];
    }
  | { type: 'binary'; file: string };

export type MultipartPart =
  | { name: string; type: 'text'; value: string }
  | { name: string; type: 'file'; file: string; contentType?: string };

export interface ProxyConfig {
  enabled: boolean;
  url: string;
  auth?: { username: string; password: string };
  bypass?: string[];
}

export interface ScrapeDoConfig {
  enabled: boolean;
  token: string;
  render?: boolean;
  super?: boolean;
  geoCode?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  customHeaders?: boolean;
}

export interface RequestOptions {
  timeout?: {
    connect?: number;
    read?: number;
    total?: number;
  };
  redirect?: {
    follow: boolean;
    maxCount?: number;
  };
  tls?: {
    ignoreInvalidCerts?: boolean;
    caFile?: string;
  };
  httpVersion?: HttpVersion;
}

export interface ScrapemanRequest {
  // Accepts any version the parser understands; writers always emit
  // FORMAT_VERSION. Kept wide so a request read from a `.req.yaml` file
  // (version `1.0`) typechecks before normalization.
  scrapeman: AcceptedFormatVersion;
  meta: RequestMeta;
  method: HttpMethod;
  url: string;
  params?: KeyValue;
  /** Keys of params that should not be included in the request URL. */
  disabledParams?: string[];
  headers?: KeyValue;
  auth?: AuthConfig;
  body?: BodyConfig;
  proxy?: ProxyConfig;
  scrapeDo?: ScrapeDoConfig;
  options?: RequestOptions;
  disabledAutoHeaders?: string[];
}

/**
 * A single row in the auto-headers preview shown by the UI's Headers panel.
 * T3B0 emits only `auto` and `user` sources; `overrides` field is deferred
 * to T3B1 when the renderer gains the edit affordance.
 */
export interface AutoHeaderPreviewRow {
  key: string;
  value: string;
  source: 'auto' | 'user';
  disabled: boolean;
}

export interface AutoHeadersPreview {
  rows: AutoHeaderPreviewRow[];
}

export interface ResponseTimings {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  ttfbMs?: number;
  downloadMs?: number;
  totalMs: number;
}

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
  parsedData?: unknown;
  retry?: number;
}

export interface ExecutedResponse {
  status: number;
  statusText: string;
  httpVersion: 'http/1.1' | 'http/2' | string;
  headers: Array<[string, string]>;
  // Body as base64-encoded bytes — IPC-safe, preserves binary content.
  // Capped at the UI body limit (see T3W1 / BODY_UI_LIMIT in the executor).
  // When the full body exceeds the limit this is the first N bytes only and
  // `bodyTruncated` is true; the full body stays in the main-process cache
  // and must be retrieved via the `response:fullBody` channel.
  bodyBase64: string;
  bodyTruncated: boolean;
  // Decoded size of the FULL body as received from the server (not the size
  // of the UI-truncated slice). This is the correct value for the "Size"
  // metric in the UI.
  sizeBytes: number;
  contentType?: string;
  timings: ResponseTimings;
  sentAt: string;
  // Correlation id assigned by the caller (renderer). Used as the key for
  // `response:fullBody` / `response:saveToFile` to retrieve the untruncated
  // body that lives only in the main process.
  requestId?: string;
  // Full decoded response body. ONLY populated inside the main process — it
  // is stripped before the response crosses the IPC boundary because a raw
  // Uint8Array over IPC is expensive and size-unsafe. Script sandboxes that
  // run in-process can read it directly.
  fullBodyBytes?: Uint8Array;
  // Populated only when the response was `text/event-stream`. The stream
  // is consumed exactly once; this array is shared between UI and scripts.
  sseEvents?: SseEvent[];
}

export type ExecutorErrorKind =
  | 'network'
  | 'timeout'
  | 'tls'
  | 'protocol'
  | 'aborted'
  | 'invalid-request'
  | 'unknown';

export interface SerializedExecutorError {
  kind: ExecutorErrorKind;
  message: string;
}

export type ExecuteResult =
  | { ok: true; response: ExecutedResponse }
  | { ok: false; error: SerializedExecutorError };

export interface CollectionFolderNode {
  kind: 'folder';
  id: string;
  name: string;
  relPath: string;
  children: CollectionNode[];
}

export interface CollectionRequestNode {
  kind: 'request';
  id: string;
  name: string;
  relPath: string;
  method: HttpMethod;
}

export type CollectionNode = CollectionFolderNode | CollectionRequestNode;

export interface WorkspaceInfo {
  path: string;
  name: string;
}

export interface WorkspaceTree {
  workspace: WorkspaceInfo;
  root: CollectionFolderNode;
}

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export type WorkspaceEvent =
  | { type: 'tree-changed'; workspacePath: string }
  | { type: 'file-changed'; workspacePath: string; relPath: string }
  | { type: 'environments-changed'; workspacePath: string };

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface Environment {
  name: string;
  variables: EnvironmentVariable[];
}

export interface WorkspaceState {
  activeEnvironment: string | null;
}

export interface HistoryEntry {
  id: string;
  sentAt: string;
  workspacePath: string;
  environmentName: string | null;
  method: HttpMethod;
  url: string;
  headers: KeyValue;
  bodyPreview: string;
  bodyTruncated: boolean;
  status: number;
  statusOk: boolean;
  responseHeaders: Array<[string, string]>;
  responseBodyPreview: string;
  responseBodyTruncated: boolean;
  responseSizeBytes: number;
  durationMs: number;
  protocol: string;
  error?: SerializedExecutorError;
}

export interface HistoryListOptions {
  limit?: number;
  before?: string;
  search?: string;
}

export interface CookieEntry {
  domain: string;
  path: string;
  name: string;
  value: string;
  expires: string | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none' | null;
}

export interface LoadValidator {
  expectStatus?: number[];
  expectBodyContains?: string;
}

export interface LoadRunStartInput {
  request: ScrapemanRequest;
  workspacePath?: string;
  total: number;
  concurrency: number;
  perIterDelayMs?: number;
  validator: LoadValidator;
  /** Client-generated runId. When provided the main process uses it instead of
   *  generating a new one, eliminating the race where load:progress events arrive
   *  before the Promise resolves and the store has stored the runId. */
  runId?: string;
}

export interface LoadEvent {
  iteration: number;
  status: number;
  durationMs: number;
  valid: boolean;
  errorKind?: string;
  errorMessage?: string;
}

export interface LoadProgress {
  runId: string;
  sent: number;
  succeeded: number;
  failed: number;
  validationFailures: number;
  inflight: number;
  currentRps: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyMin: number;
  latencyMax: number;
  statusHistogram: Record<string, number>;
  errorKinds: Record<string, number>;
  elapsedMs: number;
  totalTarget: number;
  lastEvent: LoadEvent | null;
  done: boolean;
}

export type ImportCurlResult =
  | { ok: true; request: ScrapemanRequest }
  | { ok: false; message: string };

export interface ImportFolder {
  name: string;
  requests: ScrapemanRequest[];
  folders: ImportFolder[];
}

export interface ImportResult {
  requests: ScrapemanRequest[];
  folders: ImportFolder[];
  environments: Environment[];
  warnings: string[];
}

export type CodegenTarget = 'curl' | 'fetch' | 'python' | 'go';

export type GitFileChangeStatus =
  | 'untracked'
  | 'modified'
  | 'deleted'
  | 'added'
  | 'renamed';

export interface GitFileChange {
  path: string;
  status: GitFileChangeStatus;
  staged: boolean;
  originalPath?: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
}

export interface GitOpResult {
  ok: boolean;
  message?: string;
  /** True when pull failed because branches have diverged (ff-only mode only). */
  diverged?: boolean;
}

export type GitPullStrategy = 'ff-only' | 'rebase' | 'merge';

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  // Unix timestamp in seconds (author date).
  date: number;
}

export interface CodegenInput {
  target: CodegenTarget;
  request: ScrapemanRequest;
  inlineVariables: boolean;
  workspacePath?: string;
}

export interface UpdateInfo {
  version: string;
  tagName: string;
  releaseUrl: string;
  publishedAt: string;
  notes?: string;
}

// IPC bridge contract — source of truth for preload + main + renderer.
export interface ScrapemanBridge {
  ping: () => Promise<'pong'>;
  executeRequest: (
    request: ScrapemanRequest,
    workspacePath: string | undefined,
    requestId: string,
  ) => Promise<ExecuteResult>;
  cancelRequest: (requestId: string) => Promise<void>;
  saveResponse: (
    bodyBase64: string,
    suggestedName: string,
  ) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
  // Fetch the full (untruncated) response body for a previously executed
  // request. Only the last N bodies are retained in the main-process cache,
  // so this can return null if the entry was evicted. See T3W1.
  responseFullBody: (
    requestId: string,
  ) => Promise<{ bodyBase64: string; sizeBytes: number } | null>;
  // Write the full response body to disk without round-tripping bytes
  // through the renderer. Useful for large binary downloads.
  responseSaveToFile: (
    requestId: string,
    filePath: string,
  ) => Promise<{ bytesWritten: number }>;
  importCurl: (input: string) => Promise<ImportCurlResult>;
  generateCode: (input: CodegenInput) => Promise<string>;
  previewHeaders: (request: ScrapemanRequest) => Promise<AutoHeadersPreview>;

  loadStart: (input: LoadRunStartInput) => Promise<string>;
  loadStop: (runId: string) => Promise<void>;
  onLoadProgress: (handler: (progress: LoadProgress) => void) => () => void;

  // Workspace operations
  workspacePickDir: () => Promise<string | null>;
  workspaceOpen: (path: string) => Promise<WorkspaceTree>;
  workspaceList: () => Promise<RecentWorkspace[]>;
  workspaceReadRequest: (
    workspacePath: string,
    relPath: string,
  ) => Promise<ScrapemanRequest>;
  // Returns the final relPath the request was written to. When the input
  // path ends with `.req.yaml`, the file is migrated to `.sman` on write;
  // callers must use the returned path to update tab state.
  workspaceWriteRequest: (
    workspacePath: string,
    relPath: string,
    request: ScrapemanRequest,
  ) => Promise<string>;
  workspaceCreateFolder: (
    workspacePath: string,
    parentRelPath: string,
    name: string,
  ) => Promise<string>;
  workspaceCreateRequest: (
    workspacePath: string,
    parentRelPath: string,
    name: string,
  ) => Promise<string>;
  workspaceRename: (
    workspacePath: string,
    relPath: string,
    newName: string,
  ) => Promise<string>;
  workspaceDelete: (workspacePath: string, relPath: string) => Promise<void>;
  workspaceMove: (
    workspacePath: string,
    relPath: string,
    newParentRelPath: string,
  ) => Promise<string>;

  // Environments
  // History
  historyList: (
    workspacePath: string,
    options?: HistoryListOptions,
  ) => Promise<HistoryEntry[]>;
  historyDelete: (workspacePath: string, id: string) => Promise<void>;
  historyClear: (workspacePath: string) => Promise<void>;
  historyStats: (
    workspacePath: string,
  ) => Promise<{ count: number; diskBytes: number; path: string }>;
  historyClearAll: () => Promise<void>;
  openInShell: (path: string) => Promise<void>;

  // Cookies
  cookieList: (workspacePath: string) => Promise<CookieEntry[]>;
  cookieDelete: (
    workspacePath: string,
    domain: string,
    path: string,
    name: string,
  ) => Promise<void>;
  cookieClearDomain: (workspacePath: string, domain: string) => Promise<void>;
  cookieClearAll: (workspacePath: string) => Promise<void>;

  envList: (workspacePath: string) => Promise<Environment[]>;
  envRead: (workspacePath: string, name: string) => Promise<Environment | null>;
  envWrite: (workspacePath: string, env: Environment) => Promise<void>;
  envDelete: (workspacePath: string, name: string) => Promise<void>;
  envGetActive: (workspacePath: string) => Promise<string | null>;
  envSetActive: (workspacePath: string, name: string | null) => Promise<void>;

  onWorkspaceEvent: (handler: (event: WorkspaceEvent) => void) => () => void;

  // Git
  gitIsRepo: (workspacePath: string) => Promise<boolean>;
  gitLog: (workspacePath: string, limit?: number) => Promise<GitCommit[]>;
  gitStatus: (workspacePath: string) => Promise<GitStatus>;
  gitDiff: (
    workspacePath: string,
    relPath: string,
    options: { staged: boolean },
  ) => Promise<string>;
  gitStage: (workspacePath: string, relPath: string) => Promise<void>;
  gitStageAll: (workspacePath: string) => Promise<void>;
  gitUnstage: (workspacePath: string, relPath: string) => Promise<void>;
  gitUnstageAll: (workspacePath: string) => Promise<void>;
  gitDiscard: (workspacePath: string, relPath: string) => Promise<void>;
  gitCommit: (workspacePath: string, message: string) => Promise<void>;
  gitPush: (workspacePath: string) => Promise<GitOpResult>;
  gitPull: (workspacePath: string, strategy?: GitPullStrategy) => Promise<GitOpResult>;
  gitLocalHiddenList: (workspacePath: string) => Promise<string[]>;
  gitLocalHide: (workspacePath: string, relPath: string) => Promise<void>;
  gitLocalUnhide: (workspacePath: string, relPath: string) => Promise<void>;

  // Auto-update
  onUpdateAvailable: (handler: (info: UpdateInfo) => void) => () => void;
  dismissUpdate: (version: string) => void;
  openReleasePage: (url: string) => void;
}
