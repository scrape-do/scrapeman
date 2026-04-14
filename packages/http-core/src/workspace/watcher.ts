import chokidar, { type FSWatcher } from 'chokidar';
import { relative, posix, sep } from 'node:path';

export interface WatcherEvent {
  type: 'tree-changed' | 'file-changed';
  relPath: string;
}

export interface WatcherOptions {
  onEvent: (event: WatcherEvent) => void;
  debounceMs?: number;
}

export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private suppressedPaths = new Set<string>();
  private pendingTimer: NodeJS.Timeout | null = null;
  private pendingRelPath: string | null = null;

  constructor(
    private readonly root: string,
    private readonly options: WatcherOptions,
  ) {}

  start(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.root, {
      ignored: (path: string) =>
        /(^|[\\/])(\.git|node_modules|\.scrapeman)([\\/]|$)/.test(path),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 120,
        pollInterval: 40,
      },
    });

    const onChange = (absPath: string): void => {
      const rel = posixRelative(this.root, absPath);
      if (this.suppressedPaths.has(rel)) {
        this.suppressedPaths.delete(rel);
        return;
      }
      this.schedule(rel);
    };

    this.watcher.on('add', onChange);
    this.watcher.on('change', onChange);
    this.watcher.on('unlink', onChange);
    this.watcher.on('addDir', onChange);
    this.watcher.on('unlinkDir', onChange);
  }

  /**
   * Mark a path as self-written so the next event for it is swallowed.
   * Call BEFORE writing the file.
   */
  suppressNext(relPath: string): void {
    this.suppressedPaths.add(relPath);
  }

  async stop(): Promise<void> {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pendingRelPath = null;
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private schedule(relPath: string): void {
    this.pendingRelPath = relPath;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    const delay = this.options.debounceMs ?? 150;
    this.pendingTimer = setTimeout(() => {
      const path = this.pendingRelPath;
      this.pendingTimer = null;
      this.pendingRelPath = null;
      this.options.onEvent({ type: 'tree-changed', relPath: path ?? '' });
    }, delay);
  }
}

function posixRelative(from: string, to: string): string {
  const rel = relative(from, to);
  return rel.split(sep).join(posix.sep);
}
