import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { serializeRequest } from '../src/format/serialize.js';
import { parseRequest, FormatParseError } from '../src/format/parse.js';

async function roundTrip(request: ScrapemanRequest): Promise<ScrapemanRequest> {
  const { yaml, sidecars } = serializeRequest(request, 'test-request');
  const sidecarMap = new Map(sidecars.map((s) => [s.relPath, s.content]));
  return parseRequest(yaml, {
    load: (relPath) => {
      const content = sidecarMap.get(relPath);
      if (content === undefined) throw new Error(`sidecar not found: ${relPath}`);
      return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
    },
  });
}

describe('serialize + parse', () => {
  it('round-trips a simple GET', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Health check' },
      method: 'GET',
      url: 'https://api.example.com/health',
      headers: { Accept: 'application/json' },
    };
    const parsed = await roundTrip(original);
    expect(parsed).toEqual(original);
  });

  it('round-trips a POST with inline JSON body', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Create user', tags: ['users', 'write'] },
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      auth: { type: 'bearer', token: '{{apiToken}}' },
      body: {
        type: 'json',
        content: '{\n  "name": "Ada",\n  "email": "ada@example.com"\n}',
      },
    };
    const parsed = await roundTrip(original);
    expect(parsed).toEqual(original);
  });

  it('promotes a large body to a sidecar file', async () => {
    const bigBody = 'x'.repeat(5000);
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Bulk import' },
      method: 'POST',
      url: 'https://api.example.com/bulk',
      body: { type: 'json', content: bigBody },
    };
    const { yaml, sidecars } = serializeRequest(original, 'bulk-import');
    expect(yaml).toMatch(/file:\s*"?files\/bulk-import\.body\.json"?/);
    expect(yaml).not.toContain(bigBody.slice(0, 10));
    expect(sidecars).toHaveLength(1);
    expect(sidecars[0]!.content).toBe(bigBody);
  });

  it('round-trips multipart form with file part', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Upload avatar' },
      method: 'POST',
      url: 'https://api.example.com/users/{{userId}}/avatar',
      auth: { type: 'bearer', token: '{{apiToken}}' },
      body: {
        type: 'multipart',
        parts: [
          { name: 'caption', type: 'text', value: 'Profile picture' },
          {
            name: 'file',
            type: 'file',
            file: './files/upload-avatar.avatar.png',
            contentType: 'image/png',
          },
        ],
      },
    };
    const parsed = await roundTrip(original);
    expect(parsed).toEqual(original);
  });

  it('round-trips OAuth2 + scrape-do + options', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Protected fetch' },
      method: 'GET',
      url: 'https://target-site.com/products/42',
      headers: { Accept: 'text/html' },
      auth: {
        type: 'oauth2',
        flow: 'clientCredentials',
        tokenUrl: 'https://auth.example.com/oauth/token',
        clientId: '{{oauthClientId}}',
        clientSecret: '{{oauthClientSecret}}',
        scope: 'read:products',
      },
      scrapeDo: {
        enabled: true,
        token: '{{scrapeDoToken}}',
        render: true,
        super: false,
        geoCode: 'us',
        waitUntil: 'domcontentloaded',
        customHeaders: true,
      },
      options: {
        timeout: { total: 60000 },
        redirect: { follow: true, maxCount: 10 },
        httpVersion: 'auto',
      },
    };
    const parsed = await roundTrip(original);
    expect(parsed).toEqual(original);
  });

  it('quotes Norway-problem values correctly', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Norway test' },
      method: 'POST',
      url: 'https://example.com/norway',
      headers: {
        'X-Country': 'no',
        'X-Enabled': 'yes',
        'X-Number': '3.14',
      },
    };
    const { yaml } = serializeRequest(original, 'norway');
    expect(yaml).toContain('"no"');
    expect(yaml).toContain('"yes"');
    expect(yaml).toContain('"3.14"');
    const parsed = await roundTrip(original);
    expect(parsed).toEqual(original);
  });

  it('emits deterministic key order', () => {
    const req: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'order' },
      method: 'GET',
      url: 'https://example.com',
      headers: { A: '1', B: '2' },
      options: { timeout: { total: 1000 } },
      scrapeDo: { enabled: true, token: 'tok' },
    };
    const yaml1 = serializeRequest(req, 'order').yaml;
    const yaml2 = serializeRequest(req, 'order').yaml;
    expect(yaml1).toBe(yaml2);
    const metaIdx = yaml1.indexOf('meta:');
    const methodIdx = yaml1.indexOf('method:');
    const urlIdx = yaml1.indexOf('url:');
    const headersIdx = yaml1.indexOf('headers:');
    const scrapeDoIdx = yaml1.indexOf('scrapeDo:');
    const optionsIdx = yaml1.indexOf('options:');
    expect(metaIdx).toBeLessThan(methodIdx);
    expect(methodIdx).toBeLessThan(urlIdx);
    expect(urlIdx).toBeLessThan(headersIdx);
    expect(headersIdx).toBeLessThan(scrapeDoIdx);
    expect(scrapeDoIdx).toBeLessThan(optionsIdx);
  });

  it('round-trips params with disabled entries', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'Param toggle test' },
      method: 'GET',
      url: 'https://api.example.com/search?q=hello',
      params: { q: 'hello', debug: '1', secret: 'abc' },
      // 'debug' and 'secret' are disabled; 'q' is enabled (present in URL)
      disabledParams: ['debug', 'secret'],
    };
    const parsed = await roundTrip(original);
    expect(parsed).toEqual(original);
    // Verify disabled keys are preserved in the parsed result
    expect(parsed.disabledParams).toEqual(['debug', 'secret']);
    expect(parsed.params).toEqual({ q: 'hello', debug: '1', secret: 'abc' });
  });

  it('rejects invalid version', async () => {
    const yaml = `scrapeman: "0.9"\nmeta:\n  name: bad\nmethod: GET\nurl: https://example.com\n`;
    await expect(parseRequest(yaml)).rejects.toBeInstanceOf(FormatParseError);
  });

  it('accepts legacy version 1.0 (pre-`.sman` files) and normalizes to current version', async () => {
    const yaml = `scrapeman: "1.0"\nmeta:\n  name: Legacy\nmethod: GET\nurl: https://example.com\n`;
    const parsed = await parseRequest(yaml);
    expect(parsed.meta.name).toBe('Legacy');
    // Reader always hands out the current writer version so round-trips
    // migrate the on-disk stamp to 2.0 transparently.
    expect(parsed.scrapeman).toBe(FORMAT_VERSION);
  });

  it('accepts current version 2.0', async () => {
    const yaml = `scrapeman: "2.0"\nmeta:\n  name: Current\nmethod: GET\nurl: https://example.com\n`;
    const parsed = await parseRequest(yaml);
    expect(parsed.scrapeman).toBe(FORMAT_VERSION);
  });

  it('accepts custom HTTP methods through the format', async () => {
    const original: ScrapemanRequest = {
      scrapeman: FORMAT_VERSION,
      meta: { name: 'WebDAV' },
      method: 'PROPFIND',
      url: 'https://dav.example.com/',
    };
    const parsed = await roundTrip(original);
    expect(parsed.method).toBe('PROPFIND');
  });
});
