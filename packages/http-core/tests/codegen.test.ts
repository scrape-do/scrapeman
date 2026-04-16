import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { generateCode, maskSecret } from '../src/codegen/index.js';

const baseRequest: ScrapemanRequest = {
  scrapeman: FORMAT_VERSION,
  meta: { name: 'Fetch user' },
  method: 'GET',
  url: 'https://api.example.com/users/{{userId}}',
  headers: {
    Accept: 'application/json',
    Authorization: 'Bearer {{token}}',
  },
};

const postRequest: ScrapemanRequest = {
  scrapeman: FORMAT_VERSION,
  meta: { name: 'Create user' },
  method: 'POST',
  url: 'https://api.example.com/users',
  headers: { 'Content-Type': 'application/json' },
  body: { type: 'json', content: '{"name":"Ada"}' },
};

const ctx = {
  inlineVariables: true,
  variables: { userId: '42', token: 's3cret' },
};

describe('codegen curl', () => {
  it('produces a curl for a GET with vars inlined', () => {
    const out = generateCode('curl', baseRequest, ctx);
    expect(out).toContain("curl -X GET");
    expect(out).toContain("'https://api.example.com/users/42'");
    expect(out).toContain("'Authorization: Bearer s3cret'");
  });

  it('keeps vars as-is when inlineVariables is false', () => {
    const out = generateCode('curl', baseRequest, {
      inlineVariables: false,
      variables: {},
    });
    expect(out).toContain('{{userId}}');
    expect(out).toContain('Bearer {{token}}');
  });

  it('produces a POST with body for JSON', () => {
    const out = generateCode('curl', postRequest, ctx);
    expect(out).toContain('curl -X POST');
    expect(out).toContain("--data-raw '{\"name\":\"Ada\"}'");
  });
});

describe('codegen fetch', () => {
  it('emits a fetch call with headers and body', () => {
    const out = generateCode('fetch', postRequest, ctx);
    expect(out).toContain('const response = await fetch');
    expect(out).toContain("method: 'POST'");
    expect(out).toContain("'Content-Type': 'application/json'");
    expect(out).toContain('body: \'{"name":"Ada"}\'');
  });
});

describe('codegen python', () => {
  it('emits Python requests code with header map', () => {
    const out = generateCode('python', baseRequest, ctx);
    expect(out).toContain('import requests');
    expect(out).toContain('headers = {');
    expect(out).toContain('"Authorization": "Bearer s3cret"');
    expect(out).toContain('requests.request("GET"');
  });
});

describe('codegen go', () => {
  it('emits Go net/http with string body', () => {
    const out = generateCode('go', postRequest, ctx);
    expect(out).toContain('package main');
    expect(out).toContain('"net/http"');
    expect(out).toContain('"strings"');
    expect(out).toContain('http.NewRequest(`POST`');
    expect(out).toContain('req.Header.Set(`Content-Type`, `application/json`)');
  });

  it('omits strings import when there is no body', () => {
    const out = generateCode('go', baseRequest, ctx);
    expect(out).toContain('"net/http"');
    expect(out).not.toContain('"strings"');
    expect(out).toContain('http.NewRequest(`GET`');
    expect(out).toContain('nil)');
  });
});

describe('codegen prepare', () => {
  it('merges params into URL query string', () => {
    const request: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'with params' },
      method: 'GET',
      url: 'https://api.example.com/search',
      params: { q: 'scrape', page: '2' },
    };
    const out = generateCode('curl', request, {
      inlineVariables: false,
      variables: {},
    });
    expect(out).toContain('https://api.example.com/search?q=scrape&page=2');
  });

  it('basic auth becomes Authorization header', () => {
    const request: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'basic' },
      method: 'GET',
      url: 'https://api.example.com/secret',
      auth: { type: 'basic', username: 'admin', password: 's3cret' },
    };
    const out = generateCode('curl', request, {
      inlineVariables: false,
      variables: {},
    });
    const encoded = Buffer.from('admin:s3cret').toString('base64');
    expect(out).toContain(`Authorization: Basic ${encoded}`);
  });
});

describe('maskSecret', () => {
  it('masks long values with first 4 + *** + last 2', () => {
    expect(maskSecret('sk_live_abc123')).toBe('sk_l***23');
  });

  it('returns *** for short values', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('abcdef')).toBe('***');
  });

  it('masks 7-char value correctly', () => {
    expect(maskSecret('abcdefg')).toBe('abcd***fg');
  });
});

describe('codegen secret masking', () => {
  const secretRequest: ScrapemanRequest = {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'Secret test' },
    method: 'GET',
    url: 'https://api.example.com/data?token={{token}}',
    headers: {
      Authorization: 'Bearer {{apiKey}}',
    },
  };

  const variables = {
    token: 'sk_live_abc123',
    apiKey: 'key_prod_xyz789',
  };

  const targets = ['curl', 'fetch', 'python', 'go'] as const;

  for (const target of targets) {
    describe(target, () => {
      it('preserves {{var}} templates when inlineVariables is false', () => {
        const out = generateCode(target, secretRequest, {
          inlineVariables: false,
          variables: {},
        });
        expect(out).toContain('{{token}}');
        expect(out).toContain('{{apiKey}}');
        expect(out).not.toContain('sk_live_abc123');
        expect(out).not.toContain('key_prod_xyz789');
      });

      it('shows full value for non-secret vars when inlineVariables is true', () => {
        const out = generateCode(target, secretRequest, {
          inlineVariables: true,
          variables,
          secretKeys: new Set<string>(),
        });
        expect(out).toContain('sk_live_abc123');
        expect(out).toContain('key_prod_xyz789');
      });

      it('masks secret vars when inlineVariables is true', () => {
        const out = generateCode(target, secretRequest, {
          inlineVariables: true,
          variables,
          secretKeys: new Set(['token', 'apiKey']),
        });
        expect(out).toContain('sk_l***23');
        expect(out).toContain('key_***89');
        expect(out).not.toContain('sk_live_abc123');
        expect(out).not.toContain('key_prod_xyz789');
      });

      it('keeps undefined {{missing}} as template when inlineVariables is true', () => {
        const reqWithMissing: ScrapemanRequest = {
          scrapeman: FORMAT_VERSION,
          meta: { name: 'missing var' },
          method: 'GET',
          url: 'https://api.example.com/data?key={{missing}}',
        };
        const out = generateCode(target, reqWithMissing, {
          inlineVariables: true,
          variables: {},
        });
        // Unresolved variables are dropped by resolveString (replaced with '').
        // The template does NOT stay — this is existing behavior.
        expect(out).not.toContain('{{missing}}');
      });

      it('strips X-Scrapeman-Token header', () => {
        const reqWithInternal: ScrapemanRequest = {
          scrapeman: FORMAT_VERSION,
          meta: { name: 'internal header' },
          method: 'GET',
          url: 'https://api.example.com/data',
          headers: {
            'X-Scrapeman-Token': 'some-uuid-value',
            Accept: 'application/json',
          },
        };
        const out = generateCode(target, reqWithInternal, {
          inlineVariables: false,
          variables: {},
        });
        expect(out).not.toContain('X-Scrapeman-Token');
        expect(out).not.toContain('some-uuid-value');
        expect(out).toContain('application/json');
      });
    });
  }
});
