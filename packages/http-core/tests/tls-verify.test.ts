import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UndiciExecutor } from '../src/adapters/undici-executor.js';
import { ExecutorError } from '../src/errors.js';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';

// Hermetic test: spin up an HTTPS server with a self-signed cert that
// nothing in the local trust store recognises. Default verification must
// reject; ignoreInvalidCerts:true must accept. No badssl.com dependency.
function generateSelfSignedCert(): { cert: string; key: string } | null {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'scrapeman-tls-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${keyPath} ` +
        `-out ${certPath} -days 1 -subj "/CN=localhost"`,
      { stdio: 'ignore' },
    );
    return {
      cert: readFileSync(certPath, 'utf8'),
      key: readFileSync(keyPath, 'utf8'),
    };
  } catch {
    return null;
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

let server: Server | null = null;
let baseUrl: string | null = null;

beforeAll(async () => {
  const generated = generateSelfSignedCert();
  if (!generated) return; // OpenSSL unavailable; tests below skip.

  server = createServer(generated, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as AddressInfo;
  baseUrl = `https://localhost:${addr.port}`;
});

afterAll(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
});

function reqWithToggle(
  url: string,
  ignoreInvalidCerts: boolean,
): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'tls-verify' },
    method: 'GET',
    url,
    options: { tls: { ignoreInvalidCerts } },
  };
}

describe('TLS verification toggle', () => {
  const executor = new UndiciExecutor();

  it('rejects a self-signed cert when verification is on (default)', async () => {
    if (!baseUrl) return;
    await expect(
      executor.execute({
        scrapeman: FORMAT_VERSION,
        meta: { name: 'tls-default' },
        method: 'GET',
        url: baseUrl,
      }),
    ).rejects.toBeInstanceOf(ExecutorError);
  });

  it('accepts the same cert when ignoreInvalidCerts is true', async () => {
    if (!baseUrl) return;
    const response = await executor.execute(reqWithToggle(baseUrl, true));
    expect(response.status).toBe(200);
  });

  it('still rejects when ignoreInvalidCerts is explicitly false', async () => {
    if (!baseUrl) return;
    await expect(
      executor.execute(reqWithToggle(baseUrl, false)),
    ).rejects.toBeInstanceOf(ExecutorError);
  });
});
