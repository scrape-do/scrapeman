import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import {
  EnvironmentsFs,
  GlobalsFs,
  CollectionFs,
  FolderSettingsFs,
  ScopedVariableResolver,
  WorkspaceFs,
  WorkspaceWatcher,
  type WatcherEvent,
} from '@scrapeman/http-core';
import type {
  CollectionSettings,
  Environment,
  FolderSettings,
  GlobalVariables,
  InheritedAuthInfo,
  RecentWorkspace,
  ScrapemanRequest,
  WorkspaceEvent,
  WorkspaceTree,
} from '@scrapeman/shared-types';

const RECENT_FILE = 'recent-workspaces.json';
const MAX_RECENTS = 10;

export class WorkspaceManager {
  private readonly openWorkspaces = new Map<
    string,
    {
      fs: WorkspaceFs;
      envs: EnvironmentsFs;
      globals: GlobalsFs;
      collection: CollectionFs;
      folders: FolderSettingsFs;
      resolver: ScopedVariableResolver;
      watcher: WorkspaceWatcher;
    }
  >();

  async pickDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open workspace',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0]!;
  }

  async openWorkspace(path: string): Promise<WorkspaceTree> {
    if (!this.openWorkspaces.has(path)) {
      const fs = new WorkspaceFs(path);
      const envs = new EnvironmentsFs(path);
      const globals = new GlobalsFs(path);
      const collection = new CollectionFs(path);
      const folders = new FolderSettingsFs(path);
      const resolver = new ScopedVariableResolver(path);
      const watcher = new WorkspaceWatcher(path, {
        onEvent: (event: WatcherEvent) =>
          this.broadcast({
            type: event.type,
            workspacePath: path,
            ...(event.type === 'file-changed' ? { relPath: event.relPath } : {}),
          } as WorkspaceEvent),
      });
      watcher.start();
      this.openWorkspaces.set(path, {
        fs,
        envs,
        globals,
        collection,
        folders,
        resolver,
        watcher,
      });
    }
    await this.rememberRecent(path);
    return this.getFs(path).readTree();
  }

  envsFs(workspacePath: string): EnvironmentsFs {
    const entry = this.openWorkspaces.get(workspacePath);
    if (!entry) throw new Error(`workspace not open: ${workspacePath}`);
    return entry.envs;
  }

  private getEntry(workspacePath: string) {
    const entry = this.openWorkspaces.get(workspacePath);
    if (!entry) throw new Error(`workspace not open: ${workspacePath}`);
    return entry;
  }

  // Global variables
  async readGlobals(workspacePath: string): Promise<GlobalVariables> {
    return this.getEntry(workspacePath).globals.read();
  }

  async writeGlobals(
    workspacePath: string,
    globals: GlobalVariables,
  ): Promise<void> {
    await this.getEntry(workspacePath).globals.write(globals);
    this.broadcast({ type: 'globals-changed', workspacePath });
  }

  // Collection settings
  async readCollectionSettings(
    workspacePath: string,
  ): Promise<CollectionSettings> {
    return this.getEntry(workspacePath).collection.read();
  }

  async writeCollectionSettings(
    workspacePath: string,
    settings: CollectionSettings,
  ): Promise<void> {
    await this.getEntry(workspacePath).collection.write(settings);
    this.broadcast({ type: 'collection-settings-changed', workspacePath });
  }

  // Folder settings
  async readFolderSettings(
    workspacePath: string,
    folderRelPath: string,
  ): Promise<FolderSettings> {
    return this.getEntry(workspacePath).folders.read(folderRelPath);
  }

  async writeFolderSettings(
    workspacePath: string,
    folderRelPath: string,
    settings: FolderSettings,
  ): Promise<void> {
    await this.getEntry(workspacePath).folders.write(folderRelPath, settings);
    this.broadcast({
      type: 'folder-settings-changed',
      workspacePath,
      folderRelPath,
    });
  }

  // Auth inheritance resolver
  async resolveInheritedAuth(
    workspacePath: string,
    requestRelPath: string,
  ): Promise<InheritedAuthInfo | null> {
    const entry = this.openWorkspaces.get(workspacePath);
    if (!entry) return null;
    const state = await entry.envs.readState();
    const resolved = await entry.resolver.resolve(
      requestRelPath,
      state.activeEnvironment,
    );
    if (!resolved.inheritedAuth) return null;
    return {
      auth: resolved.inheritedAuth,
      source: resolved.inheritedAuthSource ?? '',
    };
  }

  async listEnvironments(workspacePath: string): Promise<Environment[]> {
    return this.envsFs(workspacePath).listEnvironments();
  }

  async readEnvironment(
    workspacePath: string,
    name: string,
  ): Promise<Environment | null> {
    return this.envsFs(workspacePath).readEnvironment(name);
  }

  async writeEnvironment(workspacePath: string, env: Environment): Promise<void> {
    await this.envsFs(workspacePath).writeEnvironment(env);
    this.broadcast({ type: 'environments-changed', workspacePath });
  }

  async deleteEnvironment(workspacePath: string, name: string): Promise<void> {
    await this.envsFs(workspacePath).deleteEnvironment(name);
    this.broadcast({ type: 'environments-changed', workspacePath });
  }

  async getActiveEnvironment(workspacePath: string): Promise<string | null> {
    const state = await this.envsFs(workspacePath).readState();
    return state.activeEnvironment;
  }

  async setActiveEnvironment(
    workspacePath: string,
    name: string | null,
  ): Promise<void> {
    await this.envsFs(workspacePath).writeState({ activeEnvironment: name });
    this.broadcast({ type: 'environments-changed', workspacePath });
  }

  async resolveActiveVariables(
    workspacePath: string,
    requestRelPath = '',
  ): Promise<Record<string, string>> {
    const entry = this.openWorkspaces.get(workspacePath);
    if (!entry) return {};
    const state = await entry.envs.readState();
    const resolved = await entry.resolver.resolve(
      requestRelPath,
      state.activeEnvironment,
    );
    return resolved.variables;
  }

  async resolveActiveSecretKeys(
    workspacePath: string,
    requestRelPath = '',
  ): Promise<Set<string>> {
    const entry = this.openWorkspaces.get(workspacePath);
    if (!entry) return new Set();
    const state = await entry.envs.readState();
    const resolved = await entry.resolver.resolve(
      requestRelPath,
      state.activeEnvironment,
    );
    return resolved.secretKeys;
  }

  async listRecents(): Promise<RecentWorkspace[]> {
    const file = join(app.getPath('userData'), RECENT_FILE);
    try {
      const text = await fsp.readFile(file, 'utf8');
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is RecentWorkspace =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RecentWorkspace).path === 'string',
      );
    } catch {
      return [];
    }
  }

  async readRequest(workspacePath: string, relPath: string): Promise<ScrapemanRequest> {
    return this.getFs(workspacePath).readRequest(relPath);
  }

  async writeRequest(
    workspacePath: string,
    relPath: string,
    request: ScrapemanRequest,
  ): Promise<string> {
    const entry = this.openWorkspaces.get(workspacePath);
    if (entry) {
      // Suppress the target path. When migrating `.req.yaml` → `.sman`,
      // also suppress the `.sman` target + the legacy unlink event so the
      // watcher doesn't fire a spurious tree refresh from our own write.
      entry.watcher.suppressNext(relPath);
      if (relPath.endsWith('.req.yaml')) {
        const smanPath = relPath.slice(0, -'.req.yaml'.length) + '.sman';
        entry.watcher.suppressNext(smanPath);
      }
    }
    return this.getFs(workspacePath).writeRequest(relPath, request);
  }

  createFolder(workspacePath: string, parentRelPath: string, name: string): Promise<string> {
    return this.getFs(workspacePath).createFolder(parentRelPath, name);
  }

  createRequest(workspacePath: string, parentRelPath: string, name: string): Promise<string> {
    return this.getFs(workspacePath).createRequest(parentRelPath, name);
  }

  rename(workspacePath: string, relPath: string, newName: string): Promise<string> {
    return this.getFs(workspacePath).rename(relPath, newName);
  }

  delete(workspacePath: string, relPath: string): Promise<void> {
    return this.getFs(workspacePath).delete(relPath);
  }

  move(workspacePath: string, relPath: string, newParentRelPath: string): Promise<string> {
    return this.getFs(workspacePath).move(relPath, newParentRelPath);
  }

  async dispose(): Promise<void> {
    for (const { watcher } of this.openWorkspaces.values()) {
      await watcher.stop();
    }
    this.openWorkspaces.clear();
  }

  private getFs(path: string): WorkspaceFs {
    const entry = this.openWorkspaces.get(path);
    if (!entry) throw new Error(`workspace not open: ${path}`);
    return entry.fs;
  }

  private async rememberRecent(path: string): Promise<void> {
    const existing = await this.listRecents();
    const filtered = existing.filter((r) => r.path !== path);
    const entry: RecentWorkspace = {
      path,
      name: path.split('/').pop() ?? path,
      lastOpenedAt: new Date().toISOString(),
    };
    const updated = [entry, ...filtered].slice(0, MAX_RECENTS);
    const file = join(app.getPath('userData'), RECENT_FILE);
    await fsp.mkdir(app.getPath('userData'), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(updated, null, 2), 'utf8');
  }

  private broadcast(event: WorkspaceEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('workspace:event', event);
    }
  }
}
