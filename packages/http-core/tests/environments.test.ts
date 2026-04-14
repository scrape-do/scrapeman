import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnvironmentsFs } from '../src/workspace/environments.js';

let tmp: string;
let envs: EnvironmentsFs;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-env-'));
  envs = new EnvironmentsFs(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('EnvironmentsFs', () => {
  it('returns an empty list when the env dir does not exist', async () => {
    expect(await envs.listEnvironments()).toEqual([]);
  });

  it('writes and reads back an environment', async () => {
    await envs.writeEnvironment({
      name: 'development',
      variables: [
        { key: 'baseUrl', value: 'https://api-dev.example.com', enabled: true, secret: false },
        { key: 'token', value: 'dev-token-123', enabled: true, secret: true },
      ],
    });
    const env = await envs.readEnvironment('development');
    expect(env).not.toBeNull();
    expect(env!.name).toBe('development');
    expect(env!.variables).toHaveLength(2);
    expect(env!.variables[0]).toEqual({
      key: 'baseUrl',
      value: 'https://api-dev.example.com',
      enabled: true,
      secret: false,
    });
    expect(env!.variables[1]!.secret).toBe(true);
  });

  it('persists an empty environment created from the UI', async () => {
    await envs.writeEnvironment({ name: 'staging', variables: [] });
    const list = await envs.listEnvironments();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('staging');
    expect(list[0]!.variables).toEqual([]);
  });

  it('round-trips state.json for active environment', async () => {
    await envs.writeState({ activeEnvironment: 'development' });
    expect(await envs.readState()).toEqual({ activeEnvironment: 'development' });
  });

  it('resolveVariables returns enabled vars only', async () => {
    await envs.writeEnvironment({
      name: 'dev',
      variables: [
        { key: 'a', value: '1', enabled: true, secret: false },
        { key: 'b', value: '2', enabled: false, secret: false },
        { key: 'c', value: '3', enabled: true, secret: false },
      ],
    });
    const vars = await envs.resolveVariables('dev');
    expect(vars).toEqual({ a: '1', c: '3' });
  });

  it('deleteEnvironment removes the file', async () => {
    await envs.writeEnvironment({ name: 'temp', variables: [] });
    await envs.deleteEnvironment('temp');
    expect(await envs.readEnvironment('temp')).toBeNull();
  });

  it('preserves variables with values containing {{var}} templates', async () => {
    await envs.writeEnvironment({
      name: 'nested',
      variables: [
        { key: 'token', value: 'Bearer {{secret}}', enabled: true, secret: false },
      ],
    });
    const env = await envs.readEnvironment('nested');
    expect(env!.variables[0]!.value).toBe('Bearer {{secret}}');
  });
});
