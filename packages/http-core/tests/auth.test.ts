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
  it('is a no-op when no auth', async () => {
    const r = req({ method: 'GET', url: 'https://example.com' });
    expect(await applyAuth(r)).toEqual(r);
  });

  it('is a no-op when auth type is none', async () => {
    const r = req({
      method: 'GET',
      url: 'https://example.com',
      auth: { type: 'none' },
    });
    expect(await applyAuth(r)).toEqual(r);
  });

  it('injects Basic Authorization header', async () => {
    const out = await applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'basic', username: 'admin', password: 's3cret' },
      }),
    );
    const expected = `Basic ${Buffer.from('admin:s3cret').toString('base64')}`;
    expect(out.headers?.Authorization).toBe(expected);
  });

  it('injects Bearer Authorization header', async () => {
    const out = await applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'bearer', token: 'abc.def.ghi' },
      }),
    );
    expect(out.headers?.Authorization).toBe('Bearer abc.def.ghi');
  });

  it('API key in header places value in custom header', async () => {
    const out = await applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'apiKey', key: 'X-Api-Key', value: 'abc', in: 'header' },
      }),
    );
    expect(out.headers?.['X-Api-Key']).toBe('abc');
    expect(out.params?.['X-Api-Key']).toBeUndefined();
  });

  it('API key in query places value in params', async () => {
    const out = await applyAuth(
      req({
        method: 'GET',
        url: 'https://example.com',
        auth: { type: 'apiKey', key: 'api_key', value: 'abc', in: 'query' },
      }),
    );
    expect(out.params?.['api_key']).toBe('abc');
    expect(out.headers?.['api_key']).toBeUndefined();
  });

  it('preserves existing headers and adds Authorization alongside', async () => {
    const out = await applyAuth(
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

  it('does not mutate the input request', async () => {
    const input = req({
      method: 'GET',
      url: 'https://example.com',
      headers: { Accept: 'application/json' },
      auth: { type: 'bearer', token: 'xxx' },
    });
    const snapshot = JSON.stringify(input);
    await applyAuth(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('signs awsSigV4 requests inline (Authorization + X-Amz-Date headers)', async () => {
    const out = await applyAuth(
      req({
        method: 'GET',
        url: 'https://s3.amazonaws.com/my-bucket/file.txt',
        auth: {
          type: 'awsSigV4',
          accessKeyId: 'AKIDEXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
          region: 'us-east-1',
          service: 's3',
        },
      }),
    );
    expect(out.headers?.['Authorization']).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(out.headers?.['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(out.headers?.['X-Amz-Security-Token']).toBeUndefined();
  });

  it('leaves oauth2 authorizationCode flow untouched (handled upstream)', async () => {
    const r = req({
      method: 'GET',
      url: 'https://example.com',
      auth: {
        type: 'oauth2',
        flow: 'authorizationCode',
        tokenUrl: 'https://auth.example.com/token',
        authUrl: 'https://auth.example.com/authorize',
        clientId: 'c',
        clientSecret: 's',
      },
    });
    const out = await applyAuth(r);
    expect(out.headers).toBeUndefined();
  });
});
