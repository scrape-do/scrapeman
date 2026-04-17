import { describe, expect, it } from 'vitest';
import { importBrunoFolder } from '../src/import/bruno.js';

const SAMPLE_BRU = `
meta {
  name: Get Users
  type: http
  seq: 1
}

get {
  url: https://api.example.com/users
  body: none
  auth: bearer
}

headers {
  Content-Type: application/json
  X-Api-Key: {{apiKey}}
}

auth:bearer {
  token: {{token}}
}
`;

const POST_WITH_JSON_BODY = `
meta {
  name: Create User
}

post {
  url: https://api.example.com/users
  body: json
  auth: none
}

headers {
  Content-Type: application/json
}

body:json {
  {
    "name": "test",
    "email": "test@example.com"
  }
}
`;

const BASIC_AUTH_BRU = `
meta {
  name: Admin Endpoint
}

get {
  url: https://api.example.com/admin
}

auth:basic {
  username: admin
  password: secret123
}
`;

const FORM_URLENCODED_BRU = `
meta {
  name: Login
}

post {
  url: https://api.example.com/login
}

body:form-urlencoded {
  username: admin
  password: secret
}
`;

const UNSUPPORTED_BLOCKS_BRU = `
meta {
  name: With Scripts
}

get {
  url: https://api.example.com/test
}

script:pre-request {
  const token = bru.getEnvVar("token");
}

tests {
  test("status is 200", function() {
    expect(res.status).to.equal(200);
  });
}
`;

const QUERY_PARAMS_BRU = `
meta {
  name: Search
}

get {
  url: https://api.example.com/search
}

params:query {
  q: hello
  page: 1
}
`;

describe('importBrunoFolder', () => {
  it('parses method and URL from HTTP method block', () => {
    const result = importBrunoFolder([
      { path: 'get-users.bru', content: SAMPLE_BRU },
    ]);
    expect(result.requests).toHaveLength(1);
    const req = result.requests[0]!;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com/users');
  });

  it('parses meta.name as request name', () => {
    const result = importBrunoFolder([
      { path: 'get-users.bru', content: SAMPLE_BRU },
    ]);
    expect(result.requests[0]!.meta.name).toBe('Get Users');
  });

  it('parses headers', () => {
    const result = importBrunoFolder([
      { path: 'get-users.bru', content: SAMPLE_BRU },
    ]);
    expect(result.requests[0]!.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Api-Key': '{{apiKey}}',
    });
  });

  it('parses bearer auth', () => {
    const result = importBrunoFolder([
      { path: 'get-users.bru', content: SAMPLE_BRU },
    ]);
    expect(result.requests[0]!.auth).toEqual({
      type: 'bearer',
      token: '{{token}}',
    });
  });

  it('parses basic auth', () => {
    const result = importBrunoFolder([
      { path: 'admin.bru', content: BASIC_AUTH_BRU },
    ]);
    expect(result.requests[0]!.auth).toEqual({
      type: 'basic',
      username: 'admin',
      password: 'secret123',
    });
  });

  it('parses JSON body', () => {
    const result = importBrunoFolder([
      { path: 'create-user.bru', content: POST_WITH_JSON_BODY },
    ]);
    const req = result.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({
      type: 'json',
      content: '{\n    "name": "test",\n    "email": "test@example.com"\n  }',

    });
  });

  it('parses form-urlencoded body', () => {
    const result = importBrunoFolder([
      { path: 'login.bru', content: FORM_URLENCODED_BRU },
    ]);
    expect(result.requests[0]!.body).toEqual({
      type: 'formUrlEncoded',
      fields: { username: 'admin', password: 'secret' },
    });
  });

  it('parses query params', () => {
    const result = importBrunoFolder([
      { path: 'search.bru', content: QUERY_PARAMS_BRU },
    ]);
    expect(result.requests[0]!.params).toEqual({ q: 'hello', page: '1' });
  });

  it('builds folder hierarchy from file paths', () => {
    const result = importBrunoFolder([
      { path: 'users/get-all.bru', content: SAMPLE_BRU },
      { path: 'users/create.bru', content: POST_WITH_JSON_BODY },
      { path: 'health.bru', content: SAMPLE_BRU },
    ]);

    // Root level: 1 request (health.bru) + 1 folder (users)
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]!.meta.name).toBe('Get Users');
    expect(result.folders).toHaveLength(1);

    const usersFolder = result.folders[0]!;
    expect(usersFolder.name).toBe('users');
    expect(usersFolder.requests).toHaveLength(2);
    expect(usersFolder.requests[0]!.meta.name).toBe('Create User');
    expect(usersFolder.requests[1]!.meta.name).toBe('Get Users');
  });

  it('builds nested folder hierarchy', () => {
    const result = importBrunoFolder([
      { path: 'api/v1/users/list.bru', content: SAMPLE_BRU },
      { path: 'api/v1/health.bru', content: SAMPLE_BRU },
    ]);

    expect(result.folders).toHaveLength(1);
    const apiFolder = result.folders[0]!;
    expect(apiFolder.name).toBe('api');

    const v1Folder = apiFolder.folders[0]!;
    expect(v1Folder.name).toBe('v1');
    expect(v1Folder.requests).toHaveLength(1); // health.bru

    const usersFolder = v1Folder.folders[0]!;
    expect(usersFolder.name).toBe('users');
    expect(usersFolder.requests).toHaveLength(1); // list.bru
  });

  it('emits warnings for unsupported blocks', () => {
    const result = importBrunoFolder([
      { path: 'test.bru', content: UNSUPPORTED_BLOCKS_BRU },
    ]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('script:pre-request'))).toBe(
      true,
    );
    expect(result.warnings.some((w) => w.includes('tests'))).toBe(true);
  });

  it('skips non-.bru files', () => {
    const result = importBrunoFolder([
      { path: 'readme.md', content: '# hello' },
      { path: 'get.bru', content: SAMPLE_BRU },
    ]);
    expect(result.requests).toHaveLength(1);
  });

  it('handles empty input', () => {
    const result = importBrunoFolder([]);
    expect(result.requests).toHaveLength(0);
    expect(result.folders).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('uses filename as fallback name when meta.name is missing', () => {
    const content = `
get {
  url: https://example.com
}
`;
    const result = importBrunoFolder([
      { path: 'my-request.bru', content },
    ]);
    expect(result.requests[0]!.meta.name).toBe('my-request');
  });

  it('normalizes backslash paths', () => {
    const result = importBrunoFolder([
      { path: 'users\\create.bru', content: POST_WITH_JSON_BODY },
    ]);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]!.name).toBe('users');
  });
});
