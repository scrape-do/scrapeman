import aws4 from 'aws4';
import type { ScrapemanRequest } from '@scrapeman/shared-types';

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
}

/**
 * Signs a request with AWS Signature v4 and returns a new request with
 * Authorization / X-Amz-Date / X-Amz-Security-Token / X-Amz-Content-Sha256
 * headers injected. Does not mutate the input.
 *
 * Body is serialized to a string prior to signing because aws4 needs the
 * literal bytes being sent. JSON / text / formUrlEncoded bodies are handled;
 * multipart and binary bodies are not signable via this helper.
 */
export function signAwsSigV4(
  request: ScrapemanRequest,
  credentials: SigV4Credentials,
): ScrapemanRequest {
  const url = new URL(request.url);
  const body = extractStringBody(request);
  const headers: Record<string, string> = { ...(request.headers ?? {}) };

  const opts: aws4.Request = {
    host: url.host,
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: request.method,
    service: credentials.service,
    region: credentials.region,
    headers,
    ...(body !== null ? { body } : {}),
  };

  aws4.sign(opts, {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
  });

  return {
    ...request,
    headers: normalizeHeaders(opts.headers as Record<string, string | string[]>),
  };
}

function extractStringBody(request: ScrapemanRequest): string | null {
  if (!request.body || request.body.type === 'none') return null;
  if (
    request.body.type === 'json' ||
    request.body.type === 'xml' ||
    request.body.type === 'text' ||
    request.body.type === 'html' ||
    request.body.type === 'javascript'
  ) {
    return request.body.content ?? '';
  }
  if (request.body.type === 'formUrlEncoded') {
    return new URLSearchParams(request.body.fields).toString();
  }
  return null;
}

function normalizeHeaders(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}
