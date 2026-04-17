import { describe, expect, it } from 'vitest';
import { importPostmanCollection } from '../src/import/postman.js';

// Minimal Postman v2.1 collection with folders, auth, variables, and mixed body types.
const SAMPLE_COLLECTION = JSON.stringify({
  info: {
    name: 'Test API',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'Get Users',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.example.com/users?page=1',
              protocol: 'https',
              host: ['api', 'example', 'com'],
              path: ['users'],
              query: [
                { key: 'page', value: '1' },
                { key: 'disabled_param', value: 'x', disabled: true },
              ],
            },
            header: [
              { key: 'Accept', value: 'application/json' },
              { key: 'X-Disabled', value: 'skip', disabled: true },
            ],
          },
        },
        {
          name: 'Create User',
          request: {
            method: 'POST',
            url: 'https://api.example.com/users',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: {
              mode: 'raw',
              raw: '{"name":"Ada"}',
              options: { raw: { language: 'json' } },
            },
            auth: {
              type: 'bearer',
              bearer: [{ key: 'token', value: 'my-secret-token' }],
            },
          },
        },
      ],
    },
    {
      name: 'Health Check',
      request: {
        method: 'GET',
        url: 'https://api.example.com/health',
        description: 'Simple health check endpoint',
      },
    },
  ],
  variable: [
    { key: 'baseUrl', value: 'https://api.example.com' },
    { key: 'apiKey', value: '12345', disabled: true },
  ],
});

describe('importPostmanCollection', () => {
  it('parses collection info and produces correct structure', () => {
    const result = importPostmanCollection(SAMPLE_COLLECTION);
    // 1 top-level request + 1 folder
    expect(result.folders).toHaveLength(1);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.meta.name).toBe('Health Check');
    expect(result.requests[0]!.meta.description).toBe('Simple health check endpoint');
  });

  it('preserves folder hierarchy', () => {
    const result = importPostmanCollection(SAMPLE_COLLECTION);
    const folder = result.folders[0]!;
    expect(folder.name).toBe('Users');
    expect(folder.requests).toHaveLength(2);
    expect(folder.folders).toHaveLength(0);
    expect(folder.requests[0]!.meta.name).toBe('Get Users');
    expect(folder.requests[1]!.meta.name).toBe('Create User');
  });

  it('maps structured URL with query params', () => {
    const result = importPostmanCollection(SAMPLE_COLLECTION);
    const getUsers = result.folders[0]!.requests[0]!;
    expect(getUsers.url).toBe('https://api.example.com/users?page=1');
    expect(getUsers.params).toEqual({ page: '1' });
    // Disabled param excluded
    expect(getUsers.params).not.toHaveProperty('disabled_param');
  });

  it('maps headers and skips disabled ones', () => {
    const result = importPostmanCollection(SAMPLE_COLLECTION);
    const getUsers = result.folders[0]!.requests[0]!;
    expect(getUsers.headers).toEqual({ Accept: 'application/json' });
  });

  it('maps bearer auth', () => {
    const result = importPostmanCollection(SAMPLE_COLLECTION);
    const createUser = result.folders[0]!.requests[1]!;
    expect(createUser.auth).toEqual({ type: 'bearer', token: 'my-secret-token' });
  });

  it('maps raw JSON body', () => {
    const result = importPostmanCollection(SAMPLE_COLLECTION);
    const createUser = result.folders[0]!.requests[1]!;
    expect(createUser.body).toEqual({ type: 'json', content: '{"name":"Ada"}' });
  });

  it('converts collection variables to environment', () => {
    const result = importPostmanCollection(SAMPLE_COLLECTION);
    expect(result.environments).toHaveLength(1);
    const env = result.environments[0]!;
    expect(env.name).toBe('Test API');
    expect(env.variables).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', enabled: true, secret: false },
      { key: 'apiKey', value: '12345', enabled: false, secret: false },
    ]);
  });

  it('returns warning for invalid JSON', () => {
    const result = importPostmanCollection('not json');
    expect(result.warnings).toContain('Failed to parse JSON input');
    expect(result.requests).toHaveLength(0);
  });

  it('returns warning for unrecognised schema', () => {
    const result = importPostmanCollection(
      JSON.stringify({ info: { schema: 'https://example.com/unknown' }, item: [] }),
    );
    expect(result.warnings[0]).toMatch(/Unrecognised Postman schema/);
  });

  it('warns on collection-level scripts', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [],
        event: [{ listen: 'prerequest', script: { exec: ['console.log("hi")'] } }],
      }),
    );
    expect(result.warnings).toContain('Collection-level scripts (pre-request / test) were skipped.');
  });

  it('warns on unsupported auth type', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Weird Auth',
            request: {
              method: 'GET',
              url: 'https://example.com',
              auth: { type: 'digest' },
            },
          },
        ],
      }),
    );
    expect(result.warnings[0]).toMatch(/unsupported auth type "digest"/);
  });

  it('maps basic auth', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Basic',
            request: {
              method: 'GET',
              url: 'https://example.com',
              auth: {
                type: 'basic',
                basic: [
                  { key: 'username', value: 'alice' },
                  { key: 'password', value: 's3cret' },
                ],
              },
            },
          },
        ],
      }),
    );
    expect(result.requests[0]!.auth).toEqual({
      type: 'basic',
      username: 'alice',
      password: 's3cret',
    });
  });

  it('maps apikey auth', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'ApiKey',
            request: {
              method: 'GET',
              url: 'https://example.com',
              auth: {
                type: 'apikey',
                apikey: [
                  { key: 'key', value: 'X-Api-Key' },
                  { key: 'value', value: 'abc123' },
                  { key: 'in', value: 'query' },
                ],
              },
            },
          },
        ],
      }),
    );
    expect(result.requests[0]!.auth).toEqual({
      type: 'apiKey',
      key: 'X-Api-Key',
      value: 'abc123',
      in: 'query',
    });
  });

  it('maps urlencoded body', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Form',
            request: {
              method: 'POST',
              url: 'https://example.com',
              body: {
                mode: 'urlencoded',
                urlencoded: [
                  { key: 'grant_type', value: 'password' },
                  { key: 'disabled', value: 'x', disabled: true },
                ],
              },
            },
          },
        ],
      }),
    );
    expect(result.requests[0]!.body).toEqual({
      type: 'formUrlEncoded',
      fields: { grant_type: 'password' },
    });
  });

  it('maps formdata (multipart) body', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Upload',
            request: {
              method: 'POST',
              url: 'https://example.com/upload',
              body: {
                mode: 'formdata',
                formdata: [
                  { key: 'name', value: 'test', type: 'text' },
                  { key: 'file', type: 'file', src: '/tmp/data.csv' },
                ],
              },
            },
          },
        ],
      }),
    );
    expect(result.requests[0]!.body).toEqual({
      type: 'multipart',
      parts: [
        { name: 'name', type: 'text', value: 'test' },
        { name: 'file', type: 'file', file: '/tmp/data.csv' },
      ],
    });
  });

  it('maps graphql body to JSON', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'GQL',
            request: {
              method: 'POST',
              url: 'https://example.com/graphql',
              body: {
                mode: 'graphql',
                graphql: { query: '{ users { id } }', variables: '{"limit":10}' },
              },
            },
          },
        ],
      }),
    );
    const body = result.requests[0]!.body;
    expect(body).toHaveProperty('type', 'json');
    if (body && body.type === 'json') {
      const parsed = JSON.parse(body.content!);
      expect(parsed.query).toBe('{ users { id } }');
      expect(parsed.variables).toBe('{"limit":10}');
    }
  });

  it('maps AWS SigV4 auth', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'AWS',
            request: {
              method: 'GET',
              url: 'https://s3.amazonaws.com/bucket',
              auth: {
                type: 'awsv4',
                awsv4: [
                  { key: 'accessKey', value: 'AKID' },
                  { key: 'secretKey', value: 'SECRET' },
                  { key: 'region', value: 'us-east-1' },
                  { key: 'service', value: 's3' },
                ],
              },
            },
          },
        ],
      }),
    );
    expect(result.requests[0]!.auth).toEqual({
      type: 'awsSigV4',
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
      region: 'us-east-1',
      service: 's3',
    });
  });

  it('builds URL from structured parts when raw is missing', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Structured',
            request: {
              method: 'GET',
              url: {
                protocol: 'http',
                host: ['localhost'],
                port: '8080',
                path: ['api', 'v1', 'items'],
              },
            },
          },
        ],
      }),
    );
    expect(result.requests[0]!.url).toBe('http://localhost:8080/api/v1/items');
  });

  it('detects JSON body from content when language is not set', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'AutoJson',
            request: {
              method: 'POST',
              url: 'https://example.com',
              body: { mode: 'raw', raw: '{"auto":"detect"}' },
            },
          },
        ],
      }),
    );
    expect(result.requests[0]!.body).toEqual({ type: 'json', content: '{"auto":"detect"}' });
  });

  it('nested folders are preserved', () => {
    const result = importPostmanCollection(
      JSON.stringify({
        info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Level 1',
            item: [
              {
                name: 'Level 2',
                item: [
                  {
                    name: 'Deep Request',
                    request: { method: 'GET', url: 'https://example.com/deep' },
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(result.folders).toHaveLength(1);
    const l1 = result.folders[0]!;
    expect(l1.name).toBe('Level 1');
    expect(l1.folders).toHaveLength(1);
    const l2 = l1.folders[0]!;
    expect(l2.name).toBe('Level 2');
    expect(l2.requests).toHaveLength(1);
    expect(l2.requests[0]!.url).toBe('https://example.com/deep');
  });
});
