import { randomUUID } from 'node:crypto';
import type { BodyConfig, ScrapemanRequest } from '@scrapeman/shared-types';

export interface AutoHeader {
  key: string;
  value: string;
  readonly?: boolean;
}

export interface AutoHeaderEnv {
  version: string;
  platform: string;
}

export function contentTypeForBody(body: BodyConfig | undefined): string | null {
  if (!body || body.type === 'none') return null;
  if (body.type === 'json') return 'application/json';
  if (body.type === 'xml') return 'application/xml';
  if (body.type === 'html') return 'text/html';
  if (body.type === 'javascript') return 'application/javascript';
  if (body.type === 'text') return 'text/plain';
  if (body.type === 'formUrlEncoded') return 'application/x-www-form-urlencoded';
  if (body.type === 'binary') return 'application/octet-stream';
  // multipart: undici sets the boundary — we stay out of it.
  return null;
}

export function buildAutoHeaders(
  request: ScrapemanRequest,
  env: AutoHeaderEnv,
): AutoHeader[] {
  const headers: AutoHeader[] = [
    { key: 'User-Agent', value: `Scrapeman/${env.version} (${env.platform})` },
    { key: 'Accept', value: '*/*' },
    { key: 'Accept-Encoding', value: 'gzip, deflate, br' },
    { key: 'Cache-Control', value: 'no-cache' },
    { key: 'Connection', value: 'keep-alive' },
    { key: 'X-Scrapeman-Token', value: randomUUID() },
  ];
  const ct = contentTypeForBody(request.body);
  if (ct) headers.push({ key: 'Content-Type', value: ct });
  return headers;
}

export function mergeHeaders(
  auto: AutoHeader[],
  user: Record<string, string> | undefined,
  disabled: Set<string>,
): Record<string, string> {
  const disabledLower = new Set(
    Array.from(disabled, (k) => k.toLowerCase()),
  );
  const userLowerKeys = new Set<string>();
  if (user) {
    for (const key of Object.keys(user)) userLowerKeys.add(key.toLowerCase());
  }

  const result: Record<string, string> = {};
  for (const h of auto) {
    const lower = h.key.toLowerCase();
    if (disabledLower.has(lower)) continue;
    if (userLowerKeys.has(lower)) continue; // user wins
    result[h.key] = h.value;
  }
  if (user) {
    for (const [key, value] of Object.entries(user)) {
      result[key] = value;
    }
  }
  return result;
}
