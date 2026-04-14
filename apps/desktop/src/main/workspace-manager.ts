import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import {
  EnvironmentsFs,
  WorkspaceFs,
  WorkspaceWatcher,
  type WatcherEvent,
} from '@scrapeman/http-core';
import type {
  Environment,
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
    { fs: WorkspaceFs; envs: EnvironmentsFs; watcher: WorkspaceWatcher }
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
      const watcher = new WorkspaceWatcher(path, {
        onEvent: (event: WatcherEvent) =>
          this.broadcast({
            type: event.type,
            workspacePath: path,
            ...(event.type === 'file-changed' ? { relPath: event.relPath } : {}),
          } as WorkspaceEvent),
      });
      watcher.start();
      this.openWorkspaces.set(path, { fs, envs, watcher });
    }
    await this.rememberRecent(path);
    return this.getFs(path).readTree();
  }

  envsFs(workspacePath: string): EnvironmentsFs {
    const entry = this.openWorkspaces.get(workspacePath);
    if (!entry) throw new Error(`workspace not open: ${workspacePath}`);
    return entry.envs;
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
  ): Promise<Record<string, string>> {
    const entry = this.openWorkspaces.get(workspacePath);
    if (!entry) return {};
    const state = await entry.envs.readState();
    return entry.envs.resolveVariables(state.activeEnvironment);
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
  ): Promise<void> {
    const entry = this.openWorkspaces.get(workspacePath);
    if (entry) entry.watcher.suppressNext(relPath);
    await this.getFs(workspacePath).writeRequest(relPath, request);
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
