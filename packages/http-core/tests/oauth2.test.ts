import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { OAuth2Client } from '../src/auth/oauth2.js';

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
