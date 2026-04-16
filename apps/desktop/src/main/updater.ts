import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { UpdateInfo } from '@scrapeman/shared-types';

const RELEASES_URL =
  'https://api.github.com/repos/scrape-do/scrapeman/releases/latest';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000; // 1 hour

// Versions the user dismissed this session — don't re-emit for these.
const dismissedVersions = new Set<string>();

let checkTimer: ReturnType<typeof setInterval> | null = null;
let rateLimitedUntil = 0;

/**
 * Compare two semver strings (e.g. "0.3.0" > "0.2.1").
 * Returns true if `remote` is newer than `local`.
 */
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rv = r[i] ?? 0;
    const lv = l[i] ?? 0;
    if (rv > lv) return true;
    if (rv < lv) return false;
  }
  return false;
}

async function checkForUpdate(mainWindow: BrowserWindow): Promise<void> {
  if (Date.now() < rateLimitedUntil) return;

  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    // Handle rate limiting
    if (
      res.status === 403 &&
      res.headers.get('x-ratelimit-remaining') === '0'
    ) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      return;
    }

    if (!res.ok) return;

    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      body?: string;
    };

    const tagName = data.tag_name;
    if (!tagName) return;

    const version = tagName.replace(/^v/, '');
    const currentVersion = app.getVersion();

    if (!isNewerVersion(version, currentVersion)) return;
    if (dismissedVersions.has(version)) return;

    const info: UpdateInfo = {
      version,
      tagName,
      releaseUrl: data.html_url ?? '',
      publishedAt: data.published_at ?? '',
      ...(data.body ? { notes: data.body } : {}),
    };

    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', info);
    }
  } catch {
    // Network error, parse error — silently ignore, retry next interval.
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Listen for dismiss events from the renderer.
  ipcMain.on('update:dismiss', (_e, version: string) => {
    dismissedVersions.add(version);
  });

  // Listen for open-release-page events from the renderer.
  ipcMain.on('update:open-release', (_e, url: string) => {
    void shell.openExternal(url);
  });

  // Initial check (slight delay to not block startup).
  void checkForUpdate(mainWindow);

  // Periodic check every 4 hours.
  checkTimer = setInterval(() => {
    void checkForUpdate(mainWindow);
  }, CHECK_INTERVAL_MS);

  // Clean up on quit.
  app.on('before-quit', () => {
    if (checkTimer !== null) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  });
}
