import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie';
import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CookieEntry } from '@scrapeman/shared-types';

export interface WorkspaceCookieJarOptions {
  rootDir: string;
}

/**
 * Persistent cookie jar scoped to a workspace + active environment. Each
 * (workspace, env) pair gets its own tough-cookie jar and JSON file under
 * the app data dir so cookies never bleed across folders or environments.
 */
export class WorkspaceCookieJar {
  private readonly rootDir: string;
  private readonly jars = new Map<string, CookieJar>();

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
    const jar = await this.getJar(workspacePath, envName);
    for (const raw of setCookieHeaders) {
      try {
        await jar.setCookie(raw, requestUrl);
      } catch {
        // Malformed cookies are silently dropped; tough-cookie throws on
        // invalid Set-Cookie headers we cannot recover from.
      }
    }
    await this.persist(workspacePath, envName);
  }

  async getCookieHeader(
    workspacePath: string,
    envName: string | null,
    requestUrl: string,
  ): Promise<string | null> {
    const jar = await this.getJar(workspacePath, envName);
    const header = await jar.getCookieString(requestUrl);
    return header.length > 0 ? header : null;
  }

  async list(workspacePath: string, envName: string | null): Promise<CookieEntry[]> {
    const jar = await this.getJar(workspacePath, envName);
    // tough-cookie limits getCookies by URL — to truly list all cookies we
    // serialize the store and read its raw entries instead.
    const raw = (await jar.serialize()) as unknown as {
      cookies: SerializedCookie[];
    };
    return raw.cookies.map(toEntry);
  }

  async delete(
    workspacePath: string,
    envName: string | null,
    domain: string,
    path: string,
    name: string,
  ): Promise<void> {
    const jar = await this.getJar(workspacePath, envName);
    await new Promise<void>((resolve, reject) => {
      const store = (jar as unknown as { store: MemoryCookieStore }).store;
      store.removeCookie(domain, path, name, (err) =>
        err ? reject(err) : resolve(),
      );
    });
    await this.persist(workspacePath, envName);
  }

  async clearDomain(
    workspacePath: string,
    envName: string | null,
    domain: string,
  ): Promise<void> {
    const jar = await this.getJar(workspacePath, envName);
    const raw = (await jar.serialize()) as unknown as {
      cookies: SerializedCookie[];
    } & Record<string, unknown>;
    const survivors = raw.cookies.filter((c) => c.domain !== domain);
    const fresh = await CookieJar.deserialize({
      ...raw,
      cookies: survivors,
    } as unknown as Parameters<typeof CookieJar.deserialize>[0]);
    this.jars.set(this.key(workspacePath, envName), fresh);
    await this.persist(workspacePath, envName);
  }

  async clearAll(
    workspacePath: string,
    envName: string | null,
  ): Promise<void> {
    this.jars.set(
      this.key(workspacePath, envName),
      new CookieJar(new MemoryCookieStore()),
    );
    await this.persist(workspacePath, envName);
  }

  private async getJar(
    workspacePath: string,
    envName: string | null,
  ): Promise<CookieJar> {
    const k = this.key(workspacePath, envName);
    let jar = this.jars.get(k);
    if (jar) return jar;

    const file = this.fileFor(workspacePath, envName);
    try {
      const text = await fsp.readFile(file, 'utf8');
      const data = JSON.parse(text);
      jar = await CookieJar.deserialize(data);
    } catch {
      jar = new CookieJar(new MemoryCookieStore());
    }
    this.jars.set(k, jar);
    return jar;
  }

  private async persist(
    workspacePath: string,
    envName: string | null,
  ): Promise<void> {
    const jar = this.jars.get(this.key(workspacePath, envName));
    if (!jar) return;
    const file = this.fileFor(workspacePath, envName);
    await fsp.mkdir(dirname(file), { recursive: true });
    const data = await jar.serialize();
    await fsp.writeFile(file, JSON.stringify(data), 'utf8');
  }

  private key(workspacePath: string, envName: string | null): string {
    return `${workspacePath}|${envName ?? '__none__'}`;
  }

  private fileFor(workspacePath: string, envName: string | null): string {
    const hash = createHash('sha1').update(workspacePath).digest('hex').slice(0, 16);
    const env = envName ?? '__none__';
    return join(this.rootDir, 'cookies', `${hash}.${env}.json`);
  }
}

interface SerializedCookie {
  key: string;
  value: string;
  domain: string;
  path: string;
  expires?: string | 'Infinity';
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

function toEntry(cookie: SerializedCookie): CookieEntry {
  return {
    domain: cookie.domain,
    path: cookie.path,
    name: cookie.key,
    value: cookie.value,
    expires:
      typeof cookie.expires === 'string' && cookie.expires !== 'Infinity'
        ? cookie.expires
        : null,
    httpOnly: cookie.httpOnly === true,
    secure: cookie.secure === true,
    sameSite:
      cookie.sameSite === 'strict' ||
      cookie.sameSite === 'lax' ||
      cookie.sameSite === 'none'
        ? cookie.sameSite
        : null,
  };
}
