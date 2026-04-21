import { parse as parseYaml } from 'yaml';
import {
  FORMAT_VERSION,
  FORMAT_VERSION_ACCEPTED,
  type AuthConfig,
  type BodyConfig,
  type MultipartPart,
  type ProxyConfig,
  type RequestOptions,
  type ScrapeDoConfig,
  type ScrapemanRequest,
} from '@scrapeman/shared-types';

export class FormatParseError extends Error {
  constructor(message: string) {
    super(`Invalid scrapeman request file: ${message}`);
    this.name = 'FormatParseError';
  }
}

export interface SidecarLoader {
  load(relPath: string): string | Promise<string>;
}

export async function parseRequest(
  text: string,
  sidecarLoader?: SidecarLoader,
): Promise<ScrapemanRequest> {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new FormatParseError(
      `YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isObject(raw)) {
    throw new FormatParseError('top-level is not a map');
  }

  const version = raw['scrapeman'];
  if (
    typeof version !== 'string' ||
    !(FORMAT_VERSION_ACCEPTED as readonly string[]).includes(version)
  ) {
    throw new FormatParseError(
      `unsupported scrapeman version: ${String(version)} (accepted: ${FORMAT_VERSION_ACCEPTED.join(', ')})`,
    );
  }

  const meta = raw['meta'];
  if (!isObject(meta) || typeof meta['name'] !== 'string') {
    throw new FormatParseError('meta.name is required and must be a string');
  }

  if (typeof raw['method'] !== 'string') {
    throw new FormatParseError('method is required');
  }
  if (typeof raw['url'] !== 'string') {
    throw new FormatParseError('url is required');
  }

  const request: ScrapemanRequest = {
    // Normalize to the current writer version on read. This means an in-memory
    // request always reports the latest version, and any round-trip through
    // writeRequest re-stamps the file to FORMAT_VERSION.
    scrapeman: FORMAT_VERSION,
    meta: {
      name: meta['name'],
      ...(typeof meta['description'] === 'string'
        ? { description: meta['description'] }
        : {}),
      ...(Array.isArray(meta['tags'])
        ? { tags: meta['tags'].filter((t): t is string => typeof t === 'string') }
        : {}),
    },
    method: raw['method'],
    url: raw['url'],
  };

  if (isObject(raw['params'])) {
    request.params = normalizeStringMap(raw['params']);
  }
  if (isObject(raw['headers'])) {
    request.headers = normalizeStringMap(raw['headers']);
  }
  if (isObject(raw['auth'])) {
    request.auth = parseAuth(raw['auth']);
  }
  if (isObject(raw['body'])) {
    request.body = await parseBody(raw['body'], sidecarLoader);
  }
  if (isObject(raw['proxy'])) {
    request.proxy = parseProxy(raw['proxy']);
  }
  if (isObject(raw['scrapeDo'])) {
    request.scrapeDo = parseScrapeDo(raw['scrapeDo']);
  }
  if (isObject(raw['options'])) {
    request.options = parseOptions(raw['options']);
  }

  return request;
}

function parseAuth(raw: Record<string, unknown>): AuthConfig {
  const type = raw['type'];
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'basic':
      return {
        type: 'basic',
        username: asString(raw['username'], ''),
        password: asString(raw['password'], ''),
      };
    case 'bearer':
      return { type: 'bearer', token: asString(raw['token'], '') };
    case 'apiKey':
      return {
        type: 'apiKey',
        key: asString(raw['key'], ''),
        value: asString(raw['value'], ''),
        in: raw['in'] === 'query' ? 'query' : 'header',
      };
    case 'oauth2':
      return {
        type: 'oauth2',
        flow: raw['flow'] === 'authorizationCode' ? 'authorizationCode' : 'clientCredentials',
        tokenUrl: asString(raw['tokenUrl'], ''),
        ...(typeof raw['authUrl'] === 'string' ? { authUrl: raw['authUrl'] } : {}),
        clientId: asString(raw['clientId'], ''),
        clientSecret: asString(raw['clientSecret'], ''),
        ...(typeof raw['scope'] === 'string' ? { scope: raw['scope'] } : {}),
        ...(typeof raw['audience'] === 'string' ? { audience: raw['audience'] } : {}),
        ...(typeof raw['usePkce'] === 'boolean' ? { usePkce: raw['usePkce'] } : {}),
      };
    case 'awsSigV4':
      return {
        type: 'awsSigV4',
        accessKeyId: asString(raw['accessKeyId'], ''),
        secretAccessKey: asString(raw['secretAccessKey'], ''),
        ...(typeof raw['sessionToken'] === 'string'
          ? { sessionToken: raw['sessionToken'] }
          : {}),
        region: asString(raw['region'], ''),
        service: asString(raw['service'], ''),
      };
    default:
      return { type: 'none' };
  }
}

async function parseBody(
  raw: Record<string, unknown>,
  sidecarLoader?: SidecarLoader,
): Promise<BodyConfig> {
  const type = raw['type'];
  if (type === 'none' || type === undefined) return { type: 'none' };

  if (
    type === 'json' ||
    type === 'xml' ||
    type === 'text' ||
    type === 'html' ||
    type === 'javascript'
  ) {
    if (typeof raw['content'] === 'string') {
      return { type, content: raw['content'] };
    }
    if (typeof raw['file'] === 'string') {
      const file = raw['file'];
      if (sidecarLoader) {
        const content = await sidecarLoader.load(file);
        return { type, content, file };
      }
      return { type, file };
    }
    return { type };
  }

  if (type === 'formUrlEncoded') {
    return {
      type: 'formUrlEncoded',
      fields: isObject(raw['fields']) ? normalizeStringMap(raw['fields']) : {},
    };
  }

  if (type === 'multipart') {
    const parts: MultipartPart[] = [];
    if (Array.isArray(raw['parts'])) {
      for (const rawPart of raw['parts']) {
        if (!isObject(rawPart)) continue;
        const name = asString(rawPart['name'], '');
        if (rawPart['type'] === 'text') {
          parts.push({ name, type: 'text', value: asString(rawPart['value'], '') });
        } else if (rawPart['type'] === 'file') {
          parts.push({
            name,
            type: 'file',
            file: asString(rawPart['file'], ''),
            ...(typeof rawPart['contentType'] === 'string'
              ? { contentType: rawPart['contentType'] }
              : {}),
          });
        }
      }
    }
    return { type: 'multipart', parts };
  }

  if (type === 'binary') {
    return { type: 'binary', file: asString(raw['file'], '') };
  }

  return { type: 'none' };
}

function parseProxy(raw: Record<string, unknown>): ProxyConfig {
  const proxy: ProxyConfig = {
    enabled: raw['enabled'] === true,
    url: asString(raw['url'], ''),
  };
  if (isObject(raw['auth'])) {
    proxy.auth = {
      username: asString(raw['auth']['username'], ''),
      password: asString(raw['auth']['password'], ''),
    };
  }
  if (Array.isArray(raw['bypass'])) {
    proxy.bypass = raw['bypass'].filter((v): v is string => typeof v === 'string');
  }
  return proxy;
}

function parseScrapeDo(raw: Record<string, unknown>): ScrapeDoConfig {
  const cfg: ScrapeDoConfig = {
    enabled: raw['enabled'] === true,
    token: asString(raw['token'], ''),
  };
  if (typeof raw['render'] === 'boolean') cfg.render = raw['render'];
  if (typeof raw['super'] === 'boolean') cfg.super = raw['super'];
  if (typeof raw['geoCode'] === 'string') cfg.geoCode = raw['geoCode'];
  if (
    raw['waitUntil'] === 'load' ||
    raw['waitUntil'] === 'domcontentloaded' ||
    raw['waitUntil'] === 'networkidle0' ||
    raw['waitUntil'] === 'networkidle2'
  ) {
    cfg.waitUntil = raw['waitUntil'];
  }
  if (typeof raw['customHeaders'] === 'boolean') cfg.customHeaders = raw['customHeaders'];
  return cfg;
}

function parseOptions(raw: Record<string, unknown>): RequestOptions {
  const options: RequestOptions = {};
  if (isObject(raw['timeout'])) {
    const t = raw['timeout'];
    options.timeout = {
      ...(typeof t['connect'] === 'number' ? { connect: t['connect'] } : {}),
      ...(typeof t['read'] === 'number' ? { read: t['read'] } : {}),
      ...(typeof t['total'] === 'number' ? { total: t['total'] } : {}),
    };
  }
  if (isObject(raw['redirect'])) {
    const r = raw['redirect'];
    options.redirect = {
      follow: r['follow'] === true,
      ...(typeof r['maxCount'] === 'number' ? { maxCount: r['maxCount'] } : {}),
    };
  }
  if (isObject(raw['tls'])) {
    const t = raw['tls'];
    options.tls = {
      ...(typeof t['ignoreInvalidCerts'] === 'boolean'
        ? { ignoreInvalidCerts: t['ignoreInvalidCerts'] }
        : {}),
      ...(typeof t['caFile'] === 'string' ? { caFile: t['caFile'] } : {}),
    };
  }
  if (raw['httpVersion'] === 'auto' || raw['httpVersion'] === 'http1' || raw['httpVersion'] === 'http2') {
    options.httpVersion = raw['httpVersion'];
  }
  return options;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringMap(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
    else if (value !== null && value !== undefined) out[key] = String(value);
  }
  return out;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
