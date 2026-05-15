import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateInfo, UpdaterState } from '@scrapeman/shared-types';

const RELEASES_URL =
  'https://api.github.com/repos/scrape-do/scrapeman/releases/latest';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000; // 1 hour

// Versions the user dismissed this session — don't re-emit for these.
const dismissedVersions = new Set<string>();

let checkTimer: ReturnType<typeof setInterval> | null = null;
let rateLimitedUntil = 0;
let mainWindowRef: BrowserWindow | null = null;

// Runtime state exposed to the renderer via `update:get-state`.
let lastCheckAt: number | null = null;
let latestKnown: UpdateInfo | null = null;
let checking = false;
let lastError: string | null = null;
let autoCheck = true;

function prefsPath(): string {
  return join(app.getPath('userData'), 'updater-prefs.json');
}

function readPrefs(): { autoCheck: boolean } {
  try {
    if (existsSync(prefsPath())) {
      const parsed = JSON.parse(readFileSync(prefsPath(), 'utf-8')) as {
        autoCheck?: unknown;
      };
      if (typeof parsed.autoCheck === 'boolean') {
        return { autoCheck: parsed.autoCheck };
      }
    }
  } catch {
    /* malformed prefs — fall through to default */
  }
  return { autoCheck: true };
}

function writePrefs(): void {
  try {
    writeFileSync(prefsPath(), JSON.stringify({ autoCheck }), 'utf-8');
  } catch {
    /* disk full or read-only — silently ignore */
  }
}

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

/**
 * Fetch the latest release from GitHub. Stores the result on
 * `latestKnown` regardless of whether it's newer than the current
 * version — the Settings → Updates panel wants to display "you're on
 * the latest" too, not just notify on upgrades.
 *
 * `notify=true` (the default) emits `update:available` for the
 * upgrade-banner flow. `notify=false` is used by the renderer's
 * manual "Check now" button — the panel reads the state directly.
 */
async function checkForUpdate(
  notify = true,
): Promise<{ ok: true; info: UpdateInfo | null } | { ok: false; error: string }> {
  if (Date.now() < rateLimitedUntil) {
    return { ok: false, error: 'GitHub rate limit hit; try again later.' };
  }

  checking = true;
  emitState();
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (
      res.status === 403 &&
      res.headers.get('x-ratelimit-remaining') === '0'
    ) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      lastError = 'GitHub rate limit hit; try again later.';
      return { ok: false, error: lastError };
    }

    if (!res.ok) {
      lastError = `GitHub returned ${res.status}`;
      return { ok: false, error: lastError };
    }

    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      body?: string;
    };

    const tagName = data.tag_name;
    if (!tagName) {
      lastError = 'GitHub response missing tag_name';
      return { ok: false, error: lastError };
    }

    const version = tagName.replace(/^v/, '');
    const info: UpdateInfo = {
      version,
      tagName,
      releaseUrl: data.html_url ?? '',
      publishedAt: data.published_at ?? '',
      ...(data.body ? { notes: data.body } : {}),
    };
    latestKnown = info;
    lastError = null;

    const currentVersion = app.getVersion();
    if (
      notify &&
      isNewerVersion(version, currentVersion) &&
      !dismissedVersions.has(version) &&
      mainWindowRef &&
      !mainWindowRef.isDestroyed()
    ) {
      mainWindowRef.webContents.send('update:available', info);
    }
    return { ok: true, info };
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'Network error';
    return { ok: false, error: lastError };
  } finally {
    checking = false;
    lastCheckAt = Date.now();
    emitState();
  }
}

function startTimer(): void {
  if (checkTimer !== null) return;
  checkTimer = setInterval(() => {
    void checkForUpdate();
  }, CHECK_INTERVAL_MS);
}

function stopTimer(): void {
  if (checkTimer === null) return;
  clearInterval(checkTimer);
  checkTimer = null;
}

function currentState(): UpdaterState {
  return {
    currentVersion: app.getVersion(),
    latestVersion: latestKnown?.version ?? null,
    latestUpdate: latestKnown,
    lastCheckAt,
    checking,
    autoCheck,
    error: lastError,
  };
}

function emitState(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('update:state', currentState());
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;
  ({ autoCheck } = readPrefs());

  // Dismiss (banner × button): same shape as before.
  ipcMain.on('update:dismiss', (_e, version: string) => {
    dismissedVersions.add(version);
  });

  ipcMain.on('update:open-release', (_e, url: string) => {
    void shell.openExternal(url);
  });

  // Settings → Updates panel IPC: read state, manual check, toggle auto-check.
  ipcMain.handle('update:get-state', () => currentState());
  ipcMain.handle('update:check-now', async () => {
    const r = await checkForUpdate(false);
    return { state: currentState(), result: r };
  });
  ipcMain.handle('update:set-auto-check', (_e, enabled: boolean) => {
    autoCheck = Boolean(enabled);
    writePrefs();
    if (autoCheck) startTimer();
    else stopTimer();
    emitState();
    return currentState();
  });

  if (autoCheck) {
    void checkForUpdate();
    startTimer();
  }

  app.on('before-quit', () => {
    stopTimer();
  });
}
