import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalsFs } from '../src/workspace/globals.js';

let tmp: string;
let globals: GlobalsFs;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-globals-'));
  globals = new GlobalsFs(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('GlobalsFs', () => {
  it('returns empty variables when file does not exist', async () => {
    const g = await globals.read();
    expect(g.variables).toEqual([]);
  });

  it('writes and reads back global variables', async () => {
    await globals.write({
      variables: [
        { key: 'BASE_URL', value: 'https://api.example.com', enabled: true, secret: false },
        { key: 'API_TOKEN', value: 'tok-xxx', enabled: true, secret: true },
      ],
    });
    const g = await globals.read();
    expect(g.variables).toHaveLength(2);
    expect(g.variables[0]).toEqual({
      key: 'BASE_URL',
      value: 'https://api.example.com',
      enabled: true,
      secret: false,
    });
    expect(g.variables[1]!.secret).toBe(true);
  });

  it('resolveVariables returns only enabled vars', async () => {
    await globals.write({
      variables: [
        { key: 'A', value: '1', enabled: true, secret: false },
        { key: 'B', value: '2', enabled: false, secret: false },
      ],
    });
    expect(await globals.resolveVariables()).toEqual({ A: '1' });
  });

  it('resolveSecretKeys returns enabled secret keys', async () => {
    await globals.write({
      variables: [
        { key: 'TOKEN', value: 't', enabled: true, secret: true },
        { key: 'URL', value: 'u', enabled: true, secret: false },
        { key: 'DISABLED', value: 'd', enabled: false, secret: true },
      ],
    });
    const keys = await globals.resolveSecretKeys();
    expect(keys.has('TOKEN')).toBe(true);
    expect(keys.has('URL')).toBe(false);
    expect(keys.has('DISABLED')).toBe(false);
  });

  it('round-trips empty variables array', async () => {
    await globals.write({ variables: [] });
    const g = await globals.read();
    expect(g.variables).toEqual([]);
  });

  it('creates .scrapeman/ directory if missing', async () => {
    await globals.write({ variables: [{ key: 'X', value: 'y', enabled: true, secret: false }] });
    const g = await globals.read();
    expect(g.variables[0]!.key).toBe('X');
  });
});
