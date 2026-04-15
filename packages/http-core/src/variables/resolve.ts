import { randomUUID } from 'node:crypto';
import type {
  AuthConfig,
  BodyConfig,
  KeyValue,
  ScrapemanRequest,
} from '@scrapeman/shared-types';

const VAR_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;

// Dynamic built-in variables. Each invocation produces a fresh value, so
// multiple {{random}} occurrences in one request all get distinct UUIDs.
// User-defined env variables take precedence — naming a var `random` in
// the active environment shadows the built-in.
export const BUILTIN_VARIABLES: Record<string, () => string> = {
  random: () => randomUUID(),
  randomUUID: () => randomUUID(),
  uuid: () => randomUUID(),
  timestamp: () => Date.now().toString(),
  timestampSec: () => Math.floor(Date.now() / 1000).toString(),
  isoDate: () => new Date().toISOString(),
  randomInt: () => Math.floor(Math.random() * 1_000_000).toString(),
};

export interface VariableContext {
  variables: Record<string, string>;
}

export interface ResolveOutcome {
  request: ScrapemanRequest;
  unresolved: string[];
}

export function resolveString(input: string, ctx: VariableContext): string {
  return input.replace(VAR_PATTERN, (_match, name: string) => {
    const value = ctx.variables[name];
    if (value !== undefined) return value;
    const builtin = BUILTIN_VARIABLES[name];
    if (builtin) return builtin();
    // Undefined variable: drop the token so the outgoing request does not
    // contain a literal `{{var}}`. `findUnresolved` still reports it via
    // resolveRequest so the UI can warn.
    return '';
  });
}

export function findUnresolved(input: string, ctx: VariableContext): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  VAR_PATTERN.lastIndex = 0;
  while ((match = VAR_PATTERN.exec(input)) !== null) {
    const name = match[1]!;
    if (ctx.variables[name] === undefined && BUILTIN_VARIABLES[name] === undefined) {
      out.push(name);
    }
  }
  return out;
}

export function isBuiltinVariable(name: string): boolean {
  return BUILTIN_VARIABLES[name] !== undefined;
}

export function listBuiltinVariables(): string[] {
  return Object.keys(BUILTIN_VARIABLES);
}

export function resolveRequest(
  request: ScrapemanRequest,
  ctx: VariableContext,
): ResolveOutcome {
  const unresolved = new Set<string>();
  const r = (s: string): string => {
    for (const u of findUnresolved(s, ctx)) unresolved.add(u);
    return resolveString(s, ctx);
  };

  const out: ScrapemanRequest = {
    ...request,
    url: r(request.url),
  };

  if (request.params) out.params = mapValues(request.params, r);
  if (request.headers) out.headers = mapValues(request.headers, r);
  if (request.auth) out.auth = resolveAuth(request.auth, r);
  if (request.body) out.body = resolveBody(request.body, r);
  if (request.proxy) {
    out.proxy = {
      ...request.proxy,
      url: r(request.proxy.url),
      ...(request.proxy.auth
        ? {
            auth: {
              username: r(request.proxy.auth.username),
              password: r(request.proxy.auth.password),
            },
          }
        : {}),
    };
  }
  if (request.scrapeDo) {
    out.scrapeDo = {
      ...request.scrapeDo,
      token: r(request.scrapeDo.token),
      ...(request.scrapeDo.geoCode
        ? { geoCode: r(request.scrapeDo.geoCode) }
        : {}),
    };
  }

  return { request: out, unresolved: Array.from(unresolved) };
}

function mapValues(map: KeyValue, fn: (s: string) => string): KeyValue {
  const out: KeyValue = {};
  for (const [key, value] of Object.entries(map)) out[key] = fn(value);
  return out;
}

function resolveAuth(auth: AuthConfig, r: (s: string) => string): AuthConfig {
  switch (auth.type) {
    case 'none':
      return auth;
    case 'basic':
      return { type: 'basic', username: r(auth.username), password: r(auth.password) };
    case 'bearer':
      return { type: 'bearer', token: r(auth.token) };
    case 'apiKey':
      return { ...auth, key: r(auth.key), value: r(auth.value) };
    case 'oauth2':
      return {
        ...auth,
        tokenUrl: r(auth.tokenUrl),
        ...(auth.authUrl !== undefined ? { authUrl: r(auth.authUrl) } : {}),
        clientId: r(auth.clientId),
        clientSecret: r(auth.clientSecret),
        ...(auth.scope !== undefined ? { scope: r(auth.scope) } : {}),
        ...(auth.audience !== undefined ? { audience: r(auth.audience) } : {}),
      };
    case 'awsSigV4':
      return {
        ...auth,
        accessKeyId: r(auth.accessKeyId),
        secretAccessKey: r(auth.secretAccessKey),
        ...(auth.sessionToken !== undefined
          ? { sessionToken: r(auth.sessionToken) }
          : {}),
        region: r(auth.region),
        service: r(auth.service),
      };
  }
}

function resolveBody(body: BodyConfig, r: (s: string) => string): BodyConfig {
  if (body.type === 'none') return body;
  if (
    body.type === 'json' ||
    body.type === 'xml' ||
    body.type === 'text' ||
    body.type === 'html' ||
    body.type === 'javascript'
  ) {
    return {
      ...body,
      ...(body.content !== undefined ? { content: r(body.content) } : {}),
    };
  }
  if (body.type === 'formUrlEncoded') {
    return { type: 'formUrlEncoded', fields: mapValues(body.fields, r) };
  }
  if (body.type === 'multipart') {
    return {
      type: 'multipart',
      parts: body.parts.map((part) =>
        part.type === 'text'
          ? { ...part, value: r(part.value) }
          : part,
      ),
    };
  }
  return body;
}
