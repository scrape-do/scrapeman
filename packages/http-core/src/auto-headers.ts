import { randomUUID } from 'node:crypto';
import type {
  AutoHeaderPreviewRow,
  AutoHeadersPreview,
  BodyConfig,
  ScrapemanRequest,
} from '@scrapeman/shared-types';

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

export interface BuildHeadersOptions {
  auto: AutoHeader[];
  user: Record<string, string> | undefined;
  /** Case-insensitive set of auto-header keys the user disabled. */
  disabled: Set<string> | Iterable<string> | undefined;
}

/**
 * User-wins merge of auto + user headers, skipping disabled auto entries.
 * Lives alongside `mergeHeaders` as the options-shaped entry point the
 * renderer preview + executor should converge on.
 */
export function buildHeaders(
  options: BuildHeadersOptions,
): Record<string, string> {
  const disabledSet =
    options.disabled instanceof Set
      ? options.disabled
      : new Set(options.disabled ?? []);
  return mergeHeaders(options.auto, options.user, disabledSet);
}

/**
 * Produce a preview of the final headers the executor would send, annotated
 * with source + disabled state for the Headers tab / auto-headers panel.
 * The `overrides` semantics (auto row kept visible but struck-through when
 * a user row of the same name exists) are deferred to T3B1.
 */
export function previewHeaders(
  request: ScrapemanRequest,
  env: AutoHeaderEnv,
): AutoHeadersPreview {
  const auto = buildAutoHeaders(request, env);
  const disabledLower = new Set(
    (request.disabledAutoHeaders ?? []).map((k) => k.toLowerCase()),
  );
  const user = request.headers ?? {};
  const userLowerKeys = new Set<string>();
  for (const key of Object.keys(user)) userLowerKeys.add(key.toLowerCase());

  const rows: AutoHeaderPreviewRow[] = [];
  for (const h of auto) {
    const lower = h.key.toLowerCase();
    // User wins — when the user sets the same name we hide the auto row so
    // the preview matches what buildHeaders/mergeHeaders actually emit.
    if (userLowerKeys.has(lower)) continue;
    rows.push({
      key: h.key,
      value: h.value,
      source: 'auto',
      disabled: disabledLower.has(lower),
    });
  }
  for (const [key, value] of Object.entries(user)) {
    rows.push({ key, value, source: 'user', disabled: false });
  }
  return { rows };
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
