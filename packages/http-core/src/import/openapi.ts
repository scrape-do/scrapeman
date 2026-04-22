import { parse as parseYaml } from 'yaml';
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
// Loose typings for OpenAPI 3.x / Swagger 2.0 specs.
// We intentionally keep these permissive to tolerate real-world variance.
// ---------------------------------------------------------------------------

interface OaSchema {
  type?: string;
  format?: string;
  properties?: Record<string, OaSchema>;
  items?: OaSchema;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  $ref?: string;
  allOf?: OaSchema[];
  anyOf?: OaSchema[];
  oneOf?: OaSchema[];
}

interface OaMediaType {
  schema?: OaSchema;
  example?: unknown;
  examples?: Record<string, { value?: unknown; summary?: string }>;
}

interface OaParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  schema?: OaSchema;
  example?: unknown;
}

interface OaRequestBody {
  required?: boolean;
  content?: Record<string, OaMediaType>;
}

interface OaSecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
  scheme?: string;
  bearerFormat?: string;
  in?: 'header' | 'query' | 'cookie';
  name?: string;
  flows?: {
    clientCredentials?: {
      tokenUrl?: string;
      scopes?: Record<string, string>;
    };
    implicit?: { authorizationUrl?: string; scopes?: Record<string, string> };
    authorizationCode?: {
      authorizationUrl?: string;
      tokenUrl?: string;
      scopes?: Record<string, string>;
    };
  };
}

interface OaOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OaParameter[];
  requestBody?: OaRequestBody;
  security?: Array<Record<string, string[]>>;
}

interface OaServer {
  url: string;
}

interface OaComponents {
  securitySchemes?: Record<string, OaSecurityScheme | { $ref: string }>;
  schemas?: Record<string, OaSchema>;
}

// OpenAPI 3.x
interface OpenApi3Doc {
  openapi: string;
  info?: { title?: string };
  servers?: OaServer[];
  paths?: Record<string, Record<string, OaOperation>>;
  components?: OaComponents;
  security?: Array<Record<string, string[]>>;
}

// Swagger 2.0
interface Swagger2Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: 'query' | 'header' | 'path' | 'body' | 'formData';
    required?: boolean;
    schema?: OaSchema;
    type?: string;
    example?: unknown;
  }>;
  consumes?: string[];
  security?: Array<Record<string, string[]>>;
}

interface Swagger2SecurityDef {
  type: 'basic' | 'apiKey' | 'oauth2';
  in?: 'header' | 'query';
  name?: string;
  flow?: string;
  tokenUrl?: string;
  authorizationUrl?: string;
  scopes?: Record<string, string>;
}

interface Swagger2Doc {
  swagger: string;
  info?: { title?: string };
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, Swagger2Operation>>;
  securityDefinitions?: Record<string, Swagger2SecurityDef>;
  security?: Array<Record<string, string[]>>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse an OpenAPI 3.0.x / 3.1.x or Swagger 2.0 spec.
 * Accepts JSON or YAML string — format is auto-detected.
 */
export function importOpenApiSpec(input: string): ImportResult {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = parseSpec(input);
  } catch (err) {
    return {
      requests: [],
      folders: [],
      environments: [],
      warnings: [
        `Failed to parse spec: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      requests: [],
      folders: [],
      environments: [],
      warnings: ['Spec is not an object'],
    };
  }

  const doc = parsed as Record<string, unknown>;

  if (typeof doc['openapi'] === 'string') {
    return importOpenApi3(doc as unknown as OpenApi3Doc, warnings);
  }
  if (typeof doc['swagger'] === 'string') {
    return importSwagger2(doc as unknown as Swagger2Doc, warnings);
  }

  return {
    requests: [],
    folders: [],
    environments: [],
    warnings: ['Unrecognised spec: missing "openapi" or "swagger" version field'],
  };
}

// ---------------------------------------------------------------------------
// OpenAPI 3.x
// ---------------------------------------------------------------------------

function importOpenApi3(doc: OpenApi3Doc, warnings: string[]): ImportResult {
  const version = doc.openapi ?? '3.x';
  if (!version.startsWith('3.')) {
    warnings.push(`Unrecognised openapi version "${version}". Attempting import.`);
  }

  const baseUrl = doc.servers?.[0]?.url ?? '';
  const envVariables: EnvironmentVariable[] = [
    { key: 'base_url', value: baseUrl, enabled: true, secret: false },
  ];

  // Collect auth-related env variable stubs.
  const schemeVars = collectSchemeVars3(doc.components?.securitySchemes ?? {}, warnings);
  for (const v of schemeVars) {
    envVariables.push(v);
  }

  const envName = doc.info?.title ?? 'OpenAPI import';

  // Group requests by tag.
  const foldersByTag = new Map<string, ImportFolder>();
  const topRequests: ScrapemanRequest[] = [];
  const topFolders: ImportFolder[] = [];

  for (const [pathPattern, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const httpMethod = method.toUpperCase();
      if (!isHttpMethod(httpMethod)) continue;
      if (typeof operation !== 'object' || operation === null) continue;

      const op = operation as OaOperation;
      const name = op.operationId ?? op.summary ?? `${httpMethod} ${pathPattern}`;

      // Build URL: prefix with {{base_url}} and substitute path params.
      const url = buildUrl3(pathPattern, op.parameters ?? []);

      // Parameters.
      const params: Record<string, string> = {};
      const headers: Record<string, string> = {};
      for (const param of op.parameters ?? []) {
        if (param.in === 'query') {
          params[param.name] = exampleFromParam(param);
        } else if (param.in === 'header') {
          headers[param.name] = exampleFromParam(param);
        } else if (param.in === 'cookie') {
          // TODO: map cookie params to a Cookie header value
        }
      }

      // Body.
      const body = buildBody3(op.requestBody, doc.components?.schemas, warnings, name);

      // Auth.
      const auth = resolveAuth3(
        op.security ?? doc.security,
        doc.components?.securitySchemes ?? {},
        warnings,
        name,
      );

      const req: ScrapemanRequest = {
        scrapeman: FORMAT_VERSION,
        meta: {
          name,
          ...(op.description ? { description: op.description } : {}),
        },
        method: httpMethod,
        url,
        ...(Object.keys(params).length > 0 ? { params } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(auth ? { auth } : {}),
        ...(body ? { body } : {}),
      };

      const tag = op.tags?.[0];
      if (tag) {
        let folder = foldersByTag.get(tag);
        if (!folder) {
          folder = { name: tag, requests: [], folders: [] };
          foldersByTag.set(tag, folder);
          topFolders.push(folder);
        }
        folder.requests.push(req);
      } else {
        topRequests.push(req);
      }
    }
  }

  return {
    requests: topRequests,
    folders: topFolders,
    environments: [{ name: envName, variables: envVariables }],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Swagger 2.0
// ---------------------------------------------------------------------------

function importSwagger2(doc: Swagger2Doc, warnings: string[]): ImportResult {
  const scheme = doc.schemes?.[0] ?? 'https';
  const host = doc.host ?? '';
  const basePath = doc.basePath ?? '';
  const baseUrl = host ? `${scheme}://${host}${basePath}` : '';

  const envVariables: EnvironmentVariable[] = [
    { key: 'base_url', value: baseUrl, enabled: true, secret: false },
  ];

  const schemeVars = collectSchemeVars2(doc.securityDefinitions ?? {}, warnings);
  for (const v of schemeVars) {
    envVariables.push(v);
  }

  const envName = doc.info?.title ?? 'Swagger 2.0 import';

  const foldersByTag = new Map<string, ImportFolder>();
  const topRequests: ScrapemanRequest[] = [];
  const topFolders: ImportFolder[] = [];

  for (const [pathPattern, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const httpMethod = method.toUpperCase();
      if (!isHttpMethod(httpMethod)) continue;
      if (typeof operation !== 'object' || operation === null) continue;

      const op = operation as Swagger2Operation;
      const name = op.operationId ?? op.summary ?? `${httpMethod} ${pathPattern}`;

      // Substitute path params.
      const pathParams: string[] = [];
      for (const p of op.parameters ?? []) {
        if (p.in === 'path') pathParams.push(p.name);
      }
      let urlPath = pathPattern;
      for (const p of pathParams) {
        urlPath = urlPath.replace(`{${p}}`, `{{${p}}}`);
      }
      const url = `{{base_url}}${urlPath}`;

      const params: Record<string, string> = {};
      const headers: Record<string, string> = {};

      for (const p of op.parameters ?? []) {
        if (p.in === 'query') {
          params[p.name] = String(p.example ?? '');
        } else if (p.in === 'header') {
          headers[p.name] = String(p.example ?? '');
        }
      }

      // Swagger 2.0 body: single `body` parameter with schema, or `formData` params.
      const body = buildBody2(op.parameters ?? [], op.consumes, warnings, name);

      const auth = resolveAuth2(
        op.security ?? doc.security,
        doc.securityDefinitions ?? {},
        warnings,
        name,
      );

      const req: ScrapemanRequest = {
        scrapeman: FORMAT_VERSION,
        meta: {
          name,
          ...(op.description ? { description: op.description } : {}),
        },
        method: httpMethod,
        url,
        ...(Object.keys(params).length > 0 ? { params } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(auth ? { auth } : {}),
        ...(body ? { body } : {}),
      };

      const tag = op.tags?.[0];
      if (tag) {
        let folder = foldersByTag.get(tag);
        if (!folder) {
          folder = { name: tag, requests: [], folders: [] };
          foldersByTag.set(tag, folder);
          topFolders.push(folder);
        }
        folder.requests.push(req);
      } else {
        topRequests.push(req);
      }
    }
  }

  return {
    requests: topRequests,
    folders: topFolders,
    environments: [{ name: envName, variables: envVariables }],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function buildUrl3(pathPattern: string, parameters: OaParameter[]): string {
  let path = pathPattern;
  for (const p of parameters) {
    if (p.in === 'path') {
      // Replace {paramName} with {{paramName}} (Scrapeman variable syntax).
      path = path.replace(`{${p.name}}`, `{{${p.name}}}`);
    }
  }
  return `{{base_url}}${path}`;
}

function isHttpMethod(method: string): boolean {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'].includes(
    method,
  );
}

// ---------------------------------------------------------------------------
// Body helpers
// ---------------------------------------------------------------------------

const CONTENT_TYPE_PREFERENCE = [
  'application/json',
  'application/xml',
  'text/plain',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
] as const;

function buildBody3(
  requestBody: OaRequestBody | undefined,
  schemasMap: Record<string, OaSchema> | undefined,
  warnings: string[],
  opName: string,
): BodyConfig | null {
  if (!requestBody?.content) return null;

  const content = requestBody.content;

  // Pick the most preferred content type available.
  let chosenType: string | undefined;
  let chosenMedia: OaMediaType | undefined;

  for (const ct of CONTENT_TYPE_PREFERENCE) {
    if (ct in content) {
      chosenType = ct;
      chosenMedia = content[ct];
      break;
    }
  }

  if (!chosenType || !chosenMedia) {
    // Fall back to first available.
    const firstKey = Object.keys(content)[0];
    if (!firstKey) return null;
    chosenType = firstKey;
    const fallbackMedia = content[firstKey];
    if (!fallbackMedia) return null;
    chosenMedia = fallbackMedia;
  }

  // At this point both chosenType and chosenMedia are non-null.
  const resolvedMedia: OaMediaType = chosenMedia;

  if (chosenType === 'application/x-www-form-urlencoded') {
    const fields = buildFormFields(resolvedMedia.schema, schemasMap);
    return { type: 'formUrlEncoded', fields };
  }

  if (chosenType === 'multipart/form-data') {
    const fields = buildFormFields(resolvedMedia.schema, schemasMap);
    return {
      type: 'multipart',
      parts: Object.entries(fields).map(([k, v]) => ({
        name: k,
        type: 'text' as const,
        value: v,
      })),
    };
  }

  // Get example content.
  const exampleContent = extractBodyContent(resolvedMedia, chosenType, schemasMap, warnings, opName);
  const bodyType = mimeToBodyType(chosenType);
  return { type: bodyType, content: exampleContent };
}

function buildBody2(
  parameters: Swagger2Operation['parameters'],
  consumes: string[] | undefined,
  warnings: string[],
  opName: string,
): BodyConfig | null {
  if (!parameters?.length) return null;

  const bodyParam = parameters.find((p) => p.in === 'body');
  const formParams = parameters.filter((p) => p.in === 'formData');

  if (formParams.length > 0) {
    const preferredContentType = consumes?.includes('multipart/form-data')
      ? 'multipart/form-data'
      : 'application/x-www-form-urlencoded';

    if (preferredContentType === 'multipart/form-data') {
      return {
        type: 'multipart',
        parts: formParams.map((p) => ({
          name: p.name,
          type: 'text' as const,
          value: String(p.example ?? ''),
        })),
      };
    }
    const fields: Record<string, string> = {};
    for (const p of formParams) {
      fields[p.name] = String(p.example ?? '');
    }
    return { type: 'formUrlEncoded', fields };
  }

  if (bodyParam?.schema) {
    const preferredCt = pickPreferredMime(consumes) ?? 'application/json';
    const bodyType = mimeToBodyType(preferredCt);
    const exampleValue = generateExample(bodyParam.schema, undefined, 0);
    let content: string;
    try {
      content = JSON.stringify(exampleValue, null, 2);
    } catch {
      content = '{}';
      warnings.push(`"${opName}": failed to serialise body example`);
    }
    return { type: bodyType, content };
  }

  return null;
}

function pickPreferredMime(consumes: string[] | undefined): string | undefined {
  if (!consumes?.length) return undefined;
  for (const ct of CONTENT_TYPE_PREFERENCE) {
    if (consumes.includes(ct)) return ct;
  }
  return consumes[0];
}

function buildFormFields(
  schema: OaSchema | undefined,
  schemasMap: Record<string, OaSchema> | undefined,
): Record<string, string> {
  if (!schema) return {};
  const resolved = resolveRef(schema, schemasMap);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(resolved.properties ?? {})) {
    const rv = resolveRef(v, schemasMap);
    fields[k] = String(rv.example ?? rv.default ?? '');
  }
  return fields;
}

function extractBodyContent(
  media: OaMediaType,
  contentType: string,
  schemasMap: Record<string, OaSchema> | undefined,
  warnings: string[],
  opName: string,
): string {
  // Prefer explicit examples first.
  if (media.example !== undefined) {
    return serializeExample(media.example, contentType, warnings, opName);
  }

  if (media.examples) {
    const firstKey = Object.keys(media.examples)[0];
    if (firstKey) {
      const exampleObj = media.examples[firstKey];
      if (exampleObj?.value !== undefined) {
        return serializeExample(exampleObj.value, contentType, warnings, opName);
      }
    }
  }

  if (media.schema) {
    const resolved = resolveRef(media.schema, schemasMap);
    // Check for example in schema itself.
    if (resolved.example !== undefined) {
      return serializeExample(resolved.example, contentType, warnings, opName);
    }
    // Generate from schema.
    const generated = generateExample(resolved, schemasMap, 0);
    return serializeExample(generated, contentType, warnings, opName);
  }

  return '';
}

function serializeExample(
  value: unknown,
  contentType: string,
  warnings: string[],
  opName: string,
): string {
  if (typeof value === 'string') return value;
  if (contentType === 'application/json' || /json/i.test(contentType)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      warnings.push(`"${opName}": failed to serialise example as JSON`);
      return '';
    }
  }
  return String(value);
}

function mimeToBodyType(
  mime: string,
): 'json' | 'xml' | 'text' | 'html' | 'javascript' {
  if (/json/i.test(mime)) return 'json';
  if (/xml/i.test(mime)) return 'xml';
  if (/html/i.test(mime)) return 'html';
  if (/javascript/i.test(mime)) return 'javascript';
  return 'text';
}

// ---------------------------------------------------------------------------
// Example generation from JSON Schema
// ---------------------------------------------------------------------------

const MAX_EXAMPLE_DEPTH = 5;

/**
 * Generate a minimal example value from a JSON Schema.
 * Handles $ref (one level; local only), objects, arrays, primitives.
 */
function generateExample(
  schema: OaSchema,
  schemasMap: Record<string, OaSchema> | undefined,
  depth: number,
): unknown {
  if (depth > MAX_EXAMPLE_DEPTH) return null;

  // Use explicit example/default if present.
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  // Resolve $ref before processing.
  const resolved = resolveRef(schema, schemasMap);
  if (resolved !== schema) {
    return generateExample(resolved, schemasMap, depth);
  }

  // allOf / anyOf / oneOf: pick first sub-schema.
  const composites = schema.allOf ?? schema.anyOf ?? schema.oneOf;
  if (composites?.length) {
    return generateExample(composites[0]!, schemasMap, depth);
  }

  switch (schema.type) {
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) {
        obj[k] = generateExample(v, schemasMap, depth + 1);
      }
      return obj;
    }
    case 'array':
      return schema.items ? [generateExample(schema.items, schemasMap, depth + 1)] : [];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return schema.format === 'date-time'
        ? '2024-01-01T00:00:00Z'
        : schema.format === 'date'
          ? '2024-01-01'
          : schema.format === 'uuid'
            ? '00000000-0000-0000-0000-000000000000'
            : '';
    default:
      // No type — try to infer from properties.
      if (schema.properties) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(schema.properties)) {
          obj[k] = generateExample(v, schemasMap, depth + 1);
        }
        return obj;
      }
      return null;
  }
}

/**
 * Resolve a $ref schema reference.
 * Supports local refs only (#/components/schemas/Foo or #/definitions/Foo).
 * Returns the original schema if ref is absent or unresolvable.
 */
function resolveRef(
  schema: OaSchema,
  schemasMap: Record<string, OaSchema> | undefined,
): OaSchema {
  if (!schema.$ref) return schema;

  const ref = schema.$ref;

  // Local ref only — reject remote URLs.
  if (!ref.startsWith('#/')) {
    // Remote ref — out of scope.
    return schema;
  }

  if (!schemasMap) return schema;

  // #/components/schemas/Foo  or  #/definitions/Foo
  const parts = ref.split('/').slice(1); // ['components', 'schemas', 'Foo'] or ['definitions', 'Foo']

  // Last segment is the schema name.
  const name = parts[parts.length - 1];
  if (!name) return schema;

  const target = schemasMap[name];
  return target ?? schema;
}

// ---------------------------------------------------------------------------
// Parameter example helpers
// ---------------------------------------------------------------------------

function exampleFromParam(param: OaParameter): string {
  if (param.example !== undefined) return String(param.example);
  if (param.schema?.example !== undefined) return String(param.schema.example);
  if (param.schema?.default !== undefined) return String(param.schema.default);
  return '';
}

// ---------------------------------------------------------------------------
// Auth helpers — OpenAPI 3.x
// ---------------------------------------------------------------------------

function collectSchemeVars3(
  securitySchemes: Record<string, OaSecurityScheme | { $ref: string }>,
  _warnings: string[],
): EnvironmentVariable[] {
  const vars: EnvironmentVariable[] = [];

  for (const [schemeName, schemeDef] of Object.entries(securitySchemes)) {
    if ('$ref' in schemeDef) continue; // $ref in securitySchemes — skip

    const scheme = schemeDef as OaSecurityScheme;
    switch (scheme.type) {
      case 'http':
        if (scheme.scheme === 'bearer') {
          vars.push(envVar(`${toVarName(schemeName)}_TOKEN`));
        } else if (scheme.scheme === 'basic') {
          vars.push(envVar(`${toVarName(schemeName)}_USERNAME`));
          vars.push(envVar(`${toVarName(schemeName)}_PASSWORD`));
        }
        break;
      case 'apiKey':
        vars.push(envVar(`${toVarName(schemeName)}_KEY`));
        break;
      case 'oauth2':
        vars.push(envVar(`${toVarName(schemeName)}_CLIENT_ID`));
        vars.push(envVar(`${toVarName(schemeName)}_CLIENT_SECRET`));
        break;
      default:
        break;
    }
  }

  return vars;
}

function resolveAuth3(
  security: Array<Record<string, string[]>> | undefined,
  securitySchemes: Record<string, OaSecurityScheme | { $ref: string }>,
  warnings: string[],
  opName: string,
): AuthConfig | null {
  if (!security?.length) return null;

  // Use the first security requirement that we can map.
  for (const requirement of security) {
    const schemeName = Object.keys(requirement)[0];
    if (!schemeName) continue;

    const schemeDef = securitySchemes[schemeName];
    if (!schemeDef || '$ref' in schemeDef) continue;

    const scheme = schemeDef as OaSecurityScheme;
    const varBase = toVarName(schemeName);

    switch (scheme.type) {
      case 'http':
        if (scheme.scheme === 'bearer') {
          return { type: 'bearer', token: `{{${varBase}_TOKEN}}` };
        }
        if (scheme.scheme === 'basic') {
          return {
            type: 'basic',
            username: `{{${varBase}_USERNAME}}`,
            password: `{{${varBase}_PASSWORD}}`,
          };
        }
        break;

      case 'apiKey': {
        const inLocation = scheme.in ?? 'header';
        return {
          type: 'apiKey',
          key: scheme.name ?? schemeName,
          value: `{{${varBase}_KEY}}`,
          in: inLocation === 'query' ? 'query' : 'header',
        };
      }

      case 'oauth2': {
        const ccFlow = scheme.flows?.clientCredentials;
        const acFlow = scheme.flows?.authorizationCode;
        const implicitFlow = scheme.flows?.implicit;

        if (ccFlow) {
          return {
            type: 'oauth2',
            flow: 'clientCredentials',
            tokenUrl: ccFlow.tokenUrl ?? '',
            clientId: `{{${varBase}_CLIENT_ID}}`,
            clientSecret: `{{${varBase}_CLIENT_SECRET}}`,
          };
        }
        if (acFlow) {
          return {
            type: 'oauth2',
            flow: 'authorizationCode',
            tokenUrl: acFlow.tokenUrl ?? '',
            authUrl: acFlow.authorizationUrl ?? '',
            clientId: `{{${varBase}_CLIENT_ID}}`,
            clientSecret: `{{${varBase}_CLIENT_SECRET}}`,
          };
        }
        if (implicitFlow) {
          warnings.push(
            `"${opName}": oauth2 implicit flow mapped to authorizationCode (no token URL).`,
          );
          return {
            type: 'oauth2',
            flow: 'authorizationCode',
            tokenUrl: '',
            authUrl: implicitFlow.authorizationUrl ?? '',
            clientId: `{{${varBase}_CLIENT_ID}}`,
            clientSecret: `{{${varBase}_CLIENT_SECRET}}`,
          };
        }
        break;
      }

      default:
        warnings.push(`"${opName}": unsupported security scheme type "${scheme.type}".`);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auth helpers — Swagger 2.0
// ---------------------------------------------------------------------------

function collectSchemeVars2(
  securityDefs: Record<string, Swagger2SecurityDef>,
  _warnings: string[],
): EnvironmentVariable[] {
  const vars: EnvironmentVariable[] = [];

  for (const [schemeName, def] of Object.entries(securityDefs)) {
    switch (def.type) {
      case 'basic':
        vars.push(envVar(`${toVarName(schemeName)}_USERNAME`));
        vars.push(envVar(`${toVarName(schemeName)}_PASSWORD`));
        break;
      case 'apiKey':
        vars.push(envVar(`${toVarName(schemeName)}_KEY`));
        break;
      case 'oauth2':
        vars.push(envVar(`${toVarName(schemeName)}_CLIENT_ID`));
        vars.push(envVar(`${toVarName(schemeName)}_CLIENT_SECRET`));
        break;
      default:
        break;
    }
  }

  return vars;
}

function resolveAuth2(
  security: Array<Record<string, string[]>> | undefined,
  securityDefs: Record<string, Swagger2SecurityDef>,
  warnings: string[],
  opName: string,
): AuthConfig | null {
  if (!security?.length) return null;

  for (const requirement of security) {
    const schemeName = Object.keys(requirement)[0];
    if (!schemeName) continue;

    const def = securityDefs[schemeName];
    if (!def) continue;

    const varBase = toVarName(schemeName);

    switch (def.type) {
      case 'basic':
        return {
          type: 'basic',
          username: `{{${varBase}_USERNAME}}`,
          password: `{{${varBase}_PASSWORD}}`,
        };

      case 'apiKey': {
        const inLocation = def.in ?? 'header';
        return {
          type: 'apiKey',
          key: def.name ?? schemeName,
          value: `{{${varBase}_KEY}}`,
          in: inLocation === 'query' ? 'query' : 'header',
        };
      }

      case 'oauth2': {
        const flow = def.flow === 'application' ? 'clientCredentials' : 'authorizationCode';
        return {
          type: 'oauth2',
          flow,
          tokenUrl: def.tokenUrl ?? '',
          ...(def.authorizationUrl ? { authUrl: def.authorizationUrl } : {}),
          clientId: `{{${varBase}_CLIENT_ID}}`,
          clientSecret: `{{${varBase}_CLIENT_SECRET}}`,
        };
      }

      default:
        warnings.push(`"${opName}": unsupported Swagger 2.0 security type "${def.type}".`);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function parseSpec(input: string): unknown {
  const trimmed = input.trim();

  // Heuristic: JSON starts with `{` or `[`.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  // YAML — use the yaml package which is already a dependency of http-core.
  return parseYaml(trimmed);
}

function toVarName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

function envVar(key: string): EnvironmentVariable {
  return { key, value: '', enabled: true, secret: true };
}

// Re-export types the test file imports.
export type { ImportResult };

// Export convenience aliases so the index barrel just re-exports the function.
export { type ImportFolder, type Environment };
