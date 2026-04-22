import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderSettingsFs } from '../src/workspace/folder-settings.js';

let tmp: string;
let folderSettings: FolderSettingsFs;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-folder-'));
  folderSettings = new FolderSettingsFs(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('FolderSettingsFs', () => {
  it('returns empty settings for a folder with no _folder.yaml', async () => {
    const s = await folderSettings.read('api');
    expect(s.variables).toEqual([]);
    expect(s.auth).toBeUndefined();
  });

  it('writes and reads back folder variables', async () => {
    await mkdir(join(tmp, 'api'), { recursive: true });
    await folderSettings.write('api', {
      variables: [
        { key: 'ENDPOINT', value: '/v1', enabled: true, secret: false },
      ],
    });
    const s = await folderSettings.read('api');
    expect(s.variables[0]!.key).toBe('ENDPOINT');
  });

  it('writes and reads back folder auth (apiKey)', async () => {
    await mkdir(join(tmp, 'users'), { recursive: true });
    await folderSettings.write('users', {
      variables: [],
      auth: { type: 'apiKey', key: 'X-Api-Key', value: '{{apiKey}}', in: 'header' },
    });
    const s = await folderSettings.read('users');
    expect(s.auth).toEqual({
      type: 'apiKey',
      key: 'X-Api-Key',
      value: '{{apiKey}}',
      in: 'header',
    });
  });

  it('writes and reads back nested folder path', async () => {
    await folderSettings.write('api/v2/users', {
      variables: [{ key: 'SCOPE', value: 'users', enabled: true, secret: false }],
    });
    const s = await folderSettings.read('api/v2/users');
    expect(s.variables[0]!.key).toBe('SCOPE');
  });

  it('resolveVariables returns enabled vars only', async () => {
    await folderSettings.write('svc', {
      variables: [
        { key: 'X', value: '1', enabled: true, secret: false },
        { key: 'Y', value: '2', enabled: false, secret: false },
      ],
    });
    const vars = await folderSettings.resolveVariables('svc');
    expect(vars).toEqual({ X: '1' });
  });

  it('auth type none is not serialized', async () => {
    await folderSettings.write('empty', { variables: [], auth: { type: 'none' } });
    const s = await folderSettings.read('empty');
    expect(s.auth).toBeUndefined();
  });
});
