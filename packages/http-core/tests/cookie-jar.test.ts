import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { FileCookieStore } from '../src/cookies/file-store.js';

let tmp: string;
let filePath: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'scrapeman-file-cookie-store-'));
  filePath = join(tmp, 'jar.json');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/**
 * These tests pin down the Bruno cookie-persistence bug (usebruno/bruno#6903):
 * cookies must survive a hard process restart because FileCookieStore
 * flushes to disk SYNCHRONOUSLY before setCookieSync returns.
 */
describe('FileCookieStore', () => {
  it('set + get within the same instance', () => {
    const jar = new CookieJar(new FileCookieStore(filePath));
    jar.setCookieSync('sid=abc; Domain=example.com; Path=/', 'https://example.com/');
    expect(jar.getCookieStringSync('https://example.com/app')).toBe('sid=abc');
  });

  it('persists across restart (the Bruno #6903 fix)', () => {
    // First "process": write a cookie and drop all references.
    {
      const store = new FileCookieStore(filePath);
      const jar = new CookieJar(store);
      jar.setCookieSync(
        'sid=persisted; Domain=example.com; Path=/',
        'https://example.com/login',
      );
      // Critical assertion: the file exists on disk IMMEDIATELY after
      // setCookieSync returns — no event-loop turn required. If this
      // passes, an abrupt process exit on the next line cannot lose data.
      expect(existsSync(filePath)).toBe(true);
      const raw = readFileSync(filePath, 'utf8');
      expect(raw).toContain('persisted');
    }

    // Second "process": brand new store instance, same file path.
    const reopenedStore = new FileCookieStore(filePath);
    const reopenedJar = new CookieJar(reopenedStore);
    expect(reopenedJar.getCookieStringSync('https://example.com/')).toBe(
      'sid=persisted',
    );
  });

  it('domain scoping: a cookie for a.com is not sent to b.com', () => {
    const jar = new CookieJar(new FileCookieStore(filePath));
    jar.setCookieSync('x=1; Domain=a.com; Path=/', 'https://a.com/');
    expect(jar.getCookieStringSync('https://b.com/')).toBe('');
  });

  it('path scoping: a cookie for /api is not sent to /other', () => {
    const jar = new CookieJar(new FileCookieStore(filePath));
    jar.setCookieSync('tok=1; Domain=example.com; Path=/api', 'https://example.com/api');
    expect(jar.getCookieStringSync('https://example.com/other')).toBe('');
    expect(jar.getCookieStringSync('https://example.com/api/v1')).toBe('tok=1');
  });

  it('expired cookies are not returned by getCookieString', () => {
    const jar = new CookieJar(new FileCookieStore(filePath));
    // Expiry in the past
    jar.setCookieSync(
      'old=1; Domain=example.com; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'https://example.com/',
    );
    expect(jar.getCookieStringSync('https://example.com/')).toBe('');
  });

  it('httpOnly cookies are retained in the store', () => {
    const store = new FileCookieStore(filePath);
    const jar = new CookieJar(store);
    jar.setCookieSync(
      'sess=zz; Domain=example.com; Path=/; HttpOnly',
      'https://example.com/',
    );
    const all = store.getAllCookiesSync();
    expect(all).toHaveLength(1);
    expect(all[0]!.httpOnly).toBe(true);
  });

  it('removeCookieSync deletes a single cookie and flushes', () => {
    const store = new FileCookieStore(filePath);
    const jar = new CookieJar(store);
    jar.setCookieSync('a=1; Domain=example.com; Path=/', 'https://example.com/');
    jar.setCookieSync('b=2; Domain=example.com; Path=/', 'https://example.com/');
    store.removeCookieSync('example.com', '/', 'a');

    // Reopen to confirm it was flushed.
    const reopened = new FileCookieStore(filePath);
    const names = reopened.getAllCookiesSync().map((c) => c.key);
    expect(names).toEqual(['b']);
  });

  it('removeAllCookiesSync clears the store and flushes an empty snapshot', () => {
    const store = new FileCookieStore(filePath);
    const jar = new CookieJar(store);
    jar.setCookieSync('a=1; Domain=example.com; Path=/', 'https://example.com/');
    store.removeAllCookiesSync();

    const reopened = new FileCookieStore(filePath);
    expect(reopened.getAllCookiesSync()).toEqual([]);
  });

  it('gracefully ignores a corrupt JSON file on load', () => {
    // Seed a bogus file and make sure the store still comes up empty.
    const badPath = join(tmp, 'corrupt.json');
    // Write garbage via the fs module used by the store.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(badPath, 'not json {');
    const store = new FileCookieStore(badPath);
    expect(store.getAllCookiesSync()).toEqual([]);
  });
});
