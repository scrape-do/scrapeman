import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { applyAuth } from '../src/auth/apply.js';

function req(overrides: Partial<ScrapemanRequest> & Pick<ScrapemanRequest, 'method' | 'url'>): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'test' },
    ...overrides,
  };
}

describe('applyAuth', () => {
  it('is a no-op when no auth', () => {
    const r = req({ method: 'GET', url: 'https://example.com' });
    expect(applyAuth(r)).toEqual(r);
  });

  it('is a no-op when auth type is none', () => {
    const r = req({
      method: 'GET',
      url: 'https://example.com',
      auth: { type: 'none' },
    });
    expect(applyAuth(r)).toEqual(r);
  });

  it('injects Basic Authorization header', () => {
    const out = applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'basic', username: 'admin', password: 's3cret' },
      }),
    );
    const expected = `Basic ${Buffer.from('admin:s3cret').toString('base64')}`;
    expect(out.headers?.Authorization).toBe(expected);
  });

  it('injects Bearer Authorization header', () => {
    const out = applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'bearer', token: 'abc.def.ghi' },
      }),
    );
    expect(out.headers?.Authorization).toBe('Bearer abc.def.ghi');
  });

  it('API key in header places value in custom header', () => {
    const out = applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'apiKey', key: 'X-Api-Key', value: 'abc', in: 'header' },
      }),
    );
    expect(out.headers?.['X-Api-Key']).toBe('abc');
    expect(out.params?.['X-Api-Key']).toBeUndefined();
  });

  it('API key in query places value in params', () => {
    const out = applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'apiKey', key: 'api_key', value: 'abc', in: 'query' },
      }),
    );
    expect(out.params?.['api_key']).toBe('abc');
    expect(out.headers?.['api_key']).toBeUndefined();
  });

  it('preserves existing headers and adds Authorization alongside', () => {
    const out = applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        headers: { Accept: 'application/json' },
        auth: { type: 'bearer', token: 'xxx' },
      }),
    );
    expect(out.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer xxx',
    });
  });

  it('does not mutate the input request', () => {
    const input = req({
      method: 'GET',
      url: 'https://example.com',
      headers: { Accept: 'application/json' },
      auth: { type: 'bearer', token: 'xxx' },
    });
    const snapshot = JSON.stringify(input);
    applyAuth(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('leaves oauth2 and awsSigV4 untouched (handled upstream)', () => {
    const r1 = req({
      method: 'GET',
      url: 'https://example.com',
      auth: {
        type: 'oauth2',
        flow: 'clientCredentials',
        tokenUrl: 'https://auth.example.com/token',
        clientId: 'c',
        clientSecret: 's',
      },
    });
    const out1 = applyAuth(r1);
    expect(out1.headers).toBeUndefined();

    const r2 = req({
      method: 'GET',
      url: 'https://example.com',
      auth: {
        type: 'awsSigV4',
        accessKeyId: 'k',
        secretAccessKey: 's',
        region: 'us-east-1',
        service: 's3',
      },
    });
    const out2 = applyAuth(r2);
    expect(out2.headers).toBeUndefined();
  });
});
