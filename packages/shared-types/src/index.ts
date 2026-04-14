// Public types shared across @scrapeman packages.
// Keep this file dependency-free so both Node and renderer can consume it.

export const FORMAT_VERSION = '1.0' as const;

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
  scrapeman: typeof FORMAT_VERSION;
  meta: RequestMeta;
  method: HttpMethod;
  url: string;
  params?: KeyValue;
  headers?: KeyValue;
  auth?: AuthConfig;
  body?: BodyConfig;
  proxy?: ProxyConfig;
  scrapeDo?: ScrapeDoConfig;
  options?: RequestOptions;
  disabledAutoHeaders?: string[];
}

export interface ResponseTimings {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  ttfbMs?: number;
  downloadMs?: number;
  totalMs: number;
}

export interface ExecutedResponse {
  status: number;
  statusText: string;
  httpVersion: 'http/1.1' | 'http/2' | string;
  headers: Array<[string, string]>;
  // Body as base64-encoded bytes — IPC-safe, preserves binary content.
  bodyBase64: string;
  bodyTruncated: boolean;
  sizeBytes: number;
  contentType?: string;
  timings: ResponseTimings;
  sentAt: string;
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

export type CodegenTarget = 'curl' | 'fetch' | 'python' | 'go';

export interface CodegenInput {
  target: CodegenTarget;
  request: ScrapemanRequest;
  inlineVariables: boolean;
  workspacePath?: string;
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
  importCurl: (input: string) => Promise<ImportCurlResult>;
  generateCode: (input: CodegenInput) => Promise<string>;

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
  workspaceWriteRequest: (
    workspacePath: string,
    relPath: string,
    request: ScrapemanRequest,
  ) => Promise<void>;
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
}
