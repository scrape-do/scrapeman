import { CookieJar } from 'tough-cookie';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Cookie } from 'tough-cookie';
import type { CookieEntry } from '@scrapeman/shared-types';
import { FileCookieStore } from './file-store.js';

export interface WorkspaceCookieJarOptions {
  rootDir: string;
}

/**
 * Persistent cookie jar scoped to a workspace + active environment. Each
 * (workspace, env) pair gets its own tough-cookie jar backed by a
 * FileCookieStore, which flushes to a JSON file synchronously on every
 * mutation. This is the fix for usebruno/bruno#6903: no async write queue
 * means no dropped cookies when the app exits right after a response.
 */
export class WorkspaceCookieJar {
  private readonly rootDir: string;
  private readonly jars = new Map<string, { jar: CookieJar; file: string }>();

  constructor(options: WorkspaceCookieJarOptions) {
    this.rootDir = options.rootDir;
  }

  async setCookiesFromResponse(
    workspacePath: string,
    envName: string | null,
    requestUrl: string,
    setCookieHeaders: string[],
  ): Promise<void> {
    if (setCookieHeaders.length === 0) return;
    const { jar } = this.getOrCreate(workspacePath, envName);
    for (const raw of setCookieHeaders) {
      try {
        // Sync path: FileCookieStore flushes to disk before this returns.
        jar.setCookieSync(raw, requestUrl);
      } catch {
        // Malformed Set-Cookie headers are silently dropped — tough-cookie
        // throws on values it cannot parse and we have nothing to recover.
      }
    }
  }

  async getCookieHeader(
    workspacePath: string,
    envName: string | null,
    requestUrl: string,
  ): Promise<string | null> {
    const { jar } = this.getOrCreate(workspacePath, envName);
    const header = jar.getCookieStringSync(requestUrl);
    return header.length > 0 ? header : null;
  }

  async list(
    workspacePath: string,
    envName: string | null,
  ): Promise<CookieEntry[]> {
    const { jar } = this.getOrCreate(workspacePath, envName);
    const store = (jar as unknown as { store: FileCookieStore }).store;
    return store.getAllCookiesSync().map(toEntry);
  }

  async delete(
    workspacePath: string,
    envName: string | null,
    domain: string,
    path: string,
    name: string,
  ): Promise<void> {
    const { jar } = this.getOrCreate(workspacePath, envName);
    const store = (jar as unknown as { store: FileCookieStore }).store;
    store.removeCookieSync(domain, path, name);
  }

  async clearDomain(
    workspacePath: string,
    envName: string | null,
    domain: string,
  ): Promise<void> {
    const { jar } = this.getOrCreate(workspacePath, envName);
    const store = (jar as unknown as { store: FileCookieStore }).store;
    // Collect matching cookies first, then remove one by one. We avoid
    // removeCookies(domain, null) because tough-cookie's contract treats
    // null path as "match any" but some stores interpret it differently —
    // an explicit loop is unambiguous.
    for (const c of store.getAllCookiesSync()) {
      if (c.domain === domain) {
        store.removeCookieSync(c.domain ?? '', c.path ?? '/', c.key);
      }
    }
  }

  async clearAll(
    workspacePath: string,
    envName: string | null,
  ): Promise<void> {
    const entry = this.getOrCreate(workspacePath, envName);
    const store = (entry.jar as unknown as { store: FileCookieStore }).store;
    store.removeAllCookiesSync();
    // Also nuke the file so a fresh FileCookieStore instance (e.g. after a
    // restart) cannot resurrect cookies from a stale on-disk snapshot.
    if (existsSync(entry.file)) {
      rmSync(entry.file, { force: true });
    }
    // Drop the in-memory reference so the next access rebuilds from scratch.
    this.jars.delete(this.key(workspacePath, envName));
  }

  private getOrCreate(
    workspacePath: string,
    envName: string | null,
  ): { jar: CookieJar; file: string } {
    const k = this.key(workspacePath, envName);
    const existing = this.jars.get(k);
    if (existing) return existing;

    const file = this.fileFor(workspacePath, envName);
    const store = new FileCookieStore(file);
    const jar = new CookieJar(store);
    const entry = { jar, file };
    this.jars.set(k, entry);
    return entry;
  }

  private key(workspacePath: string, envName: string | null): string {
    return `${workspacePath}|${envName ?? '__none__'}`;
  }

  private fileFor(workspacePath: string, envName: string | null): string {
    const hash = createHash('sha1')
      .update(workspacePath)
      .digest('hex')
      .slice(0, 16);
    const env = envName ?? '__none__';
    return join(this.rootDir, 'cookies', `${hash}.${env}.json`);
  }
}

function toEntry(cookie: Cookie): CookieEntry {
  const expires = cookie.expires;
  let expiresStr: string | null = null;
  if (expires instanceof Date) {
    expiresStr = expires.toISOString();
  }
  const sameSite =
    cookie.sameSite === 'strict' ||
    cookie.sameSite === 'lax' ||
    cookie.sameSite === 'none'
      ? cookie.sameSite
      : null;
  return {
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    name: cookie.key,
    value: cookie.value,
    expires: expiresStr,
    httpOnly: cookie.httpOnly === true,
    secure: cookie.secure === true,
    sameSite,
  };
}
