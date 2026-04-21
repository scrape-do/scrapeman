import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { WorkspaceFs } from '../src/workspace/fs.js';

let tmp: string;
let fs: WorkspaceFs;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-ws-'));
  fs = new WorkspaceFs(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function makeRequest(name: string): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name },
    method: 'GET',
    url: 'https://example.com',
  };
}

describe('WorkspaceFs', () => {
  it('creates a request and reads it back', async () => {
    const relPath = await fs.createRequest('', 'Health check');
    expect(relPath).toMatch(/\.sman$/);

    const tree = await fs.readTree();
    expect(tree.root.children).toHaveLength(1);
    const child = tree.root.children[0]!;
    expect(child.kind).toBe('request');
    expect(child.name).toBe('Health-check');

    const request = await fs.readRequest(relPath);
    expect(request.meta.name).toBe('Health check');
    expect(request.method).toBe('GET');
  });

  it('creates nested folders and lists tree in stable order', async () => {
    const folderA = await fs.createFolder('', 'Users');
    const folderB = await fs.createFolder('', 'Products');
    await fs.createRequest(folderA, 'List users');
    await fs.createRequest(folderB, 'List products');
    await fs.createRequest('', 'Root request');

    const tree = await fs.readTree();
    const names = tree.root.children.map((c) => c.name);
    // folders come first, then requests; each alphabetical
    expect(names).toEqual(['Products', 'Users', 'Root-request']);
  });

  it('round-trips a request through write + read', async () => {
    const relPath = await fs.createRequest('', 'Target');
    const updated = makeRequest('Target');
    updated.method = 'POST';
    updated.url = 'https://api.example.com/things';
    updated.headers = { 'Content-Type': 'application/json' };
    updated.body = { type: 'json', content: '{"hello":"world"}' };

    await fs.writeRequest(relPath, updated);
    const readBack = await fs.readRequest(relPath);
    expect(readBack).toEqual(updated);
  });

  it('renames a folder', async () => {
    const orig = await fs.createFolder('', 'Old');
    const renamed = await fs.rename(orig, 'New');
    expect(renamed).toBe('New');

    const tree = await fs.readTree();
    expect(tree.root.children.map((c) => c.name)).toEqual(['New']);
  });

  it('deletes a request', async () => {
    const relPath = await fs.createRequest('', 'DeleteMe');
    await fs.delete(relPath);
    const tree = await fs.readTree();
    expect(tree.root.children).toHaveLength(0);
  });

  it('refuses to delete the workspace root', async () => {
    await expect(fs.delete('')).rejects.toThrow(/workspace root/);
  });

  it('rejects paths outside the workspace root', async () => {
    await expect(fs.readRequest('../../etc/passwd')).rejects.toThrow(/escapes/);
  });

  it('promotes large body to sidecar on disk', async () => {
    const relPath = await fs.createRequest('', 'BigBody');
    const bigBody = 'x'.repeat(5000);
    const req = makeRequest('BigBody');
    req.body = { type: 'json', content: bigBody };
    await fs.writeRequest(relPath, req);

    const readBack = await fs.readRequest(relPath);
    expect(readBack.body).toEqual({
      type: 'json',
      content: bigBody,
      file: 'files/BigBody.body.json',
    });
  });

  it('moves a request into a folder', async () => {
    const requestPath = await fs.createRequest('', 'Mover');
    const folderPath = await fs.createFolder('', 'Destination');
    const movedPath = await fs.move(requestPath, folderPath);
    expect(movedPath.startsWith(folderPath)).toBe(true);
  });

  it('moves a sidecar body alongside its request', async () => {
    const requestPath = await fs.createRequest('', 'BigMover');
    const req = makeRequest('BigMover');
    req.body = { type: 'json', content: 'x'.repeat(5000) };
    await fs.writeRequest(requestPath, req);

    const folderPath = await fs.createFolder('', 'Dest');
    const movedPath = await fs.move(requestPath, folderPath);

    const readBack = await fs.readRequest(movedPath);
    expect(readBack.body).toMatchObject({
      type: 'json',
      content: 'x'.repeat(5000),
    });
  });

  it('refuses to move when destination already has a same-named file', async () => {
    const requestA = await fs.createRequest('', 'Dup');
    const folder = await fs.createFolder('', 'Bucket');
    await fs.createRequest(folder, 'Dup');
    await expect(fs.move(requestA, folder)).rejects.toThrow(/already exists/);
  });
});

describe('WorkspaceFs dual-format (`.req.yaml` + `.sman`)', () => {
  // Helper: write a legacy `.req.yaml` file directly on disk so we exercise
  // the reader / migration paths without going through createRequest (which
  // only emits `.sman` now).
  async function writeLegacy(
    relPath: string,
    request: ScrapemanRequest,
  ): Promise<void> {
    const abs = join(tmp, relPath);
    await mkdir(join(abs, '..'), { recursive: true });
    // Use version 1.0 to mimic files produced before the rename.
    const body = [
      'scrapeman: "1.0"',
      'meta:',
      `  name: ${JSON.stringify(request.meta.name)}`,
      `method: ${request.method}`,
      `url: ${JSON.stringify(request.url)}`,
    ].join('\n');
    await writeFile(abs, body + '\n', 'utf8');
  }

  it('reads a legacy `.req.yaml` file (version 1.0) through readRequest', async () => {
    await writeLegacy('legacy.req.yaml', {
      scrapeman: '1.0',
      meta: { name: 'Legacy' },
      method: 'GET',
      url: 'https://example.com',
    });
    const req = await fs.readRequest('legacy.req.yaml');
    expect(req.meta.name).toBe('Legacy');
    // Reader normalizes to the current writer version.
    expect(req.scrapeman).toBe(FORMAT_VERSION);
  });

  it('lists both `.sman` and `.req.yaml` files in the tree', async () => {
    await fs.createRequest('', 'NewOne'); // → NewOne.sman
    await writeLegacy('old.req.yaml', {
      scrapeman: '1.0',
      meta: { name: 'Old' },
      method: 'GET',
      url: 'https://example.com',
    });
    const tree = await fs.readTree();
    const names = tree.root.children.map((c) => c.name).sort();
    expect(names).toEqual(['NewOne', 'old']);
  });

  it('hides the legacy file when both `.sman` and `.req.yaml` share a stem', async () => {
    const newRel = await fs.createRequest('', 'dup'); // dup.sman
    await writeLegacy('dup.req.yaml', {
      scrapeman: '1.0',
      meta: { name: 'Legacy Dup' },
      method: 'GET',
      url: 'https://example.com',
    });
    const tree = await fs.readTree();
    const names = tree.root.children.map((c) => c.name);
    // Only one entry is listed and it points at the `.sman` file.
    expect(names).toEqual(['dup']);
    const entry = tree.root.children[0]!;
    expect(entry.relPath).toBe(newRel);
  });

  it('migrates `.req.yaml` → `.sman` on save and deletes the legacy file', async () => {
    await writeLegacy('migrate.req.yaml', {
      scrapeman: '1.0',
      meta: { name: 'Migrate' },
      method: 'GET',
      url: 'https://example.com',
    });
    const req = await fs.readRequest('migrate.req.yaml');
    req.method = 'POST';
    const newRel = await fs.writeRequest('migrate.req.yaml', req);
    expect(newRel).toBe('migrate.sman');

    // New `.sman` exists, legacy is gone.
    await expect(access(join(tmp, 'migrate.sman'))).resolves.toBeUndefined();
    await expect(access(join(tmp, 'migrate.req.yaml'))).rejects.toThrow();

    // The new file carries the current writer version.
    const smanText = await readFile(join(tmp, 'migrate.sman'), 'utf8');
    expect(smanText).toMatch(/scrapeman: "2\.0"/);
  });

  it('preserves sidecar files when migrating `.req.yaml` → `.sman`', async () => {
    // Seed a legacy file plus its sidecar body to prove sidecars survive
    // migration (the spec says sidecar paths stay put).
    await writeFile(
      join(tmp, 'big.req.yaml'),
      [
        'scrapeman: "1.0"',
        'meta:',
        '  name: Big',
        'method: POST',
        'url: "https://example.com"',
        'body:',
        '  type: json',
        '  file: files/Big.body.json',
      ].join('\n') + '\n',
      'utf8',
    );
    await mkdir(join(tmp, 'files'), { recursive: true });
    await writeFile(join(tmp, 'files/Big.body.json'), '{"hello":"world"}', 'utf8');

    const req = await fs.readRequest('big.req.yaml');
    const newRel = await fs.writeRequest('big.req.yaml', req);
    expect(newRel).toBe('big.sman');

    // Sidecar stays at its original path and still loads correctly.
    const readBack = await fs.readRequest(newRel);
    expect(readBack.body).toEqual({
      type: 'json',
      content: '{"hello":"world"}',
      file: 'files/Big.body.json',
    });
  });

  it('writing an already-`.sman` path does not delete any legacy file next to it', async () => {
    // If both files exist and we save to the `.sman` path (the one returned
    // by the tree), the legacy file must be left alone — only writes that
    // START from the legacy path trigger cleanup.
    await writeLegacy('shared.req.yaml', {
      scrapeman: '1.0',
      meta: { name: 'Shared' },
      method: 'GET',
      url: 'https://example.com',
    });
    const smanRel = await fs.createRequest('', 'shared'); // picks up legacy → shared-2.sman
    expect(smanRel).toBe('shared-2.sman');

    // writeRequest on the `.sman` path: legacy should still be present.
    const req = await fs.readRequest(smanRel);
    await fs.writeRequest(smanRel, req);
    await expect(access(join(tmp, 'shared.req.yaml'))).resolves.toBeUndefined();
  });

  it('createRequest picks a unique name against legacy `.req.yaml` collisions', async () => {
    await writeLegacy('taken.req.yaml', {
      scrapeman: '1.0',
      meta: { name: 'Taken' },
      method: 'GET',
      url: 'https://example.com',
    });
    const newRel = await fs.createRequest('', 'taken');
    // Must not be `taken.sman` because that would shadow the legacy file.
    expect(newRel).toBe('taken-2.sman');
  });

  it('rename preserves a legacy `.req.yaml` extension', async () => {
    await writeLegacy('old.req.yaml', {
      scrapeman: '1.0',
      meta: { name: 'Old' },
      method: 'GET',
      url: 'https://example.com',
    });
    const renamed = await fs.rename('old.req.yaml', 'renamed');
    expect(renamed).toBe('renamed.req.yaml');
  });
});
