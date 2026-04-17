import {
  FORMAT_VERSION,
  type ScrapemanRequest,
  type ImportResult,
  type ImportFolder,
  type AuthConfig,
  type BodyConfig,
  type KeyValue,
} from '@scrapeman/shared-types';

// HTTP methods that Bruno uses as block names.
const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
]);

/**
 * A parsed block from the .bru file.
 * `name` is the block identifier (e.g. "meta", "get", "auth:bearer").
 * `lines` are raw content lines inside the braces.
 */
interface BruBlock {
  name: string;
  lines: string[];
}

// ---------------------------------------------------------------------------
// Block-level parser
// ---------------------------------------------------------------------------

/**
 * Parse .bru text into a list of named blocks.
 * Blocks use the form `name { ... }` where `name` may contain colons
 * (e.g. `auth:bearer`, `body:json`). Content between closing `}` and the
 * next block opener is ignored.
 */
function parseBlocks(content: string): BruBlock[] {
  const blocks: BruBlock[] = [];
  const lines = content.split('\n');
  let current: BruBlock | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (current === null) {
      // Look for block opener: `blockname {` or `blockname:sub {`
      const match = line.match(/^([\w:._-]+)\s*\{$/);
      if (match) {
        current = { name: match[1]!, lines: [] };
      }
      continue;
    }

    // Inside a block — the closing brace must be at column 0 (unindented).
    // This distinguishes it from `}` inside body content (which is indented).
    if (line === '}') {
      blocks.push(current);
      current = null;
      continue;
    }

    current.lines.push(line);
  }

  // If the file ends without closing a block, push what we have.
  if (current) {
    blocks.push(current);
  }

  return blocks;
}

/**
 * Parse key-value pairs from block lines.
 * Format: `  key: value` — the first `: ` is the separator.
 * Lines that do not match are skipped.
 */
function parseKV(lines: string[]): KeyValue {
  const kv: KeyValue = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    kv[key] = value;
  }
  return kv;
}

/**
 * Get raw body content from block lines, preserving internal formatting.
 * Strips common leading whitespace (2-space indent that Bruno typically adds).
 */
function getRawBody(lines: string[]): string {
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Single-file parser
// ---------------------------------------------------------------------------

interface ParsedBruFile {
  request: ScrapemanRequest;
  warnings: string[];
}

function parseBruFile(content: string, fileName: string): ParsedBruFile {
  const blocks = parseBlocks(content);
  const warnings: string[] = [];

  // Defaults
  let name = fileName.replace(/\.bru$/, '');
  let method = 'GET';
  let url = '';
  const headers: KeyValue = {};
  let auth: AuthConfig | undefined;
  let body: BodyConfig | undefined;
  const params: KeyValue = {};

  for (const block of blocks) {
    const bname = block.name.toLowerCase();

    if (bname === 'meta') {
      const kv = parseKV(block.lines);
      if (kv['name']) name = kv['name'];
      continue;
    }

    // HTTP method blocks: get, post, put, etc.
    if (HTTP_METHODS.has(bname)) {
      method = bname.toUpperCase();
      const kv = parseKV(block.lines);
      if (kv['url']) url = kv['url'];
      continue;
    }

    if (bname === 'headers') {
      const kv = parseKV(block.lines);
      Object.assign(headers, kv);
      continue;
    }

    if (bname === 'params:query' || bname === 'query') {
      const kv = parseKV(block.lines);
      Object.assign(params, kv);
      continue;
    }

    if (bname === 'params:path') {
      // Path params in Bruno are template variables — store as params.
      const kv = parseKV(block.lines);
      Object.assign(params, kv);
      continue;
    }

    if (bname === 'auth:bearer') {
      const kv = parseKV(block.lines);
      auth = { type: 'bearer', token: kv['token'] ?? '' };
      continue;
    }

    if (bname === 'auth:basic') {
      const kv = parseKV(block.lines);
      auth = {
        type: 'basic',
        username: kv['username'] ?? '',
        password: kv['password'] ?? '',
      };
      continue;
    }

    if (bname === 'body:json') {
      body = { type: 'json', content: getRawBody(block.lines) };
      continue;
    }

    if (bname === 'body:xml') {
      body = { type: 'xml', content: getRawBody(block.lines) };
      continue;
    }

    if (bname === 'body:text') {
      body = { type: 'text', content: getRawBody(block.lines) };
      continue;
    }

    if (bname === 'body:form-urlencoded') {
      const kv = parseKV(block.lines);
      body = { type: 'formUrlEncoded', fields: kv };
      continue;
    }

    if (bname === 'body:multipart-form') {
      // Best-effort: treat as key-value text parts
      const kv = parseKV(block.lines);
      body = {
        type: 'multipart',
        parts: Object.entries(kv).map(([k, v]) => ({
          name: k,
          type: 'text' as const,
          value: v,
        })),
      };
      continue;
    }

    // Known blocks we parse but don't act on beyond warnings
    if (
      bname === 'vars:pre-request' ||
      bname === 'vars:post-response' ||
      bname === 'script:pre-request' ||
      bname === 'script:post-response' ||
      bname === 'tests' ||
      bname === 'docs' ||
      bname === 'assert'
    ) {
      if (
        bname !== 'vars:pre-request' &&
        bname !== 'vars:post-response'
      ) {
        warnings.push(
          `Unsupported block "${block.name}" in ${fileName} — skipped`,
        );
      }
      continue;
    }

    // Catch-all for truly unknown blocks
    if (bname !== 'meta') {
      warnings.push(
        `Unknown block "${block.name}" in ${fileName} — skipped`,
      );
    }
  }

  const request: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name },
    method,
    url,
  };

  if (Object.keys(headers).length > 0) request.headers = headers;
  if (Object.keys(params).length > 0) request.params = params;
  if (auth) request.auth = auth;
  if (body) request.body = body;

  return { request, warnings };
}

// ---------------------------------------------------------------------------
// Folder tree builder
// ---------------------------------------------------------------------------

/**
 * Import a Bruno collection from an array of file path + content pairs.
 * The caller is responsible for reading the filesystem; this function is pure.
 *
 * File paths should use forward slashes and be relative to the collection root.
 * Example: `["users/get-all.bru", "users/create.bru", "health.bru"]`
 */
export function importBrunoFolder(
  files: Array<{ path: string; content: string }>,
): ImportResult {
  const allWarnings: string[] = [];
  // Map from directory path ('' for root) to its folder node.
  const folderMap = new Map<string, ImportFolder>();

  // Ensure a folder node exists for the given directory path, creating parents as needed.
  function ensureFolder(dirPath: string): ImportFolder {
    if (folderMap.has(dirPath)) return folderMap.get(dirPath)!;

    const parts = dirPath.split('/').filter(Boolean);
    const name = parts[parts.length - 1] ?? '';
    const folder: ImportFolder = { name, requests: [], folders: [] };
    folderMap.set(dirPath, folder);

    // Link to parent: either the root or an intermediate folder.
    if (parts.length === 1) {
      const r = folderMap.get('')!;
      if (!r.folders.includes(folder)) {
        r.folders.push(folder);
      }
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = ensureFolder(parentPath);
      if (!parent.folders.includes(folder)) {
        parent.folders.push(folder);
      }
    }

    return folder;
  }

  // Root folder
  const root: ImportFolder = { name: '', requests: [], folders: [] };
  folderMap.set('', root);

  // Sort files by path so folder ordering is deterministic.
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    // Normalize path separators
    const normalizedPath = file.path.replace(/\\/g, '/');
    if (!normalizedPath.endsWith('.bru')) continue;

    const fileName = normalizedPath.split('/').pop()!;
    const dirParts = normalizedPath.split('/').slice(0, -1);
    const dirPath = dirParts.join('/');

    const { request, warnings } = parseBruFile(file.content, fileName);
    allWarnings.push(...warnings);

    if (dirPath === '') {
      root.requests.push(request);
    } else {
      const folder = ensureFolder(dirPath);
      folder.requests.push(request);
    }
  }

  return {
    requests: root.requests,
    folders: root.folders,
    environments: [],
    warnings: allWarnings,
  };
}
