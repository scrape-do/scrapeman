import { promises as fsp } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
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

const REQUEST_EXT = '.req.yaml';
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.scrapeman']);

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

  async writeRequest(relPath: string, request: ScrapemanRequest): Promise<void> {
    const absPath = this.resolveSafe(relPath);
    const slug = slugify(basename(relPath, REQUEST_EXT));
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
    const ext = stat.isFile() && absOld.endsWith(REQUEST_EXT) ? REQUEST_EXT : '';
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
    await fsp.mkdir(absNewParent, { recursive: true });
    const absNew = join(absNewParent, basename(absOld));
    await fsp.rename(absOld, absNew);
    return this.toRel(absNew);
  }

  private async readFolder(relPath: string, absPath: string): Promise<CollectionFolderNode> {
    const entries = await fsp.readdir(absPath, { withFileTypes: true });
    const children: CollectionNode[] = [];

    for (const entry of entries) {
      const entryAbs = join(absPath, entry.name);
      const entryRel = posixRelative(this.root, entryAbs);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        children.push(await this.readFolder(entryRel, entryAbs));
      } else if (entry.isFile() && entry.name.endsWith(REQUEST_EXT)) {
        const method = await peekMethod(entryAbs);
        children.push({
          kind: 'request',
          id: stableId(entryRel),
          name: entry.name.slice(0, -REQUEST_EXT.length),
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
  if (!taken.has(base + ext)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}${ext}`)) i++;
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

function posixRelative(from: string, to: string): string {
  const rel = relative(from, to);
  return rel.split(sep).join(posix.sep);
}
