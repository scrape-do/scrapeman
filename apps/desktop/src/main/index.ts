import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  UndiciExecutor,
  ExecutorError,
  parseCurlCommand,
  CurlParseError,
  resolveRequest,
  applyAuth,
  HistoryStore,
  generateCode,
  OAuth2Client,
  signAwsSigV4,
  composeScrapeDoRequest,
  WorkspaceCookieJar,
  runLoad,
} from '@scrapeman/http-core';
import type {
  CodegenInput,
  CookieEntry,
  Environment,
  ExecuteResult,
  HistoryListOptions,
  ImportCurlResult,
  LoadProgress,
  LoadRunStartInput,
  ScrapemanRequest,
} from '@scrapeman/shared-types';
import { WorkspaceManager } from './workspace-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const executor = new UndiciExecutor();
const workspaceManager = new WorkspaceManager();
const oauth2Client = new OAuth2Client();
let historyStore: HistoryStore | null = null;
let cookieJar: WorkspaceCookieJar | null = null;
const loadRuns = new Map<string, AbortController>();
const requestRuns = new Map<string, AbortController>();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#FFFFFF',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[scrapeman] renderer gone:', details);
  });
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[scrapeman] preload error:', preloadPath, error);
  });
}

function installContentSecurityPolicy(): void {
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);
  const devCsp = [
    "default-src 'self' http://localhost:* ws://localhost:* data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*",
    "style-src 'self' 'unsafe-inline' http://localhost:*",
    "connect-src 'self' http://localhost:* ws://localhost:*",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "frame-src 'self' data: blob:",
    "object-src 'self' data: blob:",
  ].join('; ');
  const prodCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-src 'self' data: blob:",
    "object-src 'self' data: blob:",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? devCsp : prodCsp],
      },
    });
  });
}

app.whenReady().then(() => {
  installContentSecurityPolicy();

  historyStore = new HistoryStore({ rootDir: app.getPath('userData') });
  cookieJar = new WorkspaceCookieJar({ rootDir: app.getPath('userData') });

  ipcMain.handle('app:ping', () => 'pong' as const);

  ipcMain.handle(
    'request:execute',
    async (
      _event,
      request: ScrapemanRequest,
      workspacePath: string | null,
      requestId: string,
    ): Promise<ExecuteResult> => {
      const startedAt = Date.now();
      let activeEnvironment: string | null = null;
      const controller = new AbortController();
      requestRuns.set(requestId, controller);
      try {
        let resolved = request;
        if (workspacePath) {
          const variables = await workspaceManager.resolveActiveVariables(
            workspacePath,
          );
          activeEnvironment = await workspaceManager.getActiveEnvironment(
            workspacePath,
          );
          resolved = resolveRequest(request, { variables }).request;
        }
        // scrape-do composer must run BEFORE auth/proxy wiring because it
        // rewrites the URL — auth headers should target api.scrape.do, not
        // the original host, and the proxy (if any) routes the scrape-do call.
        resolved = composeScrapeDoRequest(resolved);

        if (resolved.auth?.type === 'awsSigV4') {
          resolved = signAwsSigV4(resolved, {
            accessKeyId: resolved.auth.accessKeyId,
            secretAccessKey: resolved.auth.secretAccessKey,
            ...(resolved.auth.sessionToken
              ? { sessionToken: resolved.auth.sessionToken }
              : {}),
            region: resolved.auth.region,
            service: resolved.auth.service,
          });
        } else if (resolved.auth?.type === 'oauth2' && resolved.auth.flow === 'clientCredentials') {
          const token = await oauth2Client.getToken({
            tokenUrl: resolved.auth.tokenUrl,
            clientId: resolved.auth.clientId,
            clientSecret: resolved.auth.clientSecret,
            ...(resolved.auth.scope ? { scope: resolved.auth.scope } : {}),
            ...(resolved.auth.audience ? { audience: resolved.auth.audience } : {}),
          });
          resolved = {
            ...resolved,
            auth: { type: 'bearer', token: token.accessToken },
          };
        }
        resolved = applyAuth(resolved);

        // Inject Cookie header from the persistent jar (if any) before send.
        if (workspacePath && cookieJar) {
          const cookieHeader = await cookieJar.getCookieHeader(
            workspacePath,
            activeEnvironment,
            resolved.url,
          );
          if (cookieHeader) {
            resolved = {
              ...resolved,
              headers: {
                ...(resolved.headers ?? {}),
                Cookie: mergeCookieHeader(resolved.headers?.['Cookie'], cookieHeader),
              },
            };
          }
        }

        const response = await executor.execute(resolved, {
          signal: controller.signal,
        });

        // Capture Set-Cookie response headers into the jar for next time.
        if (workspacePath && cookieJar) {
          const setCookies = response.headers
            .filter(([name]) => name.toLowerCase() === 'set-cookie')
            .map(([, value]) => value);
          if (setCookies.length > 0) {
            await cookieJar
              .setCookiesFromResponse(
                workspacePath,
                activeEnvironment,
                resolved.url,
                setCookies,
              )
              .catch((err: unknown) =>
                console.error('[scrapeman] cookie store failed:', err),
              );
          }
        }

        if (workspacePath && historyStore) {
          try {
            // Store the ORIGINAL (unresolved) request so {{var}} templates
            // and dynamic values like {{random}} stay as templates in the
            // history file. Secrets never get baked in. Response side stays
            // as-is — that's what the server actually returned.
            await historyStore.insert(workspacePath, {
              workspacePath,
              environmentName: activeEnvironment,
              method: request.method,
              url: request.url,
              headers: request.headers ?? {},
              bodyPreview: extractRequestBodyPreview(request),
              bodyTruncated: false,
              status: response.status,
              statusOk: response.status >= 200 && response.status < 400,
              responseHeaders: response.headers,
              responseBodyPreview: decodeBodyPreview(response.bodyBase64),
              responseBodyTruncated: response.bodyTruncated,
              responseSizeBytes: response.sizeBytes,
              durationMs: Date.now() - startedAt,
              protocol: response.httpVersion,
            });
          } catch (err) {
            console.error('[scrapeman] history insert failed:', err);
          }
        }

        return { ok: true, response };
      } catch (err) {
        const kind =
          err instanceof ExecutorError ? err.kind : ('unknown' as const);
        const message = err instanceof Error ? err.message : String(err);

        if (workspacePath && historyStore) {
          try {
            await historyStore.insert(workspacePath, {
              workspacePath,
              environmentName: activeEnvironment,
              method: request.method,
              url: request.url,
              headers: request.headers ?? {},
              bodyPreview: extractRequestBodyPreview(request),
              bodyTruncated: false,
              status: 0,
              statusOk: false,
              responseHeaders: [],
              responseBodyPreview: '',
              responseBodyTruncated: false,
              responseSizeBytes: 0,
              durationMs: Date.now() - startedAt,
              protocol: 'n/a',
              error: { kind, message },
            });
          } catch (e) {
            console.error('[scrapeman] history insert failed:', e);
          }
        }

        return { ok: false, error: { kind, message } };
      } finally {
        requestRuns.delete(requestId);
      }
    },
  );

  ipcMain.handle('request:cancel', (_e, requestId: string): void => {
    requestRuns.get(requestId)?.abort();
  });

  ipcMain.handle(
    'response:save',
    async (
      _e,
      bodyBase64: string,
      suggestedName: string,
    ): Promise<{ ok: boolean; path?: string; canceled?: boolean }> => {
      const focused = BrowserWindow.getFocusedWindow();
      const result = focused
        ? await dialog.showSaveDialog(focused, { defaultPath: suggestedName })
        : await dialog.showSaveDialog({ defaultPath: suggestedName });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true };
      }
      try {
        const buf = Buffer.from(bodyBase64, 'base64');
        await writeFile(result.filePath, buf);
        return { ok: true, path: result.filePath };
      } catch (err) {
        console.error('[scrapeman] response save failed:', err);
        return { ok: false };
      }
    },
  );

  ipcMain.handle(
    'history:list',
    (_e, workspacePath: string, options?: HistoryListOptions) =>
      historyStore?.list(workspacePath, options ?? {}) ?? [],
  );
  ipcMain.handle(
    'history:delete',
    (_e, workspacePath: string, id: string) =>
      historyStore?.delete(workspacePath, id),
  );
  ipcMain.handle('history:clear', (_e, workspacePath: string) =>
    historyStore?.clear(workspacePath),
  );

  ipcMain.handle(
    'cookies:list',
    async (_e, workspacePath: string): Promise<CookieEntry[]> => {
      if (!cookieJar) return [];
      const env = await workspaceManager.getActiveEnvironment(workspacePath);
      return cookieJar.list(workspacePath, env);
    },
  );
  ipcMain.handle(
    'cookies:delete',
    async (
      _e,
      workspacePath: string,
      domain: string,
      path: string,
      name: string,
    ) => {
      if (!cookieJar) return;
      const env = await workspaceManager.getActiveEnvironment(workspacePath);
      await cookieJar.delete(workspacePath, env, domain, path, name);
    },
  );
  ipcMain.handle(
    'cookies:clearDomain',
    async (_e, workspacePath: string, domain: string) => {
      if (!cookieJar) return;
      const env = await workspaceManager.getActiveEnvironment(workspacePath);
      await cookieJar.clearDomain(workspacePath, env, domain);
    },
  );
  ipcMain.handle('cookies:clearAll', async (_e, workspacePath: string) => {
    if (!cookieJar) return;
    const env = await workspaceManager.getActiveEnvironment(workspacePath);
    await cookieJar.clearAll(workspacePath, env);
  });

  ipcMain.handle(
    'load:start',
    async (_e, input: LoadRunStartInput): Promise<string> => {
      const runId = randomUUID();
      const controller = new AbortController();
      loadRuns.set(runId, controller);

      const variables = input.workspacePath
        ? await workspaceManager.resolveActiveVariables(input.workspacePath)
        : {};

      // Fire and forget — progress streams via webContents.send until done.
      void (async () => {
        try {
          await runLoad(
            {
              request: input.request,
              variables,
              total: input.total,
              concurrency: input.concurrency,
              ...(input.perIterDelayMs !== undefined
                ? { perIterDelayMs: input.perIterDelayMs }
                : {}),
              validator: input.validator,
            },
            (progress) => {
              const payload: LoadProgress = { runId, ...progress };
              for (const win of BrowserWindow.getAllWindows()) {
                win.webContents.send('load:progress', payload);
              }
            },
            controller.signal,
          );
        } catch (err) {
          console.error('[scrapeman] load run failed:', err);
        } finally {
          loadRuns.delete(runId);
        }
      })();

      return runId;
    },
  );

  ipcMain.handle('load:stop', (_e, runId: string) => {
    const controller = loadRuns.get(runId);
    if (controller) controller.abort();
  });

  ipcMain.handle(
    'codegen:generate',
    async (_e, input: CodegenInput): Promise<string> => {
      const variables = input.workspacePath
        ? await workspaceManager.resolveActiveVariables(input.workspacePath)
        : {};
      return generateCode(input.target, input.request, {
        inlineVariables: input.inlineVariables,
        variables,
      });
    },
  );

  ipcMain.handle('curl:import', (_e, input: string): ImportCurlResult => {
    try {
      const request = parseCurlCommand(input);
      return { ok: true, request };
    } catch (err) {
      if (err instanceof CurlParseError) {
        return { ok: false, message: err.message };
      }
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle('workspace:pickDir', () => workspaceManager.pickDirectory());
  ipcMain.handle('workspace:open', (_e, path: string) => workspaceManager.openWorkspace(path));
  ipcMain.handle('workspace:list', () => workspaceManager.listRecents());
  ipcMain.handle('workspace:readRequest', (_e, path: string, relPath: string) =>
    workspaceManager.readRequest(path, relPath),
  );
  ipcMain.handle(
    'workspace:writeRequest',
    (_e, path: string, relPath: string, request: ScrapemanRequest) =>
      workspaceManager.writeRequest(path, relPath, request),
  );
  ipcMain.handle(
    'workspace:createFolder',
    (_e, path: string, parent: string, name: string) =>
      workspaceManager.createFolder(path, parent, name),
  );
  ipcMain.handle(
    'workspace:createRequest',
    (_e, path: string, parent: string, name: string) =>
      workspaceManager.createRequest(path, parent, name),
  );
  ipcMain.handle(
    'workspace:rename',
    (_e, path: string, relPath: string, newName: string) =>
      workspaceManager.rename(path, relPath, newName),
  );
  ipcMain.handle('workspace:delete', (_e, path: string, relPath: string) =>
    workspaceManager.delete(path, relPath),
  );
  ipcMain.handle(
    'workspace:move',
    (_e, path: string, relPath: string, newParent: string) =>
      workspaceManager.move(path, relPath, newParent),
  );

  ipcMain.handle('env:list', (_e, workspacePath: string) =>
    workspaceManager.listEnvironments(workspacePath),
  );
  ipcMain.handle('env:read', (_e, workspacePath: string, name: string) =>
    workspaceManager.readEnvironment(workspacePath, name),
  );
  ipcMain.handle('env:write', (_e, workspacePath: string, env: Environment) =>
    workspaceManager.writeEnvironment(workspacePath, env),
  );
  ipcMain.handle('env:delete', (_e, workspacePath: string, name: string) =>
    workspaceManager.deleteEnvironment(workspacePath, name),
  );
  ipcMain.handle('env:getActive', (_e, workspacePath: string) =>
    workspaceManager.getActiveEnvironment(workspacePath),
  );
  ipcMain.handle(
    'env:setActive',
    (_e, workspacePath: string, name: string | null) =>
      workspaceManager.setActiveEnvironment(workspacePath, name),
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void workspaceManager.dispose();
});

function extractRequestBodyPreview(request: ScrapemanRequest): string {
  if (!request.body || request.body.type === 'none') return '';
  if (
    request.body.type === 'json' ||
    request.body.type === 'xml' ||
    request.body.type === 'text' ||
    request.body.type === 'html' ||
    request.body.type === 'javascript'
  ) {
    return request.body.content ?? '';
  }
  if (request.body.type === 'formUrlEncoded') {
    return new URLSearchParams(request.body.fields).toString();
  }
  if (request.body.type === 'multipart') {
    return `multipart/form-data (${request.body.parts.length} parts)`;
  }
  if (request.body.type === 'binary') {
    return `binary file: ${request.body.file}`;
  }
  return '';
}

function mergeCookieHeader(
  existing: string | undefined,
  fromJar: string,
): string {
  if (!existing || !existing.trim()) return fromJar;
  return `${existing}; ${fromJar}`;
}

function decodeBodyPreview(base64: string): string {
  try {
    const buf = Buffer.from(base64, 'base64');
    return buf.toString('utf8');
  } catch {
    return '';
  }
}
