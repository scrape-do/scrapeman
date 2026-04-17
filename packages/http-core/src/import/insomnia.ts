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

// Insomnia v4 resource types we handle.
interface InsomniaResource {
  _id: string;
  _type: string;
  parentId: string | null;
  name?: string;
  [key: string]: unknown;
}

interface InsomniaRequest extends InsomniaResource {
  _type: 'request';
  method: string;
  url: string;
  headers?: Array<{ name: string; value: string; disabled?: boolean }>;
  body?: { mimeType?: string; text?: string; params?: Array<{ name: string; value: string }> };
  authentication?: Record<string, unknown>;
}

interface InsomniaRequestGroup extends InsomniaResource {
  _type: 'request_group';
}

interface InsomniaEnvironment extends InsomniaResource {
  _type: 'environment';
  data?: Record<string, string>;
}

interface InsomniaExport {
  _type: string;
  __export_format: number;
  resources: InsomniaResource[];
}

export class InsomniaImportError extends Error {
  constructor(message: string) {
    super(`Insomnia import: ${message}`);
    this.name = 'InsomniaImportError';
  }
}

/**
 * Parse an Insomnia v4 JSON export and convert its resources to Scrapeman
 * requests, folders, and environments.
 */
export function importInsomniaExport(json: string): ImportResult {
  let data: InsomniaExport;
  try {
    data = JSON.parse(json) as InsomniaExport;
  } catch {
    throw new InsomniaImportError('invalid JSON');
  }

  if (data._type !== 'export' || data.__export_format !== 4) {
    throw new InsomniaImportError(
      `unsupported format: _type="${data._type}", __export_format=${data.__export_format}`,
    );
  }

  if (!Array.isArray(data.resources)) {
    throw new InsomniaImportError('missing resources array');
  }

  const warnings: string[] = [];

  // Index all resources by _id for parent lookups.
  const byId = new Map<string, InsomniaResource>();
  for (const r of data.resources) {
    byId.set(r._id, r);
  }

  // Categorize resources.
  const requests: InsomniaRequest[] = [];
  const groups: InsomniaRequestGroup[] = [];
  const environments: InsomniaEnvironment[] = [];

  for (const r of data.resources) {
    switch (r._type) {
      case 'request':
        requests.push(r as InsomniaRequest);
        break;
      case 'request_group':
        groups.push(r as InsomniaRequestGroup);
        break;
      case 'environment':
        environments.push(r as InsomniaEnvironment);
        break;
      case 'workspace':
        // Root container — skip silently.
        break;
      case 'cookie_jar':
        warnings.push('Cookie jars are not imported');
        break;
      default:
        warnings.push(`Unsupported resource type: ${r._type}`);
        break;
    }
  }

  // Build folder tree. Map group _id to ImportFolder.
  const folderMap = new Map<string, ImportFolder>();
  for (const g of groups) {
    folderMap.set(g._id, { name: g.name ?? 'Unnamed folder', requests: [], folders: [] });
  }

  // Convert requests.
  const convertedRequests = new Map<string, ScrapemanRequest>();
  for (const r of requests) {
    convertedRequests.set(r._id, convertRequest(r));
  }

  // Place requests and sub-folders into their parent folders.
  // Requests whose parent is not a folder go to the root list.
  const rootRequests: ScrapemanRequest[] = [];
  const rootFolders: ImportFolder[] = [];

  for (const r of requests) {
    const req = convertedRequests.get(r._id)!;
    const parentFolder = r.parentId ? folderMap.get(r.parentId) : undefined;
    if (parentFolder) {
      parentFolder.requests.push(req);
    } else {
      rootRequests.push(req);
    }
  }

  // Nest sub-folders.
  for (const g of groups) {
    const folder = folderMap.get(g._id)!;
    const parentFolder = g.parentId ? folderMap.get(g.parentId) : undefined;
    if (parentFolder) {
      parentFolder.folders.push(folder);
    } else {
      rootFolders.push(folder);
    }
  }

  // Convert environments.
  const envs: Environment[] = [];
  for (const e of environments) {
    if (e.data && Object.keys(e.data).length > 0) {
      const variables: EnvironmentVariable[] = Object.entries(e.data).map(
        ([key, value]) => ({
          key,
          value: String(value),
          enabled: true,
          secret: false,
        }),
      );
      envs.push({ name: e.name ?? 'Imported environment', variables });
    }
  }

  return {
    requests: rootRequests,
    folders: rootFolders,
    environments: envs,
    warnings,
  };
}

function convertRequest(r: InsomniaRequest): ScrapemanRequest {
  const req: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name: r.name ?? 'Unnamed request' },
    method: (r.method ?? 'GET').toUpperCase(),
    url: r.url ?? '',
  };

  // Headers — skip disabled ones.
  if (r.headers && r.headers.length > 0) {
    const headers: Record<string, string> = {};
    for (const h of r.headers) {
      if (!h.disabled && h.name) {
        headers[h.name] = h.value ?? '';
      }
    }
    if (Object.keys(headers).length > 0) {
      req.headers = headers;
    }
  }

  // Body
  const body = convertBody(r.body);
  if (body) {
    req.body = body;
  }

  // Auth
  const auth = convertAuth(r.authentication);
  if (auth) {
    req.auth = auth;
  }

  return req;
}

function convertBody(
  body: InsomniaRequest['body'],
): BodyConfig | undefined {
  if (!body) return undefined;

  const mime = body.mimeType ?? '';

  // Form URL-encoded
  if (mime === 'application/x-www-form-urlencoded' && body.params) {
    const fields: Record<string, string> = {};
    for (const p of body.params) {
      fields[p.name] = p.value;
    }
    return { type: 'formUrlEncoded', fields };
  }

  // Multipart
  if (mime === 'multipart/form-data' && body.params) {
    return {
      type: 'multipart',
      parts: body.params.map((p) => ({
        name: p.name,
        type: 'text' as const,
        value: p.value,
      })),
    };
  }

  // Text-based bodies
  if (body.text != null && body.text !== '') {
    const type = mimeToBodyType(mime);
    return { type, content: body.text };
  }

  return undefined;
}

function mimeToBodyType(mime: string): 'json' | 'xml' | 'text' | 'html' | 'javascript' {
  if (/json/i.test(mime)) return 'json';
  if (/xml/i.test(mime)) return 'xml';
  if (/html/i.test(mime)) return 'html';
  if (/javascript/i.test(mime)) return 'javascript';
  return 'text';
}

function convertAuth(
  auth: Record<string, unknown> | undefined,
): AuthConfig | undefined {
  if (!auth || !auth.type || auth.type === 'none') return undefined;

  switch (auth.type) {
    case 'basic':
      return {
        type: 'basic',
        username: String(auth.username ?? ''),
        password: String(auth.password ?? ''),
      };
    case 'bearer':
      return {
        type: 'bearer',
        token: String(auth.token ?? ''),
      };
    case 'oauth2': {
      const oauth2: AuthConfig = {
        type: 'oauth2',
        flow: 'authorizationCode',
        tokenUrl: String(auth.accessTokenUrl ?? ''),
        authUrl: String(auth.authorizationUrl ?? ''),
        clientId: String(auth.clientId ?? ''),
        clientSecret: String(auth.clientSecret ?? ''),
      };
      if (auth.scope) oauth2.scope = String(auth.scope);
      return oauth2;
    }
    case 'apikey':
      return {
        type: 'apiKey',
        key: String(auth.key ?? ''),
        value: String(auth.value ?? ''),
        in: auth.addTo === 'querystring' ? 'query' : 'header',
      };
    case 'iam': {
      // Insomnia's AWS IAM auth
      const sigv4: AuthConfig = {
        type: 'awsSigV4',
        accessKeyId: String(auth.accessKeyId ?? ''),
        secretAccessKey: String(auth.secretAccessKey ?? ''),
        region: String(auth.region ?? ''),
        service: String(auth.service ?? ''),
      };
      if (auth.sessionToken) sigv4.sessionToken = String(auth.sessionToken);
      return sigv4;
    }
    default:
      return undefined;
  }
}
