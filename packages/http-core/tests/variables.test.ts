import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import {
  resolveString,
  findUnresolved,
  resolveRequest,
  isBuiltinVariable,
} from '../src/variables/resolve.js';

const ctx = {
  variables: {
    baseUrl: 'https://api.example.com',
    token: 'secret-token',
    apiKey: 'k_abc',
    userId: '42',
  },
};

describe('resolveString', () => {
  it('substitutes a single variable', () => {
    expect(resolveString('Bearer {{token}}', ctx)).toBe('Bearer secret-token');
  });

  it('substitutes multiple variables', () => {
    expect(resolveString('{{baseUrl}}/users/{{userId}}', ctx)).toBe(
      'https://api.example.com/users/42',
    );
  });

  it('tolerates whitespace inside braces', () => {
    expect(resolveString('Bearer {{ token }}', ctx)).toBe('Bearer secret-token');
  });

  it('replaces unknown variables with an empty string', () => {
    expect(resolveString('{{unknown}}/path', ctx)).toBe('/path');
  });

  it('passes through strings with no variables', () => {
    expect(resolveString('plain string', ctx)).toBe('plain string');
  });
});

describe('findUnresolved', () => {
  it('returns names not in context', () => {
    const result = findUnresolved('{{baseUrl}}/{{nope}}/{{token}}', ctx);
    expect(result).toEqual(['nope']);
  });

  it('returns empty when everything resolves', () => {
    expect(findUnresolved('{{baseUrl}}/{{userId}}', ctx)).toEqual([]);
  });

  it('treats built-in dynamic variables as resolved', () => {
    expect(findUnresolved('{{random}}/{{timestamp}}/{{nope}}', ctx)).toEqual([
      'nope',
    ]);
  });
});

describe('built-in dynamic variables', () => {
  const empty = { variables: {} };

  it('substitutes {{random}} with a UUID', () => {
    const out = resolveString('id={{random}}', empty);
    expect(out).toMatch(/^id=[0-9a-f-]{36}$/);
  });

  it('produces distinct UUIDs for multiple {{random}} occurrences', () => {
    const out = resolveString('{{random}}/{{random}}', empty);
    const [a, b] = out.split('/');
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it('substitutes {{timestamp}} with epoch milliseconds', () => {
    const before = Date.now();
    const out = resolveString('{{timestamp}}', empty);
    const after = Date.now();
    const value = parseInt(out, 10);
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  it('substitutes {{isoDate}} with an ISO 8601 string', () => {
    const out = resolveString('{{isoDate}}', empty);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('substitutes {{randomInt}} with a numeric string', () => {
    const out = resolveString('{{randomInt}}', empty);
    expect(out).toMatch(/^\d+$/);
  });

  it('user-defined variables shadow built-ins', () => {
    const out = resolveString('{{random}}', { variables: { random: 'fixed' } });
    expect(out).toBe('fixed');
  });

  it('isBuiltinVariable reports known dynamic vars', () => {
    expect(isBuiltinVariable('random')).toBe(true);
    expect(isBuiltinVariable('timestamp')).toBe(true);
    expect(isBuiltinVariable('nope')).toBe(false);
  });
});

describe('resolveRequest', () => {
  it('substitutes URL, headers, and bearer token', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'fetch user' },
      method: 'GET',
      url: '{{baseUrl}}/users/{{userId}}',
      headers: {
        Authorization: 'Bearer {{token}}',
        'X-Api-Key': '{{apiKey}}',
      },
      auth: { type: 'bearer', token: '{{token}}' },
    };
    const { request, unresolved } = resolveRequest(req, ctx);
    expect(request.url).toBe('https://api.example.com/users/42');
    expect(request.headers).toEqual({
      Authorization: 'Bearer secret-token',
      'X-Api-Key': 'k_abc',
    });
    expect(request.auth).toEqual({ type: 'bearer', token: 'secret-token' });
    expect(unresolved).toEqual([]);
  });

  it('substitutes JSON body content', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'create' },
      method: 'POST',
      url: '{{baseUrl}}/items',
      body: { type: 'json', content: '{"id":"{{userId}}","key":"{{apiKey}}"}' },
    };
    const { request } = resolveRequest(req, ctx);
    expect(request.body).toEqual({
      type: 'json',
      content: '{"id":"42","key":"k_abc"}',
    });
  });

  it('drops undefined variables from URL and headers at send-time', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'broken' },
      method: 'GET',
      url: '{{baseUrl}}/{{missing}}/end',
      headers: { 'X-Key': '{{alsoMissing}}', 'X-Ok': '{{apiKey}}' },
    };
    const { request, unresolved } = resolveRequest(req, ctx);
    expect(request.url).toBe('https://api.example.com//end');
    expect(request.headers).toEqual({ 'X-Key': '', 'X-Ok': 'k_abc' });
    expect(unresolved.sort()).toEqual(['alsoMissing', 'missing']);
  });

  it('reports unresolved variables aggregated from everywhere', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'broken' },
      method: 'GET',
      url: '{{baseUrl}}/{{missing}}',
      headers: { 'X-Other': '{{alsoMissing}}' },
    };
    const { unresolved } = resolveRequest(req, ctx);
    expect(unresolved.sort()).toEqual(['alsoMissing', 'missing']);
  });

  it('substitutes scrape-do token and geoCode', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'scrape' },
      method: 'GET',
      url: 'https://target.com',
      scrapeDo: {
        enabled: true,
        token: '{{token}}',
        geoCode: '{{userId}}',
      },
    };
    const { request } = resolveRequest(req, ctx);
    expect(request.scrapeDo?.token).toBe('secret-token');
    expect(request.scrapeDo?.geoCode).toBe('42');
  });
});
