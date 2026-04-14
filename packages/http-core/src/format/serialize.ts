import type {
  AuthConfig,
  BodyConfig,
  MultipartPart,
  ProxyConfig,
  RequestOptions,
  ScrapeDoConfig,
  ScrapemanRequest,
} from '@scrapeman/shared-types';

export interface SerializedSidecar {
  relPath: string;
  content: Uint8Array | string;
}

export interface SerializeResult {
  yaml: string;
  sidecars: SerializedSidecar[];
}

const SIDECAR_THRESHOLD = 4096;

export function serializeRequest(
  request: ScrapemanRequest,
  requestSlug: string,
): SerializeResult {
  const lines: string[] = [];
  const sidecars: SerializedSidecar[] = [];

  lines.push(`scrapeman: "${request.scrapeman}"`);

  writeMetaBlock(lines, request);
  lines.push(`method: ${yamlString(request.method)}`);
  lines.push(`url: ${yamlString(request.url)}`);

  if (request.params && Object.keys(request.params).length > 0) {
    lines.push('params:');
    writeMap(lines, request.params, '  ');
  }

  if (request.headers && Object.keys(request.headers).length > 0) {
    lines.push('headers:');
    writeMap(lines, request.headers, '  ');
  }

  if (request.auth && request.auth.type !== 'none') {
    writeAuthBlock(lines, request.auth);
  }

  if (request.body && request.body.type !== 'none') {
    writeBodyBlock(lines, request.body, requestSlug, sidecars);
  }

  if (request.proxy) {
    writeProxyBlock(lines, request.proxy);
  }

  if (request.scrapeDo) {
    writeScrapeDoBlock(lines, request.scrapeDo);
  }

  if (request.options) {
    writeOptionsBlock(lines, request.options);
  }

  return {
    yaml: lines.join('\n') + '\n',
    sidecars,
  };
}

function writeMetaBlock(lines: string[], request: ScrapemanRequest): void {
  lines.push('meta:');
  lines.push(`  name: ${yamlString(request.meta.name)}`);
  if (request.meta.description !== undefined) {
    lines.push(`  description: ${yamlString(request.meta.description)}`);
  }
  if (request.meta.tags && request.meta.tags.length > 0) {
    lines.push(`  tags: [${request.meta.tags.map(yamlString).join(', ')}]`);
  }
}

function writeAuthBlock(lines: string[], auth: AuthConfig): void {
  lines.push('auth:');
  lines.push(`  type: ${yamlString(auth.type)}`);
  const ordered = authKeyOrder(auth);
  for (const key of ordered) {
    const value = (auth as Record<string, unknown>)[key];
    if (value === undefined) continue;
    lines.push(`  ${key}: ${yamlScalar(value)}`);
  }
}

function authKeyOrder(auth: AuthConfig): string[] {
  switch (auth.type) {
    case 'basic':
      return ['username', 'password'];
    case 'bearer':
      return ['token'];
    case 'apiKey':
      return ['key', 'value', 'in'];
    case 'oauth2':
      return [
        'flow',
        'tokenUrl',
        'authUrl',
        'clientId',
        'clientSecret',
        'scope',
        'audience',
        'usePkce',
      ];
    case 'awsSigV4':
      return [
        'accessKeyId',
        'secretAccessKey',
        'sessionToken',
        'region',
        'service',
      ];
    default:
      return [];
  }
}

function writeBodyBlock(
  lines: string[],
  body: BodyConfig,
  requestSlug: string,
  sidecars: SerializedSidecar[],
): void {
  if (body.type === 'none') return;
  lines.push('body:');
  lines.push(`  type: ${yamlString(body.type)}`);

  if (
    body.type === 'json' ||
    body.type === 'xml' ||
    body.type === 'text' ||
    body.type === 'html' ||
    body.type === 'javascript'
  ) {
    const useSidecar =
      body.forceSidecar === true ||
      body.file !== undefined ||
      (body.content !== undefined &&
        Buffer.byteLength(body.content, 'utf8') >= SIDECAR_THRESHOLD);

    if (useSidecar) {
      const ext = extForRawBodyType(body.type);
      const relPath = body.file ?? `files/${requestSlug}.body.${ext}`;
      lines.push(`  file: ${yamlString(relPath)}`);
      if (body.content !== undefined) {
        sidecars.push({ relPath, content: body.content });
      }
    } else if (body.content !== undefined) {
      // Chomping indicator: |- strips the trailing newline (default YAML | keeps one),
      // so round-trips preserve content byte-for-byte.
      const chomp = body.content.endsWith('\n') ? '|' : '|-';
      lines.push(`  content: ${chomp}`);
      const bodyLines = body.content.endsWith('\n')
        ? body.content.slice(0, -1).split('\n')
        : body.content.split('\n');
      for (const line of bodyLines) {
        lines.push(`    ${line}`);
      }
    }
    return;
  }

  if (body.type === 'formUrlEncoded') {
    lines.push('  fields:');
    writeMap(lines, body.fields, '    ');
    return;
  }

  if (body.type === 'multipart') {
    lines.push('  parts:');
    for (const part of body.parts) {
      writeMultipartPart(lines, part);
    }
    return;
  }

  if (body.type === 'binary') {
    lines.push(`  file: ${yamlString(body.file)}`);
    return;
  }
}

function writeMultipartPart(lines: string[], part: MultipartPart): void {
  lines.push(`    - name: ${yamlString(part.name)}`);
  lines.push(`      type: ${yamlString(part.type)}`);
  if (part.type === 'text') {
    lines.push(`      value: ${yamlString(part.value)}`);
  } else {
    lines.push(`      file: ${yamlString(part.file)}`);
    if (part.contentType !== undefined) {
      lines.push(`      contentType: ${yamlString(part.contentType)}`);
    }
  }
}

function writeProxyBlock(lines: string[], proxy: ProxyConfig): void {
  lines.push('proxy:');
  lines.push(`  enabled: ${proxy.enabled}`);
  lines.push(`  url: ${yamlString(proxy.url)}`);
  if (proxy.auth) {
    lines.push('  auth:');
    lines.push(`    username: ${yamlString(proxy.auth.username)}`);
    lines.push(`    password: ${yamlString(proxy.auth.password)}`);
  }
  if (proxy.bypass && proxy.bypass.length > 0) {
    lines.push(`  bypass: [${proxy.bypass.map(yamlString).join(', ')}]`);
  }
}

function writeScrapeDoBlock(lines: string[], config: ScrapeDoConfig): void {
  lines.push('scrapeDo:');
  lines.push(`  enabled: ${config.enabled}`);
  lines.push(`  token: ${yamlString(config.token)}`);
  const optionalKeys: Array<keyof ScrapeDoConfig> = [
    'render',
    'super',
    'geoCode',
    'waitUntil',
    'customHeaders',
  ];
  for (const key of optionalKeys) {
    const value = config[key];
    if (value === undefined) continue;
    lines.push(`  ${key}: ${yamlScalar(value)}`);
  }
}

function writeOptionsBlock(lines: string[], options: RequestOptions): void {
  lines.push('options:');
  if (options.timeout) {
    lines.push('  timeout:');
    if (options.timeout.connect !== undefined)
      lines.push(`    connect: ${options.timeout.connect}`);
    if (options.timeout.read !== undefined)
      lines.push(`    read: ${options.timeout.read}`);
    if (options.timeout.total !== undefined)
      lines.push(`    total: ${options.timeout.total}`);
  }
  if (options.redirect) {
    lines.push('  redirect:');
    lines.push(`    follow: ${options.redirect.follow}`);
    if (options.redirect.maxCount !== undefined) {
      lines.push(`    maxCount: ${options.redirect.maxCount}`);
    }
  }
  if (options.tls) {
    lines.push('  tls:');
    if (options.tls.ignoreInvalidCerts !== undefined)
      lines.push(`    ignoreInvalidCerts: ${options.tls.ignoreInvalidCerts}`);
    if (options.tls.caFile !== undefined)
      lines.push(`    caFile: ${yamlString(options.tls.caFile)}`);
  }
  if (options.httpVersion !== undefined) {
    lines.push(`  httpVersion: ${yamlString(options.httpVersion)}`);
  }
}

function writeMap(
  lines: string[],
  map: Record<string, string>,
  indent: string,
): void {
  for (const [key, value] of Object.entries(map)) {
    lines.push(`${indent}${yamlMapKey(key)}: ${yamlString(value)}`);
  }
}

function extForRawBodyType(type: string): string {
  switch (type) {
    case 'json':
      return 'json';
    case 'xml':
      return 'xml';
    case 'html':
      return 'html';
    case 'javascript':
      return 'js';
    default:
      return 'txt';
  }
}

// YAML-safe string emission. Double-quotes when ambiguous.
// Intentionally conservative: avoids the Norway problem and friends.
const SAFE_UNQUOTED = /^[A-Za-z_][A-Za-z0-9_./:\-+]*$/;
const YAML_RESERVED = new Set([
  'y',
  'Y',
  'yes',
  'Yes',
  'YES',
  'n',
  'N',
  'no',
  'No',
  'NO',
  'true',
  'True',
  'TRUE',
  'false',
  'False',
  'FALSE',
  'on',
  'On',
  'ON',
  'off',
  'Off',
  'OFF',
  'null',
  'Null',
  'NULL',
  '~',
]);

function yamlString(value: string): string {
  if (value === '') return '""';
  if (YAML_RESERVED.has(value)) return doubleQuote(value);
  if (/^[0-9+\-.]/.test(value) && /^[\-+]?(\d+\.?\d*|\.\d+)([eE][\-+]?\d+)?$/.test(value)) {
    return doubleQuote(value);
  }
  if (!SAFE_UNQUOTED.test(value)) return doubleQuote(value);
  return value;
}

function yamlMapKey(key: string): string {
  return yamlString(key);
}

function yamlScalar(value: unknown): string {
  if (typeof value === 'string') return yamlString(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (value === null) return 'null';
  return yamlString(String(value));
}

function doubleQuote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
