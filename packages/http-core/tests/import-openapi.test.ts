import { describe, expect, it } from 'vitest';
import { importOpenApiSpec } from '../src/import/openapi.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spec3(
  paths: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Test API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths,
    ...extra,
  });
}

function spec2(
  paths: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    swagger: '2.0',
    info: { title: 'Test Swagger', version: '1.0.0' },
    host: 'api.example.com',
    basePath: '/v1',
    schemes: ['https'],
    paths,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 1. Unrecognised input
// ---------------------------------------------------------------------------

describe('invalid input', () => {
  it('returns warning for non-JSON, non-YAML', () => {
    const result = importOpenApiSpec('not valid $$$ yaml:::: {{{ broken');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.requests).toHaveLength(0);
  });

  it('returns warning when neither openapi nor swagger field present', () => {
    const result = importOpenApiSpec('{"info": {"title": "no version"}}');
    expect(result.warnings).toContain(
      'Unrecognised spec: missing "openapi" or "swagger" version field',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. OpenAPI 3.0 — basic path parsing
// ---------------------------------------------------------------------------

describe('OpenAPI 3.0 — basic parsing', () => {
  it('creates one request per (path, method)', () => {
    const input = spec3({
      '/users': {
        get: { operationId: 'listUsers', summary: 'List users', tags: ['Users'] },
        post: { operationId: 'createUser', summary: 'Create user', tags: ['Users'] },
      },
      '/health': {
        get: { operationId: 'healthCheck' },
      },
    });
    const result = importOpenApiSpec(input);
    const allReqs = [
      ...result.requests,
      ...result.folders.flatMap((f) => f.requests),
    ];
    expect(allReqs).toHaveLength(3);
  });

  it('groups requests by tag into folders', () => {
    const input = spec3({
      '/users': {
        get: { operationId: 'listUsers', tags: ['Users'] },
        post: { operationId: 'createUser', tags: ['Users'] },
      },
      '/orders': {
        get: { operationId: 'listOrders', tags: ['Orders'] },
      },
    });
    const result = importOpenApiSpec(input);
    expect(result.folders).toHaveLength(2);
    const users = result.folders.find((f) => f.name === 'Users');
    expect(users?.requests).toHaveLength(2);
    const orders = result.folders.find((f) => f.name === 'Orders');
    expect(orders?.requests).toHaveLength(1);
    expect(result.requests).toHaveLength(0);
  });

  it('places untagged operations at top level', () => {
    const input = spec3({
      '/health': {
        get: { operationId: 'healthCheck' },
      },
    });
    const result = importOpenApiSpec(input);
    expect(result.requests).toHaveLength(1);
    expect(result.folders).toHaveLength(0);
  });

  it('writes base_url env var from servers[0].url', () => {
    const result = importOpenApiSpec(spec3({}));
    const env = result.environments[0];
    expect(env).toBeDefined();
    const baseVar = env!.variables.find((v) => v.key === 'base_url');
    expect(baseVar?.value).toBe('https://api.example.com');
  });

  it('prefixes request URL with {{base_url}}', () => {
    const result = importOpenApiSpec(
      spec3({ '/users': { get: { operationId: 'listUsers' } } }),
    );
    const req = [...result.requests, ...result.folders.flatMap((f) => f.requests)][0];
    expect(req?.url).toBe('{{base_url}}/users');
  });

  it('uses operationId as request name, fallback to summary then METHOD path', () => {
    const input = spec3({
      '/a': { get: { operationId: 'getA' } },
      '/b': { get: { summary: 'Get B' } },
      '/c': { get: {} },
    });
    const result = importOpenApiSpec(input);
    const names = [
      ...result.requests,
      ...result.folders.flatMap((f) => f.requests),
    ].map((r) => r.meta.name);
    expect(names).toContain('getA');
    expect(names).toContain('Get B');
    expect(names).toContain('GET /c');
  });
});

// ---------------------------------------------------------------------------
// 3. Parameters — query, header, path
// ---------------------------------------------------------------------------

describe('parameters', () => {
  it('maps query params to request.params', () => {
    const input = spec3({
      '/search': {
        get: {
          operationId: 'search',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string', example: 'hello' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', example: 10 } },
          ],
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.params).toEqual({ q: 'hello', limit: '10' });
  });

  it('maps header params to request.headers', () => {
    const input = spec3({
      '/data': {
        get: {
          operationId: 'getData',
          parameters: [
            { name: 'X-Request-ID', in: 'header', schema: { type: 'string', example: '123' } },
          ],
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.headers?.['X-Request-ID']).toBe('123');
  });

  it('substitutes path params as {{paramName}} in URL', () => {
    const input = spec3({
      '/users/{userId}/posts/{postId}': {
        get: {
          operationId: 'getUserPost',
          parameters: [
            { name: 'userId', in: 'path' },
            { name: 'postId', in: 'path' },
          ],
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.url).toBe('{{base_url}}/users/{{userId}}/posts/{{postId}}');
  });
});

// ---------------------------------------------------------------------------
// 4. Request body with explicit example
// ---------------------------------------------------------------------------

describe('request body — explicit example', () => {
  it('copies example from media type example field', () => {
    const example = { name: 'Alice', email: 'alice@example.com' };
    const input = spec3({
      '/users': {
        post: {
          operationId: 'createUser',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                example,
              },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.body?.type).toBe('json');
    if (req.body?.type === 'json') {
      expect(JSON.parse(req.body.content ?? '')).toEqual(example);
    }
  });

  it('copies value from examples map when present', () => {
    const value = { id: 42 };
    const input = spec3({
      '/items': {
        post: {
          operationId: 'createItem',
          requestBody: {
            content: {
              'application/json': {
                examples: {
                  item: { value },
                },
              },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    if (req.body?.type === 'json') {
      expect(JSON.parse(req.body.content ?? '')).toEqual(value);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Request body generated from schema (no example)
// ---------------------------------------------------------------------------

describe('request body — schema-generated example', () => {
  it('generates non-empty example from object schema', () => {
    const input = spec3({
      '/widgets': {
        post: {
          operationId: 'createWidget',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    count: { type: 'integer' },
                    active: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.body?.type).toBe('json');
    if (req.body?.type === 'json') {
      const parsed = JSON.parse(req.body.content ?? '');
      expect(parsed).toHaveProperty('name');
      expect(parsed).toHaveProperty('count');
      expect(parsed).toHaveProperty('active');
    }
  });

  it('generates nested object example (depth > 1)', () => {
    const input = spec3({
      '/deep': {
        post: {
          operationId: 'deepPost',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    address: {
                      type: 'object',
                      properties: {
                        street: { type: 'string' },
                        city: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    if (req.body?.type === 'json') {
      const parsed = JSON.parse(req.body.content ?? '');
      expect(parsed.address).toHaveProperty('street');
      expect(parsed.address).toHaveProperty('city');
    }
  });

  it('generates array example with one item', () => {
    const input = spec3({
      '/batch': {
        post: {
          operationId: 'batch',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    if (req.body?.type === 'json') {
      const parsed = JSON.parse(req.body.content ?? '');
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. $ref resolution
// ---------------------------------------------------------------------------

describe('$ref resolution', () => {
  it('resolves $ref in request body schema', () => {
    const input = spec3(
      {
        '/things': {
          post: {
            operationId: 'createThing',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Thing' },
                },
              },
            },
          },
        },
      },
      {
        components: {
          schemas: {
            Thing: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                label: { type: 'string' },
              },
            },
          },
        },
      },
    );
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    if (req.body?.type === 'json') {
      const parsed = JSON.parse(req.body.content ?? '');
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('label');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Auth — OpenAPI 3.x
// ---------------------------------------------------------------------------

describe('auth — OpenAPI 3.x', () => {
  it('maps http:bearer to bearer auth', () => {
    const input = spec3(
      {
        '/secure': {
          get: {
            operationId: 'secureGet',
            security: [{ bearerAuth: [] }],
          },
        },
      },
      {
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer' },
          },
        },
      },
    );
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.auth?.type).toBe('bearer');
    if (req.auth?.type === 'bearer') {
      expect(req.auth.token).toBe('{{BEARERAUTH_TOKEN}}');
    }
  });

  it('maps http:basic to basic auth', () => {
    const input = spec3(
      {
        '/basic': {
          get: {
            operationId: 'basicGet',
            security: [{ basicAuth: [] }],
          },
        },
      },
      {
        components: {
          securitySchemes: {
            basicAuth: { type: 'http', scheme: 'basic' },
          },
        },
      },
    );
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.auth?.type).toBe('basic');
  });

  it('maps apiKey to apiKey auth (header)', () => {
    const input = spec3(
      {
        '/api': {
          get: {
            operationId: 'apiGet',
            security: [{ apiKeyAuth: [] }],
          },
        },
      },
      {
        components: {
          securitySchemes: {
            apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
          },
        },
      },
    );
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.auth?.type).toBe('apiKey');
    if (req.auth?.type === 'apiKey') {
      expect(req.auth.key).toBe('X-API-Key');
      expect(req.auth.in).toBe('header');
    }
  });

  it('maps apiKey to apiKey auth (query)', () => {
    const input = spec3(
      {
        '/q': {
          get: {
            operationId: 'qGet',
            security: [{ queryKey: [] }],
          },
        },
      },
      {
        components: {
          securitySchemes: {
            queryKey: { type: 'apiKey', in: 'query', name: 'token' },
          },
        },
      },
    );
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    if (req.auth?.type === 'apiKey') {
      expect(req.auth.in).toBe('query');
    }
  });

  it('maps oauth2 clientCredentials flow to oauth2 auth', () => {
    const input = spec3(
      {
        '/oauth': {
          get: {
            operationId: 'oauthGet',
            security: [{ oAuth: [] }],
          },
        },
      },
      {
        components: {
          securitySchemes: {
            oAuth: {
              type: 'oauth2',
              flows: {
                clientCredentials: {
                  tokenUrl: 'https://auth.example.com/token',
                  scopes: { read: 'Read access' },
                },
              },
            },
          },
        },
      },
    );
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.auth?.type).toBe('oauth2');
    if (req.auth?.type === 'oauth2') {
      expect(req.auth.flow).toBe('clientCredentials');
      expect(req.auth.tokenUrl).toBe('https://auth.example.com/token');
      expect(req.auth.clientId).toBe('{{OAUTH_CLIENT_ID}}');
      expect(req.auth.clientSecret).toBe('{{OAUTH_CLIENT_SECRET}}');
    }
  });

  it('generates secret env vars for each auth scheme', () => {
    const input = spec3({}, {
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
    });
    const result = importOpenApiSpec(input);
    const env = result.environments[0]!;
    const secretKeys = env.variables.filter((v) => v.secret).map((v) => v.key);
    expect(secretKeys).toContain('BEARERAUTH_TOKEN');
    expect(secretKeys).toContain('APIKEY_KEY');
  });
});

// ---------------------------------------------------------------------------
// 8. Swagger 2.0 — coverage
// ---------------------------------------------------------------------------

describe('Swagger 2.0', () => {
  it('creates requests from paths and uses base_url from host+basePath', () => {
    const input = spec2({
      '/pets': {
        get: { operationId: 'listPets', tags: ['Pets'] },
        post: { operationId: 'createPet', tags: ['Pets'] },
      },
      '/status': {
        get: { operationId: 'getStatus' },
      },
    });
    const result = importOpenApiSpec(input);
    const env = result.environments[0]!;
    const baseVar = env.variables.find((v) => v.key === 'base_url');
    expect(baseVar?.value).toBe('https://api.example.com/v1');

    const petsFolder = result.folders.find((f) => f.name === 'Pets');
    expect(petsFolder?.requests).toHaveLength(2);
    expect(result.requests).toHaveLength(1);
  });

  it('substitutes path params in URL', () => {
    const input = spec2({
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          parameters: [{ name: 'petId', in: 'path', type: 'integer' }],
        },
      },
    });
    const result = importOpenApiSpec(input);
    expect(result.requests[0]?.url).toBe('{{base_url}}/pets/{{petId}}');
  });

  it('maps Swagger 2.0 oauth2 application flow to clientCredentials', () => {
    const input = spec2(
      {
        '/secure': {
          get: {
            operationId: 'secure',
            security: [{ oauth: [] }],
          },
        },
      },
      {
        securityDefinitions: {
          oauth: {
            type: 'oauth2',
            flow: 'application',
            tokenUrl: 'https://auth.example.com/token',
            scopes: {},
          },
        },
      },
    );
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.auth?.type).toBe('oauth2');
    if (req.auth?.type === 'oauth2') {
      expect(req.auth.flow).toBe('clientCredentials');
    }
  });

  it('maps formData params to formUrlEncoded body', () => {
    const input = spec2({
      '/upload': {
        post: {
          operationId: 'upload',
          consumes: ['application/x-www-form-urlencoded'],
          parameters: [
            { name: 'file_name', in: 'formData', type: 'string', example: 'test.txt' },
            { name: 'size', in: 'formData', type: 'integer' },
          ],
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.body?.type).toBe('formUrlEncoded');
  });

  it('maps body parameter with schema to json body', () => {
    const input = spec2({
      '/things': {
        post: {
          operationId: 'createThing',
          consumes: ['application/json'],
          parameters: [
            {
              name: 'body',
              in: 'body',
              schema: {
                type: 'object',
                properties: { label: { type: 'string' } },
              },
            },
          ],
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.body?.type).toBe('json');
    if (req.body?.type === 'json') {
      const parsed = JSON.parse(req.body.content ?? '{}');
      expect(parsed).toHaveProperty('label');
    }
  });
});

// ---------------------------------------------------------------------------
// 9. YAML input
// ---------------------------------------------------------------------------

describe('YAML input', () => {
  it('parses a YAML spec correctly', () => {
    const yaml = `
openapi: 3.0.3
info:
  title: YAML Test
  version: 1.0.0
servers:
  - url: https://yaml.example.com
paths:
  /ping:
    get:
      operationId: ping
      summary: Ping
`;
    const result = importOpenApiSpec(yaml);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.url).toBe('{{base_url}}/ping');
    const env = result.environments[0]!;
    expect(env.variables.find((v) => v.key === 'base_url')?.value).toBe(
      'https://yaml.example.com',
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Content type preference
// ---------------------------------------------------------------------------

describe('content type preference', () => {
  it('prefers application/json over text/plain', () => {
    const example = { id: 1 };
    const input = spec3({
      '/data': {
        post: {
          operationId: 'postData',
          requestBody: {
            content: {
              'text/plain': { example: 'some text' },
              'application/json': { example },
            },
          },
        },
      },
    });
    const result = importOpenApiSpec(input);
    const req = result.requests[0]!;
    expect(req.body?.type).toBe('json');
  });
});
