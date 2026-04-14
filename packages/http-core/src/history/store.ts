import { promises as fsp, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type {
  HistoryEntry,
  HistoryListOptions,
} from '@scrapeman/shared-types';

const DEFAULT_MAX_ENTRIES = 5000;
// Effectively unlimited — local storage, full bodies preserved by default.
// Tests can pass an explicit smaller cap.
const DEFAULT_BODY_PREVIEW_BYTES = Number.MAX_SAFE_INTEGER;
// Bodies larger than this get stored gzipped on disk to keep history files
// from ballooning. Smaller bodies stay inline-readable.
const GZIP_THRESHOLD_BYTES = 256;

export interface HistoryStoreOptions {
  /** Directory used as the app data root (e.g. Electron `userData`). */
  rootDir: string;
  /** Maximum entries kept per workspace. Older entries pruned on insert. */
  maxEntries?: number;
  /** Maximum preview bytes stored for request + response bodies. */
  maxBodyPreviewBytes?: number;
}

/**
 * File-based history store. One JSON Lines file per workspace, keyed by a
 * stable hash of the workspace path so history never leaks between folders
 * and never touches the workspace folder itself.
 */
export class HistoryStore {
  private readonly rootDir: string;
  private readonly maxEntries: number;
  private readonly maxBodyPreviewBytes: number;
  private readonly cache = new Map<string, HistoryEntry[]>();

  constructor(options: HistoryStoreOptions) {
    this.rootDir = options.rootDir;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBodyPreviewBytes =
      options.maxBodyPreviewBytes ?? DEFAULT_BODY_PREVIEW_BYTES;
  }

  async insert(
    workspacePath: string,
    entry: Omit<HistoryEntry, 'id' | 'sentAt'> & {
      id?: string;
      sentAt?: string;
    },
  ): Promise<HistoryEntry> {
    const full: HistoryEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      sentAt: entry.sentAt ?? new Date().toISOString(),
      bodyPreview: truncate(entry.bodyPreview, this.maxBodyPreviewBytes),
      bodyTruncated:
        entry.bodyTruncated ||
        Buffer.byteLength(entry.bodyPreview ?? '', 'utf8') >
          this.maxBodyPreviewBytes,
      responseBodyPreview: truncate(
        entry.responseBodyPreview,
        this.maxBodyPreviewBytes,
      ),
      responseBodyTruncated:
        entry.responseBodyTruncated ||
        Buffer.byteLength(entry.responseBodyPreview ?? '', 'utf8') >
          this.maxBodyPreviewBytes,
    };

    const list = await this.load(workspacePath);
    list.push(full);

    let pruned = list;
    if (list.length > this.maxEntries) {
      pruned = list.slice(list.length - this.maxEntries);
    }
    this.cache.set(workspacePath, pruned);

    const file = this.fileFor(workspacePath);
    if (pruned.length === list.length) {
      await this.appendOne(file, full);
    } else {
      // Pruned — rewrite the whole file.
      await this.writeAll(file, pruned);
    }
    return full;
  }

  async list(
    workspacePath: string,
    options: HistoryListOptions = {},
  ): Promise<HistoryEntry[]> {
    const all = await this.load(workspacePath);
    const sorted = all.slice().sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    let filtered = sorted;
    if (options.before) {
      filtered = filtered.filter((e) => e.sentAt < options.before!);
    }
    if (options.search) {
      const needle = options.search.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.url.toLowerCase().includes(needle) ||
          e.method.toLowerCase().includes(needle) ||
          e.responseBodyPreview.toLowerCase().includes(needle),
      );
    }
    if (options.limit !== undefined) {
      filtered = filtered.slice(0, options.limit);
    }
    return filtered;
  }

  async delete(workspacePath: string, id: string): Promise<void> {
    const list = await this.load(workspacePath);
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return;
    this.cache.set(workspacePath, next);
    await this.writeAll(this.fileFor(workspacePath), next);
  }

  async clear(workspacePath: string): Promise<void> {
    this.cache.set(workspacePath, []);
    const file = this.fileFor(workspacePath);
    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(file, '', 'utf8');
  }

  private async load(workspacePath: string): Promise<HistoryEntry[]> {
    const cached = this.cache.get(workspacePath);
    if (cached) return cached;
    const file = this.fileFor(workspacePath);
    if (!existsSync(file)) {
      this.cache.set(workspacePath, []);
      return [];
    }
    const text = await fsp.readFile(file, 'utf8');
    const entries: HistoryEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(deserializeEntry(JSON.parse(line) as StoredEntry));
      } catch {
        /* skip malformed lines */
      }
    }
    this.cache.set(workspacePath, entries);
    return entries;
  }

  private async writeAll(file: string, entries: HistoryEntry[]): Promise<void> {
    await fsp.mkdir(dirname(file), { recursive: true });
    const body = entries.map((e) => JSON.stringify(serializeEntry(e))).join('\n');
    await fsp.writeFile(file, body ? `${body}\n` : '', 'utf8');
  }

  private async appendOne(file: string, entry: HistoryEntry): Promise<void> {
    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.appendFile(
      file,
      JSON.stringify(serializeEntry(entry)) + '\n',
      'utf8',
    );
  }

  private fileFor(workspacePath: string): string {
    const hash = createHash('sha1').update(workspacePath).digest('hex').slice(0, 16);
    return join(this.rootDir, 'history', `${hash}.jsonl`);
  }
}

// On-disk shape: large bodies stored gzipped to keep history files small.
// Older lines without _bodyGz / _respGz fall back to plain fields.
interface StoredEntry extends Omit<HistoryEntry, 'bodyPreview' | 'responseBodyPreview'> {
  bodyPreview?: string;
  responseBodyPreview?: string;
  _bodyGz?: string;
  _respGz?: string;
}

function serializeEntry(entry: HistoryEntry): StoredEntry {
  const out: StoredEntry = { ...entry };
  delete (out as { bodyPreview?: string }).bodyPreview;
  delete (out as { responseBodyPreview?: string }).responseBodyPreview;

  if (entry.bodyPreview) {
    if (Buffer.byteLength(entry.bodyPreview, 'utf8') >= GZIP_THRESHOLD_BYTES) {
      out._bodyGz = gzipSync(Buffer.from(entry.bodyPreview, 'utf8')).toString('base64');
    } else {
      out.bodyPreview = entry.bodyPreview;
    }
  }
  if (entry.responseBodyPreview) {
    if (
      Buffer.byteLength(entry.responseBodyPreview, 'utf8') >= GZIP_THRESHOLD_BYTES
    ) {
      out._respGz = gzipSync(
        Buffer.from(entry.responseBodyPreview, 'utf8'),
      ).toString('base64');
    } else {
      out.responseBodyPreview = entry.responseBodyPreview;
    }
  }
  return out;
}

function deserializeEntry(stored: StoredEntry): HistoryEntry {
  let bodyPreview = stored.bodyPreview ?? '';
  if (stored._bodyGz) {
    try {
      bodyPreview = gunzipSync(Buffer.from(stored._bodyGz, 'base64')).toString('utf8');
    } catch {
      bodyPreview = '';
    }
  }
  let responseBodyPreview = stored.responseBodyPreview ?? '';
  if (stored._respGz) {
    try {
      responseBodyPreview = gunzipSync(
        Buffer.from(stored._respGz, 'base64'),
      ).toString('utf8');
    } catch {
      responseBodyPreview = '';
    }
  }
  const out = { ...stored, bodyPreview, responseBodyPreview } as HistoryEntry;
  delete (out as { _bodyGz?: string })._bodyGz;
  delete (out as { _respGz?: string })._respGz;
  return out;
}

function truncate(value: string | undefined, maxBytes: number): string {
  if (!value) return '';
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  // Truncate to whole code units; good enough for text previews.
  const buf = Buffer.from(value, 'utf8').subarray(0, maxBytes);
  return buf.toString('utf8');
}
