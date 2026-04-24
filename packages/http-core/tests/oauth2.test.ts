import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { OAuth2Client, generatePkce, runAuthCodeFlow, decodeJwt, fetchOidcDiscovery } from '../src/auth/oauth2.js';

let server: Server;
let baseUrl: string;
let tokenCallCount = 0;

beforeAll(async () => {
  tokenCallCount = 0;
  server = createServer((req, res) => {
    if (req.url === '/token') {
      tokenCallCount++;
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        if (params.get('grant_type') !== 'client_credentials') {
          res.writeHead(400);
          res.end('bad grant_type');
          return;
        }
        if (params.get('client_id') !== 'client-a' || params.get('client_secret') !== 'shh') {
          res.writeHead(401);
          res.end('unauthorized');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: `token-${tokenCallCount}`,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: params.get('scope') ?? '',
          }),
        );
      });
      return;
    }
    if (req.url === '/token-short') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: 'short',
          token_type: 'Bearer',
          expires_in: 1,
        }),
      );
      return;
    }
    if (req.url === '/token-bad') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('boom');
      return;
    }
    if (req.url === '/token-no-expiry') {
      tokenCallCount++;
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: `noexp-${tokenCallCount}`,
            token_type: 'Bearer',
          }),
        );
      });
      return;
    }
    if (req.url === '/token-slow') {
      tokenCallCount++;
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        // Delay the response so concurrent callers have time to pile up
        // against the same in-flight Promise.
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: `slow-${tokenCallCount}`,
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          );
        }, 50);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, 'close');
});

describe('OAuth2Client client_credentials', () => {
  it('fetches a fresh token', async () => {
    const client = new OAuth2Client();
    const token = await client.getToken({
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
      scope: 'read:things',
    });
    expect(token.accessToken).toMatch(/^token-\d+$/);
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresAt).toBeGreaterThan(Date.now() + 3590_000);
    expect(token.scope).toBe('read:things');
  });

  it('caches tokens by tokenUrl + clientId + scope', async () => {
    const client = new OAuth2Client();
    const a = await client.getToken({
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
    });
    const b = await client.getToken({
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
    });
    expect(a.accessToken).toBe(b.accessToken);
  });

  it('different scopes get different cached tokens', async () => {
    const client = new OAuth2Client();
    const a = await client.getToken({
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
      scope: 'read',
    });
    const b = await client.getToken({
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
      scope: 'write',
    });
    expect(a.accessToken).not.toBe(b.accessToken);
  });

  it('clearCache drops all cached tokens', async () => {
    const client = new OAuth2Client();
    const a = await client.getToken({
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
    });
    client.clearCache();
    const b = await client.getToken({
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
    });
    expect(a.accessToken).not.toBe(b.accessToken);
  });

  it('surfaces non-2xx from the token endpoint', async () => {
    const client = new OAuth2Client();
    await expect(
      client.getToken({
        tokenUrl: `${baseUrl}/token-bad`,
        clientId: 'client-a',
        clientSecret: 'shh',
      }),
    ).rejects.toThrow(/500/);
  });

  it('dedupes concurrent requests into a single in-flight fetch', async () => {
    const client = new OAuth2Client();
    const before = tokenCallCount;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.getToken({
          tokenUrl: `${baseUrl}/token-slow`,
          clientId: 'client-a',
          clientSecret: 'shh',
        }),
      ),
    );
    const after = tokenCallCount;
    expect(after - before).toBe(1);
    // All 5 callers get the exact same token object.
    const tokens = new Set(results.map((r) => r.accessToken));
    expect(tokens.size).toBe(1);
  });

  it('treats tokens without expires_in as non-expiring (MAX_SAFE_INTEGER)', async () => {
    const client = new OAuth2Client();
    const token = await client.getToken({
      tokenUrl: `${baseUrl}/token-no-expiry`,
      clientId: 'client-a',
      clientSecret: 'shh',
    });
    expect(token.expiresAt).toBe(Number.MAX_SAFE_INTEGER);
    // Subsequent call must hit the cache, not refetch.
    const before = tokenCallCount;
    const token2 = await client.getToken({
      tokenUrl: `${baseUrl}/token-no-expiry`,
      clientId: 'client-a',
      clientSecret: 'shh',
    });
    expect(tokenCallCount).toBe(before);
    expect(token2.accessToken).toBe(token.accessToken);
  });

  it('invalidate() drops a single cache entry', async () => {
    const client = new OAuth2Client();
    const cfg = {
      tokenUrl: `${baseUrl}/token`,
      clientId: 'client-a',
      clientSecret: 'shh',
    };
    const a = await client.getToken(cfg);
    client.invalidate(cfg);
    const b = await client.getToken(cfg);
    expect(a.accessToken).not.toBe(b.accessToken);
  });

  it('rejects wrong client secret', async () => {
    const client = new OAuth2Client();
    await expect(
      client.getToken({
        tokenUrl: `${baseUrl}/token`,
        clientId: 'client-a',
        clientSecret: 'wrong',
      }),
    ).rejects.toThrow(/401/);
  });
});

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

describe('generatePkce', () => {
  it('produces a verifier and matching S256 challenge', () => {
    const { verifier, challenge } = generatePkce();
    // RFC 7636: verifier is base64url, 43 chars from 32 raw bytes.
    expect(verifier).toHaveLength(43);
    expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
    // Verify the challenge is SHA-256(verifier) base64url.
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('generates a different verifier on each call', () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

// ---------------------------------------------------------------------------
// decodeJwt — display-only, no verification
// ---------------------------------------------------------------------------

describe('decodeJwt', () => {
  function makeJwt(header: object, payload: object): string {
    const enc = (o: object): string =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${enc(header)}.${enc(payload)}.fakesig`;
  }

  it('decodes header and payload', () => {
    const jwt = makeJwt({ alg: 'RS256', typ: 'JWT' }, { sub: '1234', exp: 9999999999 });
    const result = decodeJwt(jwt);
    expect(result).not.toBeNull();
    expect(result!.header['alg']).toBe('RS256');
    expect(result!.payload['sub']).toBe('1234');
    expect(result!.payload['exp']).toBe(9999999999);
  });

  it('returns null for non-JWT strings', () => {
    expect(decodeJwt('not.a.jwt.with.too.many.dots')).toBeNull();
    expect(decodeJwt('onlyone')).toBeNull();
    expect(decodeJwt('')).toBeNull();
  });

  it('returns null when a segment is not valid base64url JSON', () => {
    // Valid three-segment form but garbage data.
    expect(decodeJwt('!!!.yyy.zzz')).toBeNull();
  });

  it('preserves raw segment strings', () => {
    const jwt = makeJwt({ alg: 'HS256' }, { iss: 'test' });
    const result = decodeJwt(jwt);
    expect(result).not.toBeNull();
    expect(result!.rawHeader).toBe(jwt.split('.')[0]);
    expect(result!.rawPayload).toBe(jwt.split('.')[1]);
  });
});

// ---------------------------------------------------------------------------
// runAuthCodeFlow — uses a real loopback server to simulate the callback
// ---------------------------------------------------------------------------

describe('runAuthCodeFlow', () => {
  let tokenServer: Server;
  let tokenBaseUrl: string;

  beforeAll(async () => {
    tokenServer = createServer((req, res) => {
      if (req.url === '/token') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: 'auth-code-token',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'rtoken',
            ...(params.get('scope') ? { scope: params.get('scope') } : {}),
          }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    tokenServer.listen(0, '127.0.0.1');
    await once(tokenServer, 'listening');
    const addr = tokenServer.address() as AddressInfo;
    tokenBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    tokenServer.close();
    await once(tokenServer, 'close');
  });

  it('exchanges code for token (no PKCE, mocked browser + callback)', async () => {
    let capturedAuthUrl = '';
    const openBrowser = (url: string): void => {
      capturedAuthUrl = url;
      // Simulate the browser hitting the callback with a valid state + code.
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('state', state);
      callbackUrl.searchParams.set('code', 'test-code');

      // Hit the callback after a short delay (give server time to bind).
      setTimeout(() => {
        void fetch(callbackUrl.toString()).catch(() => undefined);
      }, 20);
    };

    const token = await runAuthCodeFlow({
      authUrl: 'https://example.com/auth',
      tokenUrl: `${tokenBaseUrl}/token`,
      clientId: 'client-x',
      usePkce: false,
      openBrowser,
    });

    expect(capturedAuthUrl).toContain('response_type=code');
    expect(capturedAuthUrl).toContain('client_id=client-x');
    expect(capturedAuthUrl).not.toContain('code_challenge');
    expect(token.accessToken).toBe('auth-code-token');
    expect(token.refreshToken).toBe('rtoken');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it('includes PKCE params in auth URL when usePkce=true', async () => {
    let capturedUrl = '';
    const openBrowser = (url: string): void => {
      capturedUrl = url;
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      const cb = new URL(redirectUri);
      cb.searchParams.set('state', state);
      cb.searchParams.set('code', 'pkce-code');
      setTimeout(() => { void fetch(cb.toString()).catch(() => undefined); }, 20);
    };

    await runAuthCodeFlow({
      authUrl: 'https://example.com/auth',
      tokenUrl: `${tokenBaseUrl}/token`,
      clientId: 'client-pkce',
      usePkce: true,
      openBrowser,
    });

    const parsed = new URL(capturedUrl);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    const challenge = parsed.searchParams.get('code_challenge');
    expect(challenge).toBeTruthy();
    // Challenge must be 43 chars base64url.
    expect(challenge).toHaveLength(43);
    expect(/^[A-Za-z0-9_-]+$/.test(challenge!)).toBe(true);
  });

  it('rejects on state mismatch', async () => {
    const openBrowser = (url: string): void => {
      const parsed = new URL(url);
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      const cb = new URL(redirectUri);
      cb.searchParams.set('state', 'wrong-state');
      cb.searchParams.set('code', 'some-code');
      setTimeout(() => { void fetch(cb.toString()).catch(() => undefined); }, 20);
    };

    await expect(
      runAuthCodeFlow({
        authUrl: 'https://example.com/auth',
        tokenUrl: `${tokenBaseUrl}/token`,
        clientId: 'client-x',
        usePkce: false,
        openBrowser,
      }),
    ).rejects.toThrow(/state mismatch/i);
  });

  it('rejects when callback contains error param', async () => {
    const openBrowser = (url: string): void => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      const cb = new URL(redirectUri);
      cb.searchParams.set('state', state);
      cb.searchParams.set('error', 'access_denied');
      cb.searchParams.set('error_description', 'user cancelled');
      setTimeout(() => { void fetch(cb.toString()).catch(() => undefined); }, 20);
    };

    await expect(
      runAuthCodeFlow({
        authUrl: 'https://example.com/auth',
        tokenUrl: `${tokenBaseUrl}/token`,
        clientId: 'client-x',
        usePkce: false,
        openBrowser,
      }),
    ).rejects.toThrow(/access_denied/i);
  });

  it('flow succeeds without client_secret (PKCE-only)', async () => {
    const openBrowser = (url: string): void => {
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;
      const redirectUri = parsed.searchParams.get('redirect_uri')!;
      const cb = new URL(redirectUri);
      cb.searchParams.set('state', state);
      cb.searchParams.set('code', 'no-secret-code');
      setTimeout(() => { void fetch(cb.toString()).catch(() => undefined); }, 20);
    };

    // Should not throw even though clientSecret is omitted.
    const token = await runAuthCodeFlow({
      authUrl: 'https://example.com/auth',
      tokenUrl: `${tokenBaseUrl}/token`,
      clientId: 'no-secret-client',
      usePkce: true,
      openBrowser,
    });
    expect(token.accessToken).toBe('auth-code-token');
  });
});

// ---------------------------------------------------------------------------
// fetchOidcDiscovery
// ---------------------------------------------------------------------------

describe('fetchOidcDiscovery', () => {
  let discoveryServer: Server;
  let discoveryBase: string;

  beforeAll(async () => {
    discoveryServer = createServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          scopes_supported: ['openid', 'profile', 'email'],
          end_session_endpoint: 'https://auth.example.com/logout',
        }));
      } else if (req.url === '/.well-known/bad') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ issuer: 'nope' }));
      } else if (req.url === '/.well-known/error') {
        res.writeHead(500);
        res.end('server error');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    discoveryServer.listen(0, '127.0.0.1');
    await once(discoveryServer, 'listening');
    const addr = discoveryServer.address() as AddressInfo;
    discoveryBase = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    discoveryServer.close();
    await once(discoveryServer, 'close');
  });

  it('parses a full discovery document', async () => {
    const doc = await fetchOidcDiscovery(`${discoveryBase}/.well-known/openid-configuration`);
    expect(doc.tokenUrl).toBe('https://auth.example.com/token');
    expect(doc.authUrl).toBe('https://auth.example.com/authorize');
    expect(doc.scopesSupported).toEqual(['openid', 'profile', 'email']);
    expect(doc.endSessionEndpoint).toBe('https://auth.example.com/logout');
  });

  it('rejects when required fields are missing', async () => {
    await expect(fetchOidcDiscovery(`${discoveryBase}/.well-known/bad`)).rejects.toThrow(
      /token_endpoint/,
    );
  });

  it('rejects on non-2xx HTTP response', async () => {
    await expect(fetchOidcDiscovery(`${discoveryBase}/.well-known/error`)).rejects.toThrow(/500/);
  });
});

// ---------------------------------------------------------------------------
// OAuth2Client.storeToken + getCachedToken (auth-code cache integration)
// ---------------------------------------------------------------------------

describe('OAuth2Client.storeToken / getCachedToken', () => {
  it('stores and retrieves a token by key', () => {
    const client = new OAuth2Client();
    const cfg = { tokenUrl: 'https://t.example.com/token', clientId: 'c1' };
    const token = {
      accessToken: 'stored-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3_600_000,
    };
    client.storeToken(cfg, token);
    const cached = client.getCachedToken(cfg);
    expect(cached?.accessToken).toBe('stored-token');
  });

  it('getCachedToken returns undefined when nothing is stored', () => {
    const client = new OAuth2Client();
    const cfg = { tokenUrl: 'https://t.example.com/token', clientId: 'no-such' };
    expect(client.getCachedToken(cfg)).toBeUndefined();
  });

  it('invalidate drops the storeToken entry', () => {
    const client = new OAuth2Client();
    const cfg = { tokenUrl: 'https://t.example.com/token', clientId: 'c2' };
    client.storeToken(cfg, {
      accessToken: 'will-be-gone',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3_600_000,
    });
    client.invalidate(cfg);
    expect(client.getCachedToken(cfg)).toBeUndefined();
  });
});
