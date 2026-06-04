import { promises as fsp, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type {
  HistoryEntry,
  HistoryListOptions,
} from '@scrapeman/shared-types';

// Maximum bytes to read per backward-scan chunk when tail-reading the file.
// 256 KB is large enough to parse dozens of typical JSONL lines per read,
// small enough to never materialise the whole file in memory.
const TAIL_CHUNK_BYTES = 256 * 1024;

// Bodies larger than this get stored gzip+base64 on disk to keep history
// files from ballooning. Smaller bodies stay as plain UTF-8 strings.
const GZIP_THRESHOLD_BYTES = 256;

// Default preview cap (effectively unlimited; tests may pass smaller values).
const DEFAULT_BODY_PREVIEW_BYTES = Number.MAX_SAFE_INTEGER;

// Default batch size when no explicit limit is requested.
const DEFAULT_BATCH_SIZE = 100;

export interface HistoryStoreOptions {
  /** Directory used as the app data root (e.g. Electron `userData`). */
  rootDir: string;
  /**
   * @deprecated No longer used. Kept for API compatibility — trimming removed.
   * History retention is now unlimited.
   */
  maxEntries?: number;
  /** Maximum preview bytes stored for request + response bodies. */
  maxBodyPreviewBytes?: number;
}

// On-disk shape: large bodies stored gzipped to keep history files small.
// Older lines without _bodyGz / _respGz fall back to plain fields.
interface StoredEntry
  extends Omit<HistoryEntry, 'bodyPreview' | 'responseBodyPreview'> {
  bodyPreview?: string;
  responseBodyPreview?: string;
  _bodyGz?: string;
  _respGz?: string;
}

/**
 * File-based history store. One JSON Lines file per workspace, keyed by a
 * stable hash of the workspace path so history never leaks between folders
 * and never touches the workspace folder itself.
 *
 * Loading model: entries are read ONLY from the tail of the file so memory
 * usage is O(window), not O(file size). Full gzipped bodies are decompressed
 * ONLY when a specific entry is fetched by ID via getById().
 *
 * Retention is unlimited: no entries are ever pruned from disk.
 */
export class HistoryStore {
  private readonly rootDir: string;
  private readonly maxBodyPreviewBytes: number;

  // Cache holds only the most-recently-loaded window per workspace.
  // Key: workspacePath. Value: the current list window (metadata-only entries).
  private readonly windowCache = new Map<string, HistoryEntry[]>();

  constructor(options: HistoryStoreOptions) {
    this.rootDir = options.rootDir;
    this.maxBodyPreviewBytes =
      options.maxBodyPreviewBytes ?? DEFAULT_BODY_PREVIEW_BYTES;
    // options.maxEntries intentionally ignored — trimming is removed.
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

    // Append only — O(1), no read of existing entries, no decompression.
    const file = this.fileFor(workspacePath);
    await this.appendOne(file, full);

    // Prepend to the cached window so the new entry is immediately visible
    // to the renderer without requiring a reload.
    const cached = this.windowCache.get(workspacePath);
    if (cached) {
      this.windowCache.set(workspacePath, [full, ...cached]);
    }

    return full;
  }

  /**
   * List entries for a workspace, reading at most `limit` entries from the
   * tail of the file. Never decompresses full bodies — only the small stored
   * preview is returned.
   *
   * Pagination: pass `before` (an ISO timestamp) to fetch entries older than
   * that cursor. Combine with `limit` for day-batched infinite scroll.
   */
  async list(
    workspacePath: string,
    options: HistoryListOptions = {},
  ): Promise<HistoryEntry[]> {
    const limit = options.limit ?? DEFAULT_BATCH_SIZE;

    // When no before-cursor and no search, serve the cached window if present.
    if (!options.before && !options.search) {
      const cached = this.windowCache.get(workspacePath);
      if (cached) {
        return limit ? cached.slice(0, limit) : cached;
      }
    }

    const file = this.fileFor(workspacePath);
    if (!existsSync(file)) {
      if (!options.before && !options.search) {
        this.windowCache.set(workspacePath, []);
      }
      return [];
    }

    let stat: { size: number };
    try {
      stat = await fsp.stat(file);
    } catch {
      return [];
    }

    if (stat.size === 0) {
      if (!options.before && !options.search) {
        this.windowCache.set(workspacePath, []);
      }
      return [];
    }

    const entries = await tailRead(file, stat.size, {
      limit,
      ...(options.before !== undefined ? { before: options.before } : {}),
      ...(options.search !== undefined ? { search: options.search } : {}),
    });

    // Cache only the initial (no-cursor) window.
    if (!options.before && !options.search) {
      this.windowCache.set(workspacePath, entries);
    }

    return entries;
  }

  /**
   * Fetch a single entry by ID with full bodies decompressed.
   * Scans the file from the tail backward until found.
   * Returns null when the entry does not exist.
   */
  async getById(
    workspacePath: string,
    id: string,
  ): Promise<HistoryEntry | null> {
    const file = this.fileFor(workspacePath);
    if (!existsSync(file)) return null;

    let stat: { size: number };
    try {
      stat = await fsp.stat(file);
    } catch {
      return null;
    }

    return tailFindById(file, stat.size, id);
  }

  /**
   * Delete a single entry by ID. Rewrites the file without decompressing any
   * body content — raw line bytes are preserved as-is for kept lines.
   */
  async delete(workspacePath: string, id: string): Promise<void> {
    const file = this.fileFor(workspacePath);
    if (!existsSync(file)) return;

    // Read raw lines, drop the one matching the target id, rewrite.
    // lineContainsId is a quick string scan to avoid full JSON parse + body
    // decompression on every line.
    const text = await fsp.readFile(file, 'utf8');
    const lines = text.split('\n').filter((l) => l.trim());
    const kept: string[] = [];
    let found = false;
    for (const line of lines) {
      if (!found && lineContainsId(line, id)) {
        try {
          const parsed = JSON.parse(line) as StoredEntry;
          if (parsed.id === id) {
            found = true;
            continue;
          }
        } catch {
          /* keep corrupted line as-is */
        }
      }
      kept.push(line);
    }
    if (!found) return;

    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(
      file,
      kept.length ? kept.join('\n') + '\n' : '',
      'utf8',
    );

    // Evict cache so the next list() re-reads the updated file.
    this.windowCache.delete(workspacePath);
  }

  async clear(workspacePath: string): Promise<void> {
    this.windowCache.delete(workspacePath);
    const file = this.fileFor(workspacePath);
    await fsp.mkdir(dirname(file), { recursive: true });
    await fsp.writeFile(file, '', 'utf8');
  }

  /** Absolute path of the on-disk history file for this workspace. */
  getFilePath(workspacePath: string): string {
    return this.fileFor(workspacePath);
  }

  /** Absolute path of the directory holding all workspace history files. */
  getRootPath(): string {
    return join(this.rootDir, 'history');
  }

  /** Drop in-memory cache so the next list() re-reads from disk. */
  invalidateCache(workspacePath?: string): void {
    if (workspacePath) this.windowCache.delete(workspacePath);
    else this.windowCache.clear();
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
    const hash = createHash('sha1')
      .update(workspacePath)
      .digest('hex')
      .slice(0, 16);
    return join(this.rootDir, 'history', `${hash}.jsonl`);
  }
}

// ---------------------------------------------------------------------------
// Tail reader — reads the file backward in TAIL_CHUNK_BYTES chunks.
// Parses only enough lines to satisfy the requested batch.
// Never decompresses _bodyGz / _respGz on list operations.
// ---------------------------------------------------------------------------

interface TailReadOptions {
  limit: number;
  before?: string;
  search?: string;
}

async function tailRead(
  file: string,
  fileSize: number,
  opts: TailReadOptions,
): Promise<HistoryEntry[]> {
  const { limit, before, search } = opts;
  const needle = search ? search.toLowerCase() : null;

  const results: HistoryEntry[] = [];
  let remaining = fileSize;

  // Carry raw bytes from the previous (more-recent) chunk. A multibyte UTF-8
  // character split across a 256KB boundary must be rejoined at the byte level
  // before decoding — decoding each half separately produces U+FFFD.
  let carryBuf = Buffer.alloc(0);

  const fd = await fsp.open(file, 'r');
  try {
    while (remaining > 0 && results.length < limit) {
      const chunkSize = Math.min(TAIL_CHUNK_BYTES, remaining);
      remaining -= chunkSize;
      const offset = remaining;

      const buf = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await fd.read(buf, 0, chunkSize, offset);
      if (bytesRead === 0) break;

      // Concatenate at buffer level: chunk first, then the carry bytes
      // (which are the beginning of the line whose end was already read).
      const combined = Buffer.concat([buf.subarray(0, bytesRead), carryBuf]);

      // Split on 0x0A (newline). rawParts[0] is a partial line at the start
      // of this chunk that continues further back in the file — kept as the
      // new carry buffer. Parts [1..end] are complete lines.
      const newlineIdx: number[] = [];
      for (let k = 0; k < combined.length; k++) {
        if (combined[k] === 0x0a) newlineIdx.push(k);
      }

      // carryBuf = bytes before the first newline (may be empty if chunk
      // starts on a newline boundary).
      carryBuf =
        newlineIdx.length === 0
          ? combined
          : combined.subarray(0, newlineIdx[0]);

      // Process complete lines newest-first (last newline to first newline).
      for (let ni = newlineIdx.length - 1; ni >= 0; ni--) {
        if (results.length >= limit) break;
        const prevNewline = ni === 0 ? newlineIdx[0] : newlineIdx[ni - 1];
        const curNewline = newlineIdx[ni];
        // Both values are defined because ni is a valid index (checked by loop condition).
        if (prevNewline === undefined || curNewline === undefined) continue;
        const lineStart = ni === 0 ? prevNewline + 1 : prevNewline + 1;
        const lineEnd = curNewline;
        if (lineEnd <= lineStart) continue;

        // Decode only the bytes of this specific line — safe for multibyte chars.
        const line = combined.subarray(lineStart, lineEnd).toString('utf8').trim();
        if (!line) continue;

        let stored: StoredEntry;
        try {
          stored = JSON.parse(line) as StoredEntry;
        } catch {
          // Corrupted / partial line — skip gracefully.
          continue;
        }

        // before-cursor: skip entries not older than the cursor.
        if (before && stored.sentAt >= before) continue;

        // Search: only stored preview is checked — no decompression.
        if (needle) {
          const hit =
            stored.url.toLowerCase().includes(needle) ||
            stored.method.toLowerCase().includes(needle) ||
            (stored.responseBodyPreview ?? '').toLowerCase().includes(needle);
          if (!hit) continue;
        }

        results.push(deserializeMetaOnly(stored));
      }
    }

    // Process the final carry: the very first line in the file (or a partial
    // / corrupted line at byte offset 0). Decode after all carry bytes are
    // accumulated so multibyte chars at the very start are intact.
    if (results.length < limit && carryBuf.length > 0) {
      const line = carryBuf.toString('utf8').trim();
      if (line) {
        try {
          const stored = JSON.parse(line) as StoredEntry;
          const skipBefore = before && stored.sentAt >= before;
          const skipSearch =
            needle &&
            !stored.url.toLowerCase().includes(needle) &&
            !stored.method.toLowerCase().includes(needle) &&
            !(stored.responseBodyPreview ?? '').toLowerCase().includes(needle);
          if (!skipBefore && !skipSearch) {
            results.push(deserializeMetaOnly(stored));
          }
        } catch {
          // Partial / corrupted first line — skip gracefully.
        }
      }
    }
  } finally {
    await fd.close();
  }

  return results;
}

/**
 * Scan the file from the tail backward, looking for an entry with the given
 * ID. When found, returns it with full bodies decompressed.
 */
async function tailFindById(
  file: string,
  fileSize: number,
  id: string,
): Promise<HistoryEntry | null> {
  let remaining = fileSize;
  // Carry raw bytes — same buffer-level approach as tailRead to avoid
  // multibyte UTF-8 corruption when a character straddles a chunk boundary.
  let carryBuf = Buffer.alloc(0);

  const fd = await fsp.open(file, 'r');
  try {
    while (remaining > 0) {
      const chunkSize = Math.min(TAIL_CHUNK_BYTES, remaining);
      remaining -= chunkSize;
      const offset = remaining;

      const buf = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await fd.read(buf, 0, chunkSize, offset);
      if (bytesRead === 0) break;

      const combined = Buffer.concat([buf.subarray(0, bytesRead), carryBuf]);

      const newlineIdx: number[] = [];
      for (let k = 0; k < combined.length; k++) {
        if (combined[k] === 0x0a) newlineIdx.push(k);
      }

      carryBuf =
        newlineIdx.length === 0
          ? combined
          : combined.subarray(0, newlineIdx[0]);

      for (let ni = newlineIdx.length - 1; ni >= 0; ni--) {
        const prevNewline = ni === 0 ? newlineIdx[0] : newlineIdx[ni - 1];
        const curNewline = newlineIdx[ni];
        if (prevNewline === undefined || curNewline === undefined) continue;
        const lineStart = prevNewline + 1;
        const lineEnd = curNewline;
        if (lineEnd <= lineStart) continue;

        const line = combined.subarray(lineStart, lineEnd).toString('utf8').trim();
        if (!line) continue;
        if (!lineContainsId(line, id)) continue;
        try {
          const stored = JSON.parse(line) as StoredEntry;
          if (stored.id === id) {
            return deserializeEntry(stored);
          }
        } catch {
          continue;
        }
      }
    }

    // Check carry (may be the very first line in the file).
    if (carryBuf.length > 0) {
      const line = carryBuf.toString('utf8').trim();
      if (line && lineContainsId(line, id)) {
        try {
          const stored = JSON.parse(line) as StoredEntry;
          if (stored.id === id) {
            return deserializeEntry(stored);
          }
        } catch {
          /* skip */
        }
      }
    }
  } finally {
    await fd.close();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function serializeEntry(entry: HistoryEntry): StoredEntry {
  const out: StoredEntry = { ...entry };
  delete (out as { bodyPreview?: string }).bodyPreview;
  delete (out as { responseBodyPreview?: string }).responseBodyPreview;

  if (entry.bodyPreview) {
    if (Buffer.byteLength(entry.bodyPreview, 'utf8') >= GZIP_THRESHOLD_BYTES) {
      out._bodyGz = gzipSync(Buffer.from(entry.bodyPreview, 'utf8')).toString(
        'base64',
      );
    } else {
      out.bodyPreview = entry.bodyPreview;
    }
  }
  if (entry.responseBodyPreview) {
    if (
      Buffer.byteLength(entry.responseBodyPreview, 'utf8') >=
      GZIP_THRESHOLD_BYTES
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

/**
 * Deserialize a stored entry WITHOUT decompressing _bodyGz / _respGz.
 * Returns metadata + any inline (small) preview only.
 * Used by list() so batches never allocate decompressed body memory.
 */
function deserializeMetaOnly(stored: StoredEntry): HistoryEntry {
  const out = {
    ...stored,
    bodyPreview: stored.bodyPreview ?? '',
    responseBodyPreview: stored.responseBodyPreview ?? '',
  } as HistoryEntry;
  // Remove compressed fields — intentionally not decompressed here.
  delete (out as { _bodyGz?: string })._bodyGz;
  delete (out as { _respGz?: string })._respGz;
  return out;
}

/**
 * Full deserialize — decompresses _bodyGz and _respGz.
 * Only called from getById().
 */
function deserializeEntry(stored: StoredEntry): HistoryEntry {
  let bodyPreview = stored.bodyPreview ?? '';
  if (stored._bodyGz) {
    try {
      bodyPreview = gunzipSync(
        Buffer.from(stored._bodyGz, 'base64'),
      ).toString('utf8');
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
  const out = {
    ...stored,
    bodyPreview,
    responseBodyPreview,
  } as HistoryEntry;
  delete (out as { _bodyGz?: string })._bodyGz;
  delete (out as { _respGz?: string })._respGz;
  return out;
}

/**
 * Quick string check: does this raw JSONL line contain the given id value?
 * Used to skip most lines without a full JSON parse.
 */
function lineContainsId(line: string, id: string): boolean {
  return line.includes(id);
}

function truncate(value: string | undefined, maxBytes: number): string {
  if (!value) return '';
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  // Truncate to whole code units — good enough for text previews.
  const buf = Buffer.from(value, 'utf8').subarray(0, maxBytes);
  return buf.toString('utf8');
}
