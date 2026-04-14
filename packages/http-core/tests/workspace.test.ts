import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
    expect(relPath).toMatch(/\.req\.yaml$/);

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
