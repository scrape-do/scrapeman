import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalsFs } from '../src/workspace/globals.js';
import { CollectionFs } from '../src/workspace/collection.js';
import { EnvironmentsFs } from '../src/workspace/environments.js';
import { FolderSettingsFs } from '../src/workspace/folder-settings.js';
import { ScopedVariableResolver } from '../src/workspace/resolve-variables.js';

let tmp: string;
let resolver: ScopedVariableResolver;
let globals: GlobalsFs;
let collection: CollectionFs;
let envs: EnvironmentsFs;
let folders: FolderSettingsFs;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-resolve-'));
  resolver = new ScopedVariableResolver(tmp);
  globals = new GlobalsFs(tmp);
  collection = new CollectionFs(tmp);
  envs = new EnvironmentsFs(tmp);
  folders = new FolderSettingsFs(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('ScopedVariableResolver — precedence', () => {
  it('merges global < collection < env < folder (highest wins)', async () => {
    // KEY is defined at every scope; ENV_ONLY and FOLDER_ONLY at their scopes.
    await globals.write({
      variables: [
        { key: 'KEY', value: 'global', enabled: true, secret: false },
        { key: 'GLOBAL_ONLY', value: 'g', enabled: true, secret: false },
      ],
    });
    await collection.write({
      variables: [
        { key: 'KEY', value: 'collection', enabled: true, secret: false },
        { key: 'COLL_ONLY', value: 'c', enabled: true, secret: false },
      ],
    });
    await envs.writeEnvironment({
      name: 'dev',
      variables: [
        { key: 'KEY', value: 'env', enabled: true, secret: false },
        { key: 'ENV_ONLY', value: 'e', enabled: true, secret: false },
      ],
    });
    await folders.write('api', {
      variables: [
        { key: 'KEY', value: 'folder', enabled: true, secret: false },
        { key: 'FOLDER_ONLY', value: 'f', enabled: true, secret: false },
      ],
    });

    const result = await resolver.resolve('api/get-users.sman', 'dev');
    expect(result.variables['KEY']).toBe('folder');
    expect(result.variables['GLOBAL_ONLY']).toBe('g');
    expect(result.variables['COLL_ONLY']).toBe('c');
    expect(result.variables['ENV_ONLY']).toBe('e');
    expect(result.variables['FOLDER_ONLY']).toBe('f');
  });

  it('uses only globals + collection + env when no folder settings exist', async () => {
    await globals.write({ variables: [{ key: 'G', value: '1', enabled: true, secret: false }] });
    await collection.write({ variables: [{ key: 'C', value: '2', enabled: true, secret: false }] });
    await envs.writeEnvironment({ name: 'prod', variables: [{ key: 'E', value: '3', enabled: true, secret: false }] });

    const result = await resolver.resolve('root-request.sman', 'prod');
    expect(result.variables).toEqual({ G: '1', C: '2', E: '3' });
  });

  it('resolves with no active env (null) — only globals + collection + folders', async () => {
    await globals.write({ variables: [{ key: 'G', value: 'global', enabled: true, secret: false }] });
    const result = await resolver.resolve('req.sman', null);
    expect(result.variables['G']).toBe('global');
  });

  it('folder chain: deeper folder overrides shallower', async () => {
    await folders.write('api', {
      variables: [{ key: 'X', value: 'shallow', enabled: true, secret: false }],
    });
    await folders.write('api/users', {
      variables: [{ key: 'X', value: 'deep', enabled: true, secret: false }],
    });

    const result = await resolver.resolve('api/users/get.sman', null);
    expect(result.variables['X']).toBe('deep');
  });

  it('merges secretKeys from all scopes', async () => {
    await globals.write({ variables: [{ key: 'G_SECRET', value: 'x', enabled: true, secret: true }] });
    await collection.write({ variables: [{ key: 'C_SECRET', value: 'x', enabled: true, secret: true }] });
    await envs.writeEnvironment({ name: 'test', variables: [{ key: 'E_SECRET', value: 'x', enabled: true, secret: true }] });

    const result = await resolver.resolve('req.sman', 'test');
    expect(result.secretKeys.has('G_SECRET')).toBe(true);
    expect(result.secretKeys.has('C_SECRET')).toBe(true);
    expect(result.secretKeys.has('E_SECRET')).toBe(true);
  });
});

describe('ScopedVariableResolver — auth inheritance', () => {
  it('returns undefined inheritedAuth when no ancestor defines auth', async () => {
    const result = await resolver.resolve('api/get.sman', null);
    expect(result.inheritedAuth).toBeUndefined();
  });

  it('inherits auth from nearest folder ancestor', async () => {
    await folders.write('api', {
      variables: [],
      auth: { type: 'bearer', token: '{{TOKEN}}' },
    });

    const result = await resolver.resolve('api/users/list.sman', null);
    expect(result.inheritedAuth).toEqual({ type: 'bearer', token: '{{TOKEN}}' });
    expect(result.inheritedAuthSource).toBe('api');
  });

  it('nearer folder auth wins over farther folder auth', async () => {
    await folders.write('api', {
      variables: [],
      auth: { type: 'bearer', token: 'outer' },
    });
    await folders.write('api/users', {
      variables: [],
      auth: { type: 'bearer', token: 'inner' },
    });

    const result = await resolver.resolve('api/users/get.sman', null);
    expect((result.inheritedAuth as { token: string }).token).toBe('inner');
    expect(result.inheritedAuthSource).toBe('api/users');
  });

  it('falls back to collection auth when no folder auth', async () => {
    await collection.write({
      variables: [],
      auth: { type: 'basic', username: 'admin', password: 'pw' },
    });

    const result = await resolver.resolve('some/deep/request.sman', null);
    expect(result.inheritedAuth).toEqual({
      type: 'basic',
      username: 'admin',
      password: 'pw',
    });
    expect(result.inheritedAuthSource).toBe('.scrapeman/collection.yaml');
  });

  it('folder auth takes precedence over collection auth', async () => {
    await collection.write({
      variables: [],
      auth: { type: 'bearer', token: 'collection-token' },
    });
    await folders.write('api', {
      variables: [],
      auth: { type: 'apiKey', key: 'X-Key', value: 'fk', in: 'header' },
    });

    const result = await resolver.resolve('api/req.sman', null);
    expect(result.inheritedAuth?.type).toBe('apiKey');
  });
});
