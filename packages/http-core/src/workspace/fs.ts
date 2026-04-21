import { promises as fsp } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
import type {
  CollectionFolderNode,
  CollectionNode,
  ScrapemanRequest,
  WorkspaceInfo,
  WorkspaceTree,
} from '@scrapeman/shared-types';
import { parseRequest, type SidecarLoader } from '../format/parse.js';
import { serializeRequest } from '../format/serialize.js';

// Canonical extension for new files. Every write produces a `.sman`.
const REQUEST_EXT = '.sman';
// Legacy extension kept for read-only back-compat. Saving a `.req.yaml`
// migrates it to `.sman` (lazy per-file migration). Longest match first so
// `basename.req.yaml` is matched before `basename.sman`.
const LEGACY_REQUEST_EXT = '.req.yaml';
const REQUEST_EXTS = [REQUEST_EXT, LEGACY_REQUEST_EXT] as const;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.scrapeman']);

/**
 * If `name` ends with any request extension, returns the extension that
 * matched and the extension-less stem. Falls back to null when the file is
 * not a request file.
 */
function matchRequestExt(
  name: string,
): { ext: string; stem: string } | null {
  // Check legacy first because `.req.yaml` is longer than `.sman` and we
  // want the longest match to win (defence against exotic names like
  // `foo.req.yaml.sman`, unlikely but cheap to handle).
  if (name.endsWith(LEGACY_REQUEST_EXT)) {
    return {
      ext: LEGACY_REQUEST_EXT,
      stem: name.slice(0, -LEGACY_REQUEST_EXT.length),
    };
  }
  if (name.endsWith(REQUEST_EXT)) {
    return { ext: REQUEST_EXT, stem: name.slice(0, -REQUEST_EXT.length) };
  }
  return null;
}

export class WorkspaceFs {
  constructor(private readonly root: string) {}

  get workspace(): WorkspaceInfo {
    return { path: this.root, name: basename(this.root) };
  }

  async readTree(): Promise<WorkspaceTree> {
    const root = await this.readFolder('', this.root);
    return { workspace: this.workspace, root };
  }

  async readRequest(relPath: string): Promise<ScrapemanRequest> {
    const absPath = this.resolveSafe(relPath);
    const text = await fsp.readFile(absPath, 'utf8');
    const baseDir = dirname(absPath);
    const loader: SidecarLoader = {
      load: async (sidecarRelPath) => {
        const resolved = resolve(baseDir, sidecarRelPath);
        this.assertInsideRoot(resolved);
        return fsp.readFile(resolved, 'utf8');
      },
    };
    return parseRequest(text, loader);
  }

  /**
   * Writes a request to disk in the `.sman` format.
   *
   * When `relPath` points at a legacy `.req.yaml` file, the new `.sman` file
   * is written first and the legacy file is unlinked afterwards (lazy
   * per-file migration). Returns the final `.sman` relPath so callers can
   * update tab / tree state.
   */
  async writeRequest(relPath: string, request: ScrapemanRequest): Promise<string> {
    const absPathIn = this.resolveSafe(relPath);
    const baseName = basename(absPathIn);
    const match = matchRequestExt(baseName);

    // Determine the target `.sman` path. If we got a legacy `.req.yaml`
    // input, swap the extension; otherwise keep the path as-is (already
    // `.sman` or some other name we will overwrite verbatim).
    let absPath = absPathIn;
    let migratedFromLegacy: string | null = null;
    if (match && match.ext === LEGACY_REQUEST_EXT) {
      absPath = join(dirname(absPathIn), match.stem + REQUEST_EXT);
      migratedFromLegacy = absPathIn;
    }

    const slug = slugify(match ? match.stem : basename(absPath, REQUEST_EXT));
    const { yaml, sidecars } = serializeRequest(request, slug);
    await fsp.mkdir(dirname(absPath), { recursive: true });
    await atomicWrite(absPath, yaml);
    for (const sidecar of sidecars) {
      const sidecarAbs = resolve(dirname(absPath), sidecar.relPath);
      this.assertInsideRoot(sidecarAbs);
      await fsp.mkdir(dirname(sidecarAbs), { recursive: true });
      const bytes =
        typeof sidecar.content === 'string'
          ? Buffer.from(sidecar.content, 'utf8')
          : Buffer.from(sidecar.content);
      await atomicWrite(sidecarAbs, bytes);
    }

    // Remove the legacy file only after the new `.sman` is safely on disk.
    // A failure here leaves both files; the next tree read resolves the
    // collision in favour of `.sman` (see readFolder).
    if (migratedFromLegacy) {
      try {
        await fsp.unlink(migratedFromLegacy);
      } catch (err) {
        // ENOENT is benign: another process may have removed it; anything
        // else (EACCES, EPERM) means the legacy file stays put. Readers
        // will still prefer the `.sman`, so nothing is lost.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[scrapeman] legacy .req.yaml unlink failed:', err);
        }
      }
    }

    return this.toRel(absPath);
  }

  async createFolder(parentRelPath: string, name: string): Promise<string> {
    const safeName = slugify(name);
    const parentAbs = this.resolveSafe(parentRelPath);
    const finalName = await uniqueName(parentAbs, safeName, '');
    const absPath = join(parentAbs, finalName);
    await fsp.mkdir(absPath, { recursive: false });
    return this.toRel(absPath);
  }

  async createRequest(parentRelPath: string, name: string): Promise<string> {
    const safeName = slugify(name);
    const parentAbs = this.resolveSafe(parentRelPath);
    await fsp.mkdir(parentAbs, { recursive: true });
    const finalName = await uniqueName(parentAbs, safeName, REQUEST_EXT);
    const absPath = join(parentAbs, finalName + REQUEST_EXT);
    const stub: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name },
      method: 'GET',
      url: 'https://example.com',
    };
    const { yaml } = serializeRequest(stub, safeName);
    await atomicWrite(absPath, yaml);
    return this.toRel(absPath);
  }

  async rename(relPath: string, newName: string): Promise<string> {
    const absOld = this.resolveSafe(relPath);
    const stat = await fsp.stat(absOld);
    const parent = dirname(absOld);
    const safeName = slugify(newName);
    // Keep whatever extension the file currently has. Legacy `.req.yaml`
    // files stay legacy through rename — migration only happens on save.
    const match = stat.isFile() ? matchRequestExt(basename(absOld)) : null;
    const ext = match ? match.ext : '';
    const finalName = await uniqueName(parent, safeName, ext);
    const absNew = join(parent, finalName + ext);
    await fsp.rename(absOld, absNew);
    return this.toRel(absNew);
  }

  async delete(relPath: string): Promise<void> {
    if (relPath === '' || relPath === '.') {
      throw new Error('cannot delete workspace root');
    }
    const abs = this.resolveSafe(relPath);
    await fsp.rm(abs, { recursive: true, force: true });
  }

  async move(relPath: string, newParentRelPath: string): Promise<string> {
    const absOld = this.resolveSafe(relPath);
    const absNewParent = this.resolveSafe(newParentRelPath);
    if (absOld === absNewParent) {
      return this.toRel(absOld);
    }
    const oldParent = dirname(absOld);
    if (oldParent === absNewParent) {
      return this.toRel(absOld);
    }
    // Prevent moving a folder into itself or its descendants.
    const stat = await fsp.stat(absOld);
    if (stat.isDirectory()) {
      const rel = relative(absOld, absNewParent);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
        throw new Error('cannot move a folder into itself');
      }
    }
    await fsp.mkdir(absNewParent, { recursive: true });
    const absNew = join(absNewParent, basename(absOld));
    try {
      await fsp.access(absNew);
      throw new Error(`destination already exists: ${basename(absOld)}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    // If we're moving a request file, relocate its referenced sidecars too.
    const sidecarMoves: Array<{ from: string; to: string }> = [];
    if (stat.isFile() && matchRequestExt(basename(absOld))) {
      const text = await fsp.readFile(absOld, 'utf8');
      for (const ref of extractFileRefs(text)) {
        if (isAbsolute(ref)) continue;
        const fromAbs = resolve(oldParent, ref);
        try {
          this.assertInsideRoot(fromAbs);
        } catch {
          continue;
        }
        try {
          await fsp.access(fromAbs);
        } catch {
          continue;
        }
        const toAbs = resolve(absNewParent, ref);
        this.assertInsideRoot(toAbs);
        sidecarMoves.push({ from: fromAbs, to: toAbs });
      }
    }

    for (const { to } of sidecarMoves) {
      try {
        await fsp.access(to);
        throw new Error(`sidecar destination already exists: ${to}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }

    await fsp.rename(absOld, absNew);
    for (const { from, to } of sidecarMoves) {
      await fsp.mkdir(dirname(to), { recursive: true });
      await fsp.rename(from, to);
    }
    return this.toRel(absNew);
  }

  private async readFolder(relPath: string, absPath: string): Promise<CollectionFolderNode> {
    const entries = await fsp.readdir(absPath, { withFileTypes: true });
    const children: CollectionNode[] = [];
    // Track request stems we've already seen to resolve `.sman` vs `.req.yaml`
    // collisions in favour of `.sman`.
    const requestStems = new Set<string>();
    // First pass: record every `.sman` stem so we can skip legacy `.req.yaml`
    // files with a matching stem in the second pass.
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(REQUEST_EXT)) {
        requestStems.add(entry.name.slice(0, -REQUEST_EXT.length));
      }
    }

    for (const entry of entries) {
      const entryAbs = join(absPath, entry.name);
      const entryRel = posixRelative(this.root, entryAbs);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        children.push(await this.readFolder(entryRel, entryAbs));
      } else if (entry.isFile()) {
        const match = matchRequestExt(entry.name);
        if (!match) continue;
        // Collision: if both `foo.sman` and `foo.req.yaml` exist, the newer
        // `.sman` wins and the legacy file is hidden from the tree.
        if (match.ext === LEGACY_REQUEST_EXT && requestStems.has(match.stem)) {
          continue;
        }
        const method = await peekMethod(entryAbs);
        children.push({
          kind: 'request',
          id: stableId(entryRel),
          name: match.stem,
          relPath: entryRel,
          method,
        });
      }
    }

    children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      kind: 'folder',
      id: stableId(relPath || '.'),
      name: relPath === '' ? basename(this.root) : basename(absPath),
      relPath,
      children,
    };
  }

  private resolveSafe(relPath: string): string {
    const absPath =
      relPath === '' || relPath === '.'
        ? this.root
        : resolve(this.root, relPath);
    this.assertInsideRoot(absPath);
    return absPath;
  }

  private assertInsideRoot(absPath: string): void {
    const rel = relative(this.root, absPath);
    if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
      throw new Error(`path escapes workspace root: ${absPath}`);
    }
  }

  private toRel(absPath: string): string {
    return posixRelative(this.root, absPath);
  }
}

async function atomicWrite(absPath: string, data: string | Buffer): Promise<void> {
  const tmp = `${absPath}.tmp-${randomUUID()}`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, absPath);
}

async function uniqueName(parentAbs: string, base: string, ext: string): Promise<string> {
  const entries = await safeReaddir(parentAbs);
  const taken = new Set(entries);
  // For request files the `ext` is `.sman`, but a legacy `.req.yaml` with
  // the same stem would be shadowed by the new `.sman` (and then migrated
  // on next save). To avoid surprising the user, we treat both extensions
  // as taken when picking a unique request name.
  const isRequest =
    ext === REQUEST_EXT || (REQUEST_EXTS as readonly string[]).includes(ext);
  const isTaken = (candidate: string): boolean => {
    if (taken.has(candidate + ext)) return true;
    if (isRequest) {
      for (const otherExt of REQUEST_EXTS) {
        if (otherExt === ext) continue;
        if (taken.has(candidate + otherExt)) return true;
      }
    }
    return false;
  };
  if (!isTaken(base)) return base;
  let i = 2;
  while (isTaken(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

async function safeReaddir(absPath: string): Promise<string[]> {
  try {
    return await fsp.readdir(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function peekMethod(absPath: string): Promise<string> {
  try {
    const text = await fsp.readFile(absPath, 'utf8');
    const match = /^method:\s*(.+)$/m.exec(text);
    if (match && match[1]) return match[1].trim().replace(/^"(.*)"$/, '$1');
  } catch {
    /* ignore */
  }
  return 'GET';
}

function slugify(name: string): string {
  const trimmed = name.trim().replace(/[\\/]/g, '-');
  const slug = trimmed.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

function stableId(relPath: string): string {
  return `n_${Buffer.from(relPath).toString('base64url')}`;
}

function extractFileRefs(yamlText: string): string[] {
  // Grab every `file: <value>` line. Sidecar-backed bodies (json/xml/text/html/js),
  // binary bodies, and multipart file parts all serialize this way.
  const refs: string[] = [];
  const re = /^\s*file:\s*(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yamlText)) !== null) {
    let value = m[1]!;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) refs.push(value);
  }
  return refs;
}

function posixRelative(from: string, to: string): string {
  const rel = relative(from, to);
  return rel.split(sep).join(posix.sep);
}
