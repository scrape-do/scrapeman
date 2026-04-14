import {
  Cookie,
  MemoryCookieStore,
  type SerializedCookie,
} from 'tough-cookie';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * A tough-cookie Store that persists synchronously to a JSON file on every
 * mutation. Extends MemoryCookieStore so we inherit its fully-tested indexing
 * and lookup logic and only override the write paths to flush to disk.
 *
 * Why synchronous? This fixes the Bruno cookie-persistence race documented in
 * usebruno/bruno#6903: an async flush can lose the final writes if the
 * process exits (app quit, renderer reload, crash) before the queued write
 * promise resolves. `writeFileSync` is intentionally blocking so the bytes
 * hit the OS page cache before `putCookie` returns — no pending work that
 * the event loop can silently drop on shutdown.
 *
 * The trade-off is a few extra milliseconds per Set-Cookie header. In the
 * interactive Scrapeman use case (human-driven requests, not high-throughput
 * batch runs) this is imperceptible, and correctness beats micro-perf.
 */
export class FileCookieStore extends MemoryCookieStore {
  // tough-cookie's CookieJar branches on this flag to pick sync vs async code
  // paths. MemoryCookieStore already sets it to true; we re-assert for clarity.
  public override synchronous = true;

  constructor(private readonly filePath: string) {
    super();
    this.loadFromDisk();
  }

  // --- sync public API (used by tests + clearJar) --------------------------

  /**
   * Returns every cookie currently in the store. Synchronous wrapper over
   * MemoryCookieStore.getAllCookies which is already sync under the hood.
   */
  public getAllCookiesSync(): Cookie[] {
    // MemoryCookieStore.getAllCookies has a sync fast-path when called with no
    // callback; it returns a resolved promise whose value is already computed.
    let out: Cookie[] = [];
    void this.getAllCookies((_err, cookies) => {
      out = cookies ?? [];
    });
    return out;
  }

  /** Remove a cookie synchronously and flush. */
  public removeCookieSync(domain: string, path: string, key: string): void {
    void super.removeCookie(domain, path, key, () => {
      /* memory store is sync */
    });
    this.persist();
  }

  /** Remove every cookie in the store and flush (used by clearAll). */
  public removeAllCookiesSync(): void {
    void super.removeAllCookies(() => {
      /* memory store is sync */
    });
    this.persist();
  }

  // --- Store overrides: flush after every mutation -------------------------

  public override putCookie(cookie: Cookie): Promise<void>;
  public override putCookie(
    cookie: Cookie,
    callback: (err: Error | null) => void,
  ): void;
  public override putCookie(
    cookie: Cookie,
    callback?: (err: Error | null) => void,
  ): Promise<void> | void {
    if (callback) {
      super.putCookie(cookie, (err) => {
        if (!err) {
          try {
            this.persist();
          } catch (e) {
            callback(e as Error);
            return;
          }
        }
        callback(err);
      });
      return;
    }
    return super.putCookie(cookie).then(() => {
      this.persist();
    });
  }

  public override updateCookie(
    oldCookie: Cookie,
    newCookie: Cookie,
  ): Promise<void>;
  public override updateCookie(
    oldCookie: Cookie,
    newCookie: Cookie,
    callback: (err: Error | null) => void,
  ): void;
  public override updateCookie(
    oldCookie: Cookie,
    newCookie: Cookie,
    callback?: (err: Error | null) => void,
  ): Promise<void> | void {
    // MemoryCookieStore.updateCookie delegates to putCookie, so our override
    // above is already called — but delegate explicitly to keep types clean.
    if (callback) {
      this.putCookie(newCookie, callback);
      return;
    }
    return this.putCookie(newCookie);
  }

  public override removeCookie(
    domain: string,
    path: string,
    key: string,
  ): Promise<void>;
  public override removeCookie(
    domain: string,
    path: string,
    key: string,
    callback: (err: Error | null) => void,
  ): void;
  public override removeCookie(
    domain: string,
    path: string,
    key: string,
    callback?: (err: Error | null) => void,
  ): Promise<void> | void {
    if (callback) {
      super.removeCookie(domain, path, key, (err) => {
        if (!err) {
          try {
            this.persist();
          } catch (e) {
            callback(e as Error);
            return;
          }
        }
        callback(err);
      });
      return;
    }
    return super.removeCookie(domain, path, key).then(() => {
      this.persist();
    });
  }

  public override removeCookies(domain: string, path: string): Promise<void>;
  public override removeCookies(
    domain: string,
    path: string,
    callback: (err: Error | null) => void,
  ): void;
  public override removeCookies(
    domain: string,
    path: string,
    callback?: (err: Error | null) => void,
  ): Promise<void> | void {
    if (callback) {
      super.removeCookies(domain, path, (err) => {
        if (!err) {
          try {
            this.persist();
          } catch (e) {
            callback(e as Error);
            return;
          }
        }
        callback(err);
      });
      return;
    }
    return super.removeCookies(domain, path).then(() => {
      this.persist();
    });
  }

  public override removeAllCookies(): Promise<void>;
  public override removeAllCookies(callback: (err: Error | null) => void): void;
  public override removeAllCookies(
    callback?: (err: Error | null) => void,
  ): Promise<void> | void {
    if (callback) {
      super.removeAllCookies((err) => {
        if (!err) {
          try {
            this.persist();
          } catch (e) {
            callback(e as Error);
            return;
          }
        }
        callback(err);
      });
      return;
    }
    return super.removeAllCookies().then(() => {
      this.persist();
    });
  }

  // --- disk I/O ------------------------------------------------------------

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;
    let text: string;
    try {
      text = readFileSync(this.filePath, 'utf8');
    } catch {
      return;
    }
    if (!text.trim()) return;
    let parsed: { cookies?: SerializedCookie[] };
    try {
      parsed = JSON.parse(text) as { cookies?: SerializedCookie[] };
    } catch {
      // Corrupt file: start fresh. We do not attempt recovery — a stale jar
      // is safer than crashing the executor on every request.
      return;
    }
    const list = parsed.cookies ?? [];
    for (const raw of list) {
      const cookie = Cookie.fromJSON(raw);
      if (!cookie) continue;
      // Call the parent putCookie directly (sync path) so we don't re-persist
      // on every cookie while loading — we'll flush once at the end if needed.
      void super.putCookie(cookie, () => {
        /* memory store is sync */
      });
    }
  }

  /**
   * Synchronously flush the in-memory index to disk. Blocking by design:
   * returning from putCookie MUST imply the bytes are on disk so that a
   * crash or quit on the very next tick cannot lose the cookie.
   */
  private persist(): void {
    const cookies = this.getAllCookiesSync().map((c) => c.toJSON());
    const payload = JSON.stringify({ version: 1, cookies });
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // writeFileSync is intentionally synchronous — see class docstring.
    writeFileSync(this.filePath, payload, 'utf8');
  }
}
