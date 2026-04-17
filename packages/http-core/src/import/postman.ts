import {
  FORMAT_VERSION,
  type AuthConfig,
  type BodyConfig,
  type Environment,
  type EnvironmentVariable,
  type ImportFolder,
  type ImportResult,
  type ScrapemanRequest,
} from '@scrapeman/shared-types';

// ---------------------------------------------------------------------------
// Postman Collection v2.1 importer
// ---------------------------------------------------------------------------

// Subset of the Postman v2.1 schema we care about.
// We intentionally keep these loose (`any` avoided, but unions are broad)
// to tolerate real-world exports that may deviate from the spec.

interface PmKeyValue {
  key: string;
  value: string;
  disabled?: boolean;
  type?: string;
  description?: string;
}

interface PmUrl {
  raw?: string;
  protocol?: string;
  host?: string | string[];
  port?: string;
  path?: string | string[];
  query?: PmKeyValue[];
  variable?: PmKeyValue[];
}

interface PmBody {
  mode?: string;
  raw?: string;
  options?: { raw?: { language?: string } };
  urlencoded?: PmKeyValue[];
  formdata?: Array<PmKeyValue & { src?: string }>;
  file?: { src?: string };
  graphql?: { query?: string; variables?: string };
}

interface PmAuthParam {
  key: string;
  value: string;
  type?: string;
}

interface PmAuth {
  type: string;
  basic?: PmAuthParam[];
  bearer?: PmAuthParam[];
  apikey?: PmAuthParam[];
  oauth2?: PmAuthParam[];
  awsv4?: PmAuthParam[];
  [key: string]: unknown;
}

interface PmRequest {
  method?: string;
  url?: string | PmUrl;
  header?: PmKeyValue[];
  body?: PmBody;
  auth?: PmAuth;
  description?: string;
}

interface PmItem {
  name?: string;
  request?: PmRequest;
  item?: PmItem[];
  auth?: PmAuth;
  description?: string;
  event?: unknown[];
}

interface PmVariable {
  key: string;
  value: string;
  disabled?: boolean;
  type?: string;
}

interface PmCollection {
  info?: { name?: string; schema?: string; description?: string };
  item?: PmItem[];
  variable?: PmVariable[];
  auth?: PmAuth;
  event?: unknown[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function importPostmanCollection(json: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      requests: [],
      folders: [],
      environments: [],
      warnings: ['Failed to parse JSON input'],
    };
  }

  const collection = raw as PmCollection;
  const warnings: string[] = [];

  // Validate it looks like a Postman v2.1 collection.
  const schema = collection.info?.schema ?? '';
  if (!schema.includes('v2.1') && !schema.includes('v2.0')) {
    warnings.push(
      `Unrecognised Postman schema: "${schema}". Attempting import anyway.`,
    );
  }

  // Top-level scripts are unsupported.
  if (collection.event?.length) {
    warnings.push('Collection-level scripts (pre-request / test) were skipped.');
  }

  // Process items recursively.
  const topRequests: ScrapemanRequest[] = [];
  const topFolders: ImportFolder[] = [];

  for (const item of collection.item ?? []) {
    processItem(item, topRequests, topFolders, warnings);
  }

  // Variables -> environment.
  const environments: Environment[] = [];
  if (collection.variable?.length) {
    const vars: EnvironmentVariable[] = collection.variable.map((v) => ({
      key: v.key,
      value: v.value ?? '',
      enabled: !v.disabled,
      secret: false,
    }));
    environments.push({ name: collection.info?.name ?? 'Postman Variables', variables: vars });
  }

  return { requests: topRequests, folders: topFolders, environments, warnings };
}

// ---------------------------------------------------------------------------
// Recursive item processing
// ---------------------------------------------------------------------------

function processItem(
  item: PmItem,
  requests: ScrapemanRequest[],
  folders: ImportFolder[],
  warnings: string[],
): void {
  // A folder has nested `item[]` and no `request`.
  if (item.item && !item.request) {
    const folder: ImportFolder = {
      name: item.name ?? 'Unnamed Folder',
      requests: [],
      folders: [],
    };

    if (item.event?.length) {
      warnings.push(`Folder "${folder.name}": scripts were skipped.`);
    }

    for (const child of item.item) {
      processItem(child, folder.requests, folder.folders, warnings);
    }

    folders.push(folder);
    return;
  }

  // Otherwise it's a request.
  if (!item.request) return;

  const req = convertRequest(item.name ?? 'Unnamed Request', item.request, warnings);
  requests.push(req);
}

// ---------------------------------------------------------------------------
// Request conversion
// ---------------------------------------------------------------------------

function convertRequest(
  name: string,
  pm: PmRequest,
  warnings: string[],
): ScrapemanRequest {
  const req: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name, ...(pm.description ? { description: pm.description } : {}) },
    method: (pm.method ?? 'GET').toUpperCase(),
    url: resolveUrl(pm.url),
  };

  // Query params from structured URL.
  const params = extractParams(pm.url);
  if (params && Object.keys(params).length > 0) {
    req.params = params;
  }

  // Headers.
  if (pm.header?.length) {
    const headers: Record<string, string> = {};
    for (const h of pm.header) {
      if (!h.disabled) {
        headers[h.key] = h.value;
      }
    }
    if (Object.keys(headers).length > 0) {
      req.headers = headers;
    }
  }

  // Auth.
  if (pm.auth) {
    const auth = convertAuth(pm.auth, warnings, name);
    if (auth) req.auth = auth;
  }

  // Body.
  if (pm.body) {
    const body = convertBody(pm.body, warnings, name);
    if (body) req.body = body;
  }

  return req;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function resolveUrl(url: string | PmUrl | undefined): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  if (url.raw) return url.raw;

  // Build from structured parts.
  const protocol = url.protocol ? `${url.protocol}://` : 'https://';
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '');
  const port = url.port ? `:${url.port}` : '';
  const path = Array.isArray(url.path) ? '/' + url.path.join('/') : (url.path ?? '');
  return `${protocol}${host}${port}${path}`;
}

function extractParams(url: string | PmUrl | undefined): Record<string, string> | null {
  if (!url || typeof url === 'string') return null;
  if (!url.query?.length) return null;

  const params: Record<string, string> = {};
  for (const q of url.query) {
    if (!q.disabled) {
      params[q.key] = q.value;
    }
  }
  return Object.keys(params).length > 0 ? params : null;
}

// ---------------------------------------------------------------------------
// Auth conversion
// ---------------------------------------------------------------------------

function authParam(params: PmAuthParam[] | undefined, key: string): string {
  return params?.find((p) => p.key === key)?.value ?? '';
}

function convertAuth(
  pm: PmAuth,
  warnings: string[],
  reqName: string,
): AuthConfig | null {
  switch (pm.type) {
    case 'noauth':
      return { type: 'none' };

    case 'basic':
      return {
        type: 'basic',
        username: authParam(pm.basic, 'username'),
        password: authParam(pm.basic, 'password'),
      };

    case 'bearer':
      return {
        type: 'bearer',
        token: authParam(pm.bearer, 'token'),
      };

    case 'apikey': {
      const key = authParam(pm.apikey, 'key');
      const value = authParam(pm.apikey, 'value');
      const inLocation = authParam(pm.apikey, 'in');
      return {
        type: 'apiKey',
        key,
        value,
        in: inLocation === 'query' ? 'query' : 'header',
      };
    }

    case 'oauth2': {
      const scope = authParam(pm.oauth2, 'scope');
      return {
        type: 'oauth2',
        flow: 'clientCredentials',
        tokenUrl: authParam(pm.oauth2, 'accessTokenUrl'),
        clientId: authParam(pm.oauth2, 'clientId'),
        clientSecret: authParam(pm.oauth2, 'clientSecret'),
        ...(scope ? { scope } : {}),
      };
    }

    case 'awsv4': {
      const sessionToken = authParam(pm.awsv4, 'sessionToken');
      return {
        type: 'awsSigV4',
        accessKeyId: authParam(pm.awsv4, 'accessKey'),
        secretAccessKey: authParam(pm.awsv4, 'secretKey'),
        ...(sessionToken ? { sessionToken } : {}),
        region: authParam(pm.awsv4, 'region'),
        service: authParam(pm.awsv4, 'service'),
      };
    }

    default:
      warnings.push(`"${reqName}": unsupported auth type "${pm.type}".`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Body conversion
// ---------------------------------------------------------------------------

function convertBody(
  pm: PmBody,
  warnings: string[],
  reqName: string,
): BodyConfig | null {
  switch (pm.mode) {
    case 'raw': {
      const lang = pm.options?.raw?.language;
      let type: 'json' | 'xml' | 'text' | 'html' | 'javascript' = 'text';
      if (lang === 'json') type = 'json';
      else if (lang === 'xml') type = 'xml';
      else if (lang === 'html') type = 'html';
      else if (lang === 'javascript') type = 'javascript';
      else if (!lang) {
        // Try to detect JSON from content.
        const trimmed = (pm.raw ?? '').trim();
        if (
          (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))
        ) {
          try {
            JSON.parse(trimmed);
            type = 'json';
          } catch {
            /* keep text */
          }
        }
      }
      return { type, content: pm.raw ?? '' };
    }

    case 'urlencoded': {
      const fields: Record<string, string> = {};
      for (const f of pm.urlencoded ?? []) {
        if (!f.disabled) fields[f.key] = f.value;
      }
      return { type: 'formUrlEncoded', fields };
    }

    case 'formdata': {
      const parts = (pm.formdata ?? [])
        .filter((f) => !f.disabled)
        .map((f) => {
          if (f.type === 'file') {
            return { name: f.key, type: 'file' as const, file: f.src ?? f.value ?? '' };
          }
          return { name: f.key, type: 'text' as const, value: f.value };
        });
      return { type: 'multipart', parts };
    }

    case 'file':
      return { type: 'binary', file: pm.file?.src ?? '' };

    case 'graphql': {
      // Encode GraphQL as JSON body.
      const gql: Record<string, string> = {};
      if (pm.graphql?.query) gql.query = pm.graphql.query;
      if (pm.graphql?.variables) gql.variables = pm.graphql.variables;
      return { type: 'json', content: JSON.stringify(gql, null, 2) };
    }

    default:
      if (pm.mode) {
        warnings.push(`"${reqName}": unsupported body mode "${pm.mode}".`);
      }
      return null;
  }
}
