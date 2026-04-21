import { contextBridge, ipcRenderer } from 'electron';
import type {
  AutoHeadersPreview,
  CodegenInput,
  CookieEntry,
  Environment,
  ExecuteResult,
  GitCommit,
  GitOpResult,
  GitPullStrategy,
  GitStatus,
  HistoryEntry,
  HistoryListOptions,
  ImportCurlResult,
  LoadProgress,
  LoadRunStartInput,
  RecentWorkspace,
  ScrapemanBridge,
  ScrapemanRequest,
  UpdateInfo,
  WorkspaceEvent,
  WorkspaceTree,
} from '@scrapeman/shared-types';

const api: ScrapemanBridge = {
  ping: () => ipcRenderer.invoke('app:ping') as Promise<'pong'>,
  executeRequest: (
    request: ScrapemanRequest,
    workspacePath: string | undefined,
    requestId: string,
  ) =>
    ipcRenderer.invoke(
      'request:execute',
      request,
      workspacePath ?? null,
      requestId,
    ) as Promise<ExecuteResult>,
  cancelRequest: (requestId: string) =>
    ipcRenderer.invoke('request:cancel', requestId) as Promise<void>,
  saveResponse: (bodyBase64: string, suggestedName: string) =>
    ipcRenderer.invoke(
      'response:save',
      bodyBase64,
      suggestedName,
    ) as Promise<{ ok: boolean; path?: string; canceled?: boolean }>,
  responseFullBody: (requestId: string) =>
    ipcRenderer.invoke(
      'response:fullBody',
      requestId,
    ) as Promise<{ bodyBase64: string; sizeBytes: number } | null>,
  responseSaveToFile: (requestId: string, filePath: string) =>
    ipcRenderer.invoke(
      'response:saveToFile',
      requestId,
      filePath,
    ) as Promise<{ bytesWritten: number }>,
  importCurl: (input: string) =>
    ipcRenderer.invoke('curl:import', input) as Promise<ImportCurlResult>,
  generateCode: (input: CodegenInput) =>
    ipcRenderer.invoke('codegen:generate', input) as Promise<string>,
  previewHeaders: (request: ScrapemanRequest) =>
    ipcRenderer.invoke('headers:preview', request) as Promise<AutoHeadersPreview>,

  loadStart: (input: LoadRunStartInput) =>
    ipcRenderer.invoke('load:start', input) as Promise<string>,
  loadStop: (runId: string) =>
    ipcRenderer.invoke('load:stop', runId) as Promise<void>,
  onLoadProgress: (handler: (progress: LoadProgress) => void) => {
    const listener = (_event: unknown, payload: LoadProgress): void =>
      handler(payload);
    ipcRenderer.on('load:progress', listener);
    return () => ipcRenderer.off('load:progress', listener);
  },

  workspacePickDir: () =>
    ipcRenderer.invoke('workspace:pickDir') as Promise<string | null>,
  workspaceOpen: (path: string) =>
    ipcRenderer.invoke('workspace:open', path) as Promise<WorkspaceTree>,
  workspaceList: () =>
    ipcRenderer.invoke('workspace:list') as Promise<RecentWorkspace[]>,
  workspaceReadRequest: (workspacePath: string, relPath: string) =>
    ipcRenderer.invoke(
      'workspace:readRequest',
      workspacePath,
      relPath,
    ) as Promise<ScrapemanRequest>,
  workspaceWriteRequest: (
    workspacePath: string,
    relPath: string,
    request: ScrapemanRequest,
  ) =>
    ipcRenderer.invoke(
      'workspace:writeRequest',
      workspacePath,
      relPath,
      request,
    ) as Promise<string>,
  workspaceCreateFolder: (workspacePath: string, parent: string, name: string) =>
    ipcRenderer.invoke(
      'workspace:createFolder',
      workspacePath,
      parent,
      name,
    ) as Promise<string>,
  workspaceCreateRequest: (workspacePath: string, parent: string, name: string) =>
    ipcRenderer.invoke(
      'workspace:createRequest',
      workspacePath,
      parent,
      name,
    ) as Promise<string>,
  workspaceRename: (workspacePath: string, relPath: string, newName: string) =>
    ipcRenderer.invoke(
      'workspace:rename',
      workspacePath,
      relPath,
      newName,
    ) as Promise<string>,
  workspaceDelete: (workspacePath: string, relPath: string) =>
    ipcRenderer.invoke(
      'workspace:delete',
      workspacePath,
      relPath,
    ) as Promise<void>,
  workspaceMove: (workspacePath: string, relPath: string, newParent: string) =>
    ipcRenderer.invoke(
      'workspace:move',
      workspacePath,
      relPath,
      newParent,
    ) as Promise<string>,

  historyList: (workspacePath: string, options?: HistoryListOptions) =>
    ipcRenderer.invoke(
      'history:list',
      workspacePath,
      options,
    ) as Promise<HistoryEntry[]>,
  historyDelete: (workspacePath: string, id: string) =>
    ipcRenderer.invoke('history:delete', workspacePath, id) as Promise<void>,
  historyClear: (workspacePath: string) =>
    ipcRenderer.invoke('history:clear', workspacePath) as Promise<void>,
  historyStats: (workspacePath: string) =>
    ipcRenderer.invoke('history:stats', workspacePath) as Promise<{
      count: number;
      diskBytes: number;
      path: string;
    }>,
  historyClearAll: () =>
    ipcRenderer.invoke('history:clearAll') as Promise<void>,
  openInShell: (path: string) =>
    ipcRenderer.invoke('app:openInShell', path) as Promise<void>,

  cookieList: (workspacePath: string) =>
    ipcRenderer.invoke('cookies:list', workspacePath) as Promise<CookieEntry[]>,
  cookieDelete: (workspacePath: string, domain: string, path: string, name: string) =>
    ipcRenderer.invoke(
      'cookies:delete',
      workspacePath,
      domain,
      path,
      name,
    ) as Promise<void>,
  cookieClearDomain: (workspacePath: string, domain: string) =>
    ipcRenderer.invoke('cookies:clearDomain', workspacePath, domain) as Promise<void>,
  cookieClearAll: (workspacePath: string) =>
    ipcRenderer.invoke('cookies:clearAll', workspacePath) as Promise<void>,

  envList: (workspacePath: string) =>
    ipcRenderer.invoke('env:list', workspacePath) as Promise<Environment[]>,
  envRead: (workspacePath: string, name: string) =>
    ipcRenderer.invoke('env:read', workspacePath, name) as Promise<Environment | null>,
  envWrite: (workspacePath: string, env: Environment) =>
    ipcRenderer.invoke('env:write', workspacePath, env) as Promise<void>,
  envDelete: (workspacePath: string, name: string) =>
    ipcRenderer.invoke('env:delete', workspacePath, name) as Promise<void>,
  envGetActive: (workspacePath: string) =>
    ipcRenderer.invoke('env:getActive', workspacePath) as Promise<string | null>,
  envSetActive: (workspacePath: string, name: string | null) =>
    ipcRenderer.invoke('env:setActive', workspacePath, name) as Promise<void>,

  onWorkspaceEvent: (handler: (event: WorkspaceEvent) => void) => {
    const listener = (_event: unknown, payload: WorkspaceEvent): void => handler(payload);
    ipcRenderer.on('workspace:event', listener);
    return () => ipcRenderer.off('workspace:event', listener);
  },

  gitIsRepo: (workspacePath: string) =>
    ipcRenderer.invoke('git:isRepo', workspacePath) as Promise<boolean>,
  gitLog: (workspacePath: string, limit?: number) =>
    ipcRenderer.invoke('git:log', workspacePath, limit) as Promise<GitCommit[]>,
  gitStatus: (workspacePath: string) =>
    ipcRenderer.invoke('git:status', workspacePath) as Promise<GitStatus>,
  gitDiff: (
    workspacePath: string,
    relPath: string,
    options: { staged: boolean },
  ) =>
    ipcRenderer.invoke(
      'git:diff',
      workspacePath,
      relPath,
      options,
    ) as Promise<string>,
  gitStage: (workspacePath: string, relPath: string) =>
    ipcRenderer.invoke('git:stage', workspacePath, relPath) as Promise<void>,
  gitStageAll: (workspacePath: string) =>
    ipcRenderer.invoke('git:stageAll', workspacePath) as Promise<void>,
  gitUnstage: (workspacePath: string, relPath: string) =>
    ipcRenderer.invoke('git:unstage', workspacePath, relPath) as Promise<void>,
  gitUnstageAll: (workspacePath: string) =>
    ipcRenderer.invoke('git:unstageAll', workspacePath) as Promise<void>,
  gitDiscard: (workspacePath: string, relPath: string) =>
    ipcRenderer.invoke('git:discard', workspacePath, relPath) as Promise<void>,
  gitCommit: (workspacePath: string, message: string) =>
    ipcRenderer.invoke('git:commit', workspacePath, message) as Promise<void>,
  gitPush: (workspacePath: string) =>
    ipcRenderer.invoke('git:push', workspacePath) as Promise<GitOpResult>,
  gitPull: (workspacePath: string, strategy?: GitPullStrategy) =>
    ipcRenderer.invoke('git:pull', workspacePath, strategy) as Promise<GitOpResult>,
  gitLocalHiddenList: (workspacePath: string) =>
    ipcRenderer.invoke('git:localHiddenList', workspacePath) as Promise<string[]>,
  gitLocalHide: (workspacePath: string, relPath: string) =>
    ipcRenderer.invoke('git:localHide', workspacePath, relPath) as Promise<void>,
  gitLocalUnhide: (workspacePath: string, relPath: string) =>
    ipcRenderer.invoke('git:localUnhide', workspacePath, relPath) as Promise<void>,

  onUpdateAvailable: (handler: (info: UpdateInfo) => void) => {
    const listener = (_event: unknown, payload: UpdateInfo): void =>
      handler(payload);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.off('update:available', listener);
  },
  dismissUpdate: (version: string) => {
    ipcRenderer.send('update:dismiss', version);
  },
  openReleasePage: (url: string) => {
    ipcRenderer.send('update:open-release', url);
  },
};

contextBridge.exposeInMainWorld('scrapeman', api);
