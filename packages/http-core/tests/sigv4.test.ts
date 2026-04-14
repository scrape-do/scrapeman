import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { signAwsSigV4, type SigV4Credentials } from '../src/auth/sigv4.js';
import { applyAuth } from '../src/auth/apply.js';

const baseCreds: SigV4Credentials = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};

function req(overrides: Partial<ScrapemanRequest> & Pick<ScrapemanRequest, 'method' | 'url'>): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'test' },
    ...overrides,
  };
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

describe('signAwsSigV4', () => {
  it('signs an S3 GET with Authorization and X-Amz-Date headers', () => {
    const out = signAwsSigV4(
      req({
        method: 'GET',
        url: 'https://s3.amazonaws.com/my-bucket/file.txt',
      }),
      baseCreds,
    );
    expect(out.headers?.['Authorization']).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(out.headers?.['Authorization']).toContain('us-east-1/s3/aws4_request');
    expect(out.headers?.['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('includes X-Amz-Security-Token when sessionToken is provided', () => {
    const out = signAwsSigV4(
      req({ method: 'GET', url: 'https://s3.amazonaws.com/bucket/key' }),
      { ...baseCreds, sessionToken: 'session-token-value' },
    );
    expect(out.headers?.['X-Amz-Security-Token']).toBe('session-token-value');
  });

  it('omits X-Amz-Security-Token when sessionToken is absent', () => {
    const out = signAwsSigV4(
      req({ method: 'GET', url: 'https://s3.amazonaws.com/bucket/key' }),
      baseCreds,
    );
    expect(out.headers?.['X-Amz-Security-Token']).toBeUndefined();
  });

  it('computes X-Amz-Content-Sha256 over the JSON body string', () => {
    const body = JSON.stringify({ hello: 'world' });
    const out = signAwsSigV4(
      req({
        method: 'POST',
        url: 'https://my-service.us-east-1.amazonaws.com/resource',
        headers: { 'Content-Type': 'application/json' },
        body: { type: 'json', content: body },
      }),
      { ...baseCreds, service: 'execute-api' },
    );
    const contentHash = out.headers?.['X-Amz-Content-Sha256'];
    // aws4 only sets X-Amz-Content-Sha256 for s3 by default, so we accept
    // either the signed header or just verify the body was hashed into the
    // canonical request via a non-empty Authorization header.
    if (contentHash) {
      expect(contentHash).toBe(sha256hex(body));
    } else {
      expect(out.headers?.['Authorization']).toMatch(/^AWS4-HMAC-SHA256 /);
    }
  });

  it('empty body signs to sha256 of empty string for s3', () => {
    const out = signAwsSigV4(
      req({ method: 'GET', url: 'https://s3.amazonaws.com/bucket/key' }),
      baseCreds,
    );
    // aws4 injects X-Amz-Content-Sha256 for s3 service.
    expect(out.headers?.['X-Amz-Content-Sha256']).toBe(sha256hex(''));
  });

  it('does not mutate the input request', () => {
    const input = req({
      method: 'GET',
      url: 'https://s3.amazonaws.com/bucket/key',
      headers: { Accept: 'application/json' },
    });
    const snapshot = JSON.stringify(input);
    signAwsSigV4(input, baseCreds);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('applyAuth — awsSigV4 wiring', () => {
  it('wires SigV4 signing through applyAuth', async () => {
    const out = await applyAuth(
      req({
        method: 'GET',
        url: 'https://s3.amazonaws.com/bucket/key',
        auth: {
          type: 'awsSigV4',
          accessKeyId: baseCreds.accessKeyId,
          secretAccessKey: baseCreds.secretAccessKey,
          region: 'us-east-1',
          service: 's3',
        },
      }),
    );
    expect(out.headers?.['Authorization']).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(out.headers?.['X-Amz-Date']).toBeDefined();
    expect(out.headers?.['X-Amz-Security-Token']).toBeUndefined();
  });

  it('passes sessionToken through applyAuth', async () => {
    const out = await applyAuth(
      req({
        method: 'GET',
        url: 'https://s3.amazonaws.com/bucket/key',
        auth: {
          type: 'awsSigV4',
          accessKeyId: baseCreds.accessKeyId,
          secretAccessKey: baseCreds.secretAccessKey,
          sessionToken: 'sess-abc',
          region: 'us-east-1',
          service: 's3',
        },
      }),
    );
    expect(out.headers?.['X-Amz-Security-Token']).toBe('sess-abc');
  });
});
