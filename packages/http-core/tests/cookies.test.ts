import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceCookieJar } from '../src/cookies/jar.js';

let tmp: string;
let jar: WorkspaceCookieJar;
const workspace = '/Users/test/ws-a';

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-cookies-'));
  jar = new WorkspaceCookieJar({ rootDir: tmp });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('WorkspaceCookieJar', () => {
  it('stores cookies from a Set-Cookie header and returns them on next request', async () => {
    await jar.setCookiesFromResponse(workspace, null, 'https://example.com/login', [
      'sessionid=abc; Domain=example.com; Path=/',
    ]);
    const header = await jar.getCookieHeader(
      workspace,
      null,
      'https://example.com/profile',
    );
    expect(header).toBe('sessionid=abc');
  });

  it('persists across instances (re-reads from disk)', async () => {
    await jar.setCookiesFromResponse(workspace, null, 'https://example.com/', [
      'a=1; Domain=example.com; Path=/',
    ]);
    const reopened = new WorkspaceCookieJar({ rootDir: tmp });
    const header = await reopened.getCookieHeader(workspace, null, 'https://example.com/');
    expect(header).toBe('a=1');
  });

  it('isolates cookies by environment', async () => {
    await jar.setCookiesFromResponse(workspace, 'dev', 'https://api.com/', [
      'token=dev; Domain=api.com; Path=/',
    ]);
    await jar.setCookiesFromResponse(workspace, 'prod', 'https://api.com/', [
      'token=prod; Domain=api.com; Path=/',
    ]);
    expect(
      await jar.getCookieHeader(workspace, 'dev', 'https://api.com/'),
    ).toBe('token=dev');
    expect(
      await jar.getCookieHeader(workspace, 'prod', 'https://api.com/'),
    ).toBe('token=prod');
  });

  it('isolates cookies by workspace', async () => {
    await jar.setCookiesFromResponse('/ws/a', null, 'https://api.com/', [
      'k=A; Domain=api.com; Path=/',
    ]);
    await jar.setCookiesFromResponse('/ws/b', null, 'https://api.com/', [
      'k=B; Domain=api.com; Path=/',
    ]);
    expect(await jar.getCookieHeader('/ws/a', null, 'https://api.com/')).toBe('k=A');
    expect(await jar.getCookieHeader('/ws/b', null, 'https://api.com/')).toBe('k=B');
  });

  it('list returns cookies with parsed flags', async () => {
    await jar.setCookiesFromResponse(workspace, null, 'https://example.com/', [
      'sid=zz; Domain=example.com; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    const list = await jar.list(workspace, null);
    expect(list).toHaveLength(1);
    const c = list[0]!;
    expect(c.name).toBe('sid');
    expect(c.value).toBe('zz');
    expect(c.domain).toBe('example.com');
    expect(c.httpOnly).toBe(true);
    expect(c.secure).toBe(true);
    expect(c.sameSite).toBe('lax');
  });

  it('clearAll empties the jar for a given env', async () => {
    await jar.setCookiesFromResponse(workspace, null, 'https://example.com/', [
      'a=1; Domain=example.com; Path=/',
    ]);
    await jar.clearAll(workspace, null);
    expect(await jar.list(workspace, null)).toEqual([]);
  });

  it('clearDomain removes only the targeted domain', async () => {
    await jar.setCookiesFromResponse(workspace, null, 'https://a.com/', [
      'x=1; Domain=a.com; Path=/',
    ]);
    await jar.setCookiesFromResponse(workspace, null, 'https://b.com/', [
      'y=2; Domain=b.com; Path=/',
    ]);
    await jar.clearDomain(workspace, null, 'a.com');
    const list = await jar.list(workspace, null);
    expect(list).toHaveLength(1);
    expect(list[0]!.domain).toBe('b.com');
  });

  it('returns null cookie header when no cookies match', async () => {
    expect(
      await jar.getCookieHeader(workspace, null, 'https://nothing.com/'),
    ).toBeNull();
  });

  it('does not send cookies cross-domain', async () => {
    await jar.setCookiesFromResponse(workspace, null, 'https://a.com/', [
      'x=1; Domain=a.com; Path=/',
    ]);
    expect(await jar.getCookieHeader(workspace, null, 'https://b.com/')).toBeNull();
  });
});
