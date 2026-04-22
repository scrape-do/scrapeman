import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectionFs } from '../src/workspace/collection.js';

let tmp: string;
let collection: CollectionFs;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-coll-'));
  collection = new CollectionFs(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('CollectionFs', () => {
  it('returns empty settings when file does not exist', async () => {
    const s = await collection.read();
    expect(s.variables).toEqual([]);
    expect(s.auth).toBeUndefined();
  });

  it('writes and reads back collection variables', async () => {
    await collection.write({
      variables: [
        { key: 'VERSION', value: 'v2', enabled: true, secret: false },
      ],
    });
    const s = await collection.read();
    expect(s.variables).toHaveLength(1);
    expect(s.variables[0]!.key).toBe('VERSION');
  });

  it('writes and reads back collection auth (bearer)', async () => {
    await collection.write({
      variables: [],
      auth: { type: 'bearer', token: '{{BEARER_TOKEN}}' },
    });
    const s = await collection.read();
    expect(s.auth).toEqual({ type: 'bearer', token: '{{BEARER_TOKEN}}' });
  });

  it('writes and reads back collection auth (basic)', async () => {
    await collection.write({
      variables: [],
      auth: { type: 'basic', username: 'admin', password: '{{pass}}' },
    });
    const s = await collection.read();
    expect(s.auth).toEqual({ type: 'basic', username: 'admin', password: '{{pass}}' });
  });

  it('auth type none is not serialized', async () => {
    await collection.write({ variables: [], auth: { type: 'none' } });
    const s = await collection.read();
    // none auth should not be present after read (not stored)
    expect(s.auth).toBeUndefined();
  });

  it('resolveVariables filters disabled entries', async () => {
    await collection.write({
      variables: [
        { key: 'A', value: '1', enabled: true, secret: false },
        { key: 'B', value: '2', enabled: false, secret: false },
      ],
    });
    expect(await collection.resolveVariables()).toEqual({ A: '1' });
  });

  it('resolveSecretKeys returns only enabled secrets', async () => {
    await collection.write({
      variables: [
        { key: 'TOKEN', value: 't', enabled: true, secret: true },
        { key: 'URL', value: 'u', enabled: true, secret: false },
      ],
    });
    const keys = await collection.resolveSecretKeys();
    expect(keys.has('TOKEN')).toBe(true);
    expect(keys.has('URL')).toBe(false);
  });
});
