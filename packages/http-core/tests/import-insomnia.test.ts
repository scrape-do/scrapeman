import { describe, expect, it } from 'vitest';
import { importInsomniaExport, InsomniaImportError } from '../src/import/insomnia.js';

const FULL_EXPORT = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    {
      _id: 'wrk_root',
      _type: 'workspace',
      parentId: null,
      name: 'My Workspace',
    },
    {
      _id: 'fld_users',
      _type: 'request_group',
      parentId: 'wrk_root',
      name: 'Users',
    },
    {
      _id: 'fld_nested',
      _type: 'request_group',
      parentId: 'fld_users',
      name: 'Admin',
    },
    {
      _id: 'req_get',
      _type: 'request',
      parentId: 'fld_users',
      name: 'Get Users',
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'X-Debug', value: 'true', disabled: true },
      ],
      body: {},
      authentication: { type: 'bearer', token: '{{token}}' },
    },
    {
      _id: 'req_post',
      _type: 'request',
      parentId: 'fld_nested',
      name: 'Create Admin',
      method: 'POST',
      url: 'https://api.example.com/admins',
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      body: { mimeType: 'application/json', text: '{"role":"admin"}' },
      authentication: {
        type: 'basic',
        username: 'admin',
        password: 's3cret',
      },
    },
    {
      _id: 'env_base',
      _type: 'environment',
      parentId: 'wrk_root',
      name: 'Production',
      data: { baseUrl: 'https://api.example.com', token: 'abc123' },
    },
    {
      _id: 'jar_1',
      _type: 'cookie_jar',
      parentId: 'wrk_root',
      name: 'Default Jar',
    },
  ],
});

describe('importInsomniaExport', () => {
  it('rejects invalid JSON', () => {
    expect(() => importInsomniaExport('{')).toThrow(InsomniaImportError);
  });

  it('rejects non-v4 exports', () => {
    expect(() =>
      importInsomniaExport(
        JSON.stringify({ _type: 'export', __export_format: 3, resources: [] }),
      ),
    ).toThrow(/unsupported format/);
  });

  it('maps request method, url, headers (skips disabled)', () => {
    const result = importInsomniaExport(FULL_EXPORT);
    // Get Users is in the Users folder
    const folder = result.folders.find((f) => f.name === 'Users');
    expect(folder).toBeDefined();
    const req = folder!.requests.find((r) => r.meta.name === 'Get Users');
    expect(req).toBeDefined();
    expect(req!.method).toBe('GET');
    expect(req!.url).toBe('https://api.example.com/users');
    // Accept is present, X-Debug (disabled) is not
    expect(req!.headers).toEqual({ Accept: 'application/json' });
  });

  it('maps bearer auth', () => {
    const result = importInsomniaExport(FULL_EXPORT);
    const folder = result.folders.find((f) => f.name === 'Users');
    const req = folder!.requests.find((r) => r.meta.name === 'Get Users');
    expect(req!.auth).toEqual({ type: 'bearer', token: '{{token}}' });
  });

  it('maps basic auth', () => {
    const result = importInsomniaExport(FULL_EXPORT);
    const users = result.folders.find((f) => f.name === 'Users')!;
    const admin = users.folders.find((f) => f.name === 'Admin')!;
    const req = admin.requests.find((r) => r.meta.name === 'Create Admin')!;
    expect(req.auth).toEqual({
      type: 'basic',
      username: 'admin',
      password: 's3cret',
    });
  });

  it('maps JSON body', () => {
    const result = importInsomniaExport(FULL_EXPORT);
    const users = result.folders.find((f) => f.name === 'Users')!;
    const admin = users.folders.find((f) => f.name === 'Admin')!;
    const req = admin.requests.find((r) => r.meta.name === 'Create Admin')!;
    expect(req.body).toEqual({ type: 'json', content: '{"role":"admin"}' });
  });

  it('builds folder hierarchy from parentId chains', () => {
    const result = importInsomniaExport(FULL_EXPORT);
    // Root has one folder (Users), which contains a nested folder (Admin)
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]!.name).toBe('Users');
    expect(result.folders[0]!.folders).toHaveLength(1);
    expect(result.folders[0]!.folders[0]!.name).toBe('Admin');
    // Admin folder has one request
    expect(result.folders[0]!.folders[0]!.requests).toHaveLength(1);
  });

  it('extracts environment variables', () => {
    const result = importInsomniaExport(FULL_EXPORT);
    expect(result.environments).toHaveLength(1);
    const env = result.environments[0]!;
    expect(env.name).toBe('Production');
    expect(env.variables).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', enabled: true, secret: false },
      { key: 'token', value: 'abc123', enabled: true, secret: false },
    ]);
  });

  it('warns on cookie_jar and skips workspace', () => {
    const result = importInsomniaExport(FULL_EXPORT);
    expect(result.warnings).toContain('Cookie jars are not imported');
    // No warnings about workspace
    expect(result.warnings.filter((w) => /workspace/i.test(w))).toHaveLength(0);
  });

  it('warns on unknown resource types', () => {
    const json = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'proto_1', _type: 'proto_file', parentId: null, name: 'grpc' },
      ],
    });
    const result = importInsomniaExport(json);
    expect(result.warnings).toContain('Unsupported resource type: proto_file');
  });

  it('maps oauth2 auth', () => {
    const json = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'req_1',
          _type: 'request',
          parentId: null,
          name: 'OAuth',
          method: 'GET',
          url: 'https://example.com',
          authentication: {
            type: 'oauth2',
            accessTokenUrl: 'https://auth.example.com/token',
            authorizationUrl: 'https://auth.example.com/authorize',
            clientId: 'my-client',
            clientSecret: 'my-secret',
            scope: 'read write',
          },
        },
      ],
    });
    const result = importInsomniaExport(json);
    expect(result.requests[0]!.auth).toEqual({
      type: 'oauth2',
      flow: 'authorizationCode',
      tokenUrl: 'https://auth.example.com/token',
      authUrl: 'https://auth.example.com/authorize',
      clientId: 'my-client',
      clientSecret: 'my-secret',
      scope: 'read write',
    });
  });

  it('maps apikey auth', () => {
    const json = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'req_1',
          _type: 'request',
          parentId: null,
          name: 'API Key',
          method: 'GET',
          url: 'https://example.com',
          authentication: {
            type: 'apikey',
            key: 'X-Api-Key',
            value: 'secret-key',
            addTo: 'header',
          },
        },
      ],
    });
    const result = importInsomniaExport(json);
    expect(result.requests[0]!.auth).toEqual({
      type: 'apiKey',
      key: 'X-Api-Key',
      value: 'secret-key',
      in: 'header',
    });
  });

  it('maps AWS IAM auth to awsSigV4', () => {
    const json = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'req_1',
          _type: 'request',
          parentId: null,
          name: 'AWS',
          method: 'GET',
          url: 'https://s3.amazonaws.com',
          authentication: {
            type: 'iam',
            accessKeyId: 'AKIA...',
            secretAccessKey: 'secret',
            region: 'us-east-1',
            service: 's3',
          },
        },
      ],
    });
    const result = importInsomniaExport(json);
    expect(result.requests[0]!.auth).toEqual({
      type: 'awsSigV4',
      accessKeyId: 'AKIA...',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      service: 's3',
    });
  });

  it('maps form-urlencoded body', () => {
    const json = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'req_1',
          _type: 'request',
          parentId: null,
          name: 'Form',
          method: 'POST',
          url: 'https://example.com/login',
          body: {
            mimeType: 'application/x-www-form-urlencoded',
            params: [
              { name: 'username', value: 'admin' },
              { name: 'password', value: 'pass' },
            ],
          },
        },
      ],
    });
    const result = importInsomniaExport(json);
    expect(result.requests[0]!.body).toEqual({
      type: 'formUrlEncoded',
      fields: { username: 'admin', password: 'pass' },
    });
  });

  it('places requests without a valid parent folder at root', () => {
    const json = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'req_orphan',
          _type: 'request',
          parentId: 'wrk_gone',
          name: 'Orphan',
          method: 'GET',
          url: 'https://example.com',
        },
      ],
    });
    const result = importInsomniaExport(json);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.meta.name).toBe('Orphan');
  });
});
