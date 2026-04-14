import { describe, expect, it } from 'vitest';
import { parseCurlCommand, CurlParseError } from '../src/curl/index.js';

describe('parseCurlCommand', () => {
  it('parses a bare URL curl', () => {
    const req = parseCurlCommand(`curl https://api.example.com/users`);
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com/users');
  });

  it('parses -X and headers', () => {
    const req = parseCurlCommand(
      `curl -X POST -H 'Content-Type: application/json' -H "Accept: application/json" https://api.example.com/users`,
    );
    expect(req.method).toBe('POST');
    expect(req.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });

  it('defaults method to POST when -d is given and no -X', () => {
    const req = parseCurlCommand(`curl -d 'hello' https://api.example.com`);
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ type: 'text', content: 'hello' });
  });

  it('detects JSON body from content and sets type=json', () => {
    const req = parseCurlCommand(
      `curl -X POST -d '{"name":"Ada"}' https://api.example.com/users`,
    );
    expect(req.body).toEqual({
      type: 'json',
      content: '{"name":"Ada"}',
    });
  });

  it('detects JSON body from Content-Type header', () => {
    const req = parseCurlCommand(
      `curl -X POST -H 'Content-Type: application/json' -d 'not strictly JSON' https://api.example.com/things`,
    );
    expect(req.body?.type).toBe('json');
  });

  it('parses -u into basic auth', () => {
    const req = parseCurlCommand(
      `curl -u admin:s3cret https://api.example.com`,
    );
    expect(req.auth).toEqual({
      type: 'basic',
      username: 'admin',
      password: 's3cret',
    });
  });

  it('parses --header flag form', () => {
    const req = parseCurlCommand(
      `curl --header "X-Token: abc" https://api.example.com`,
    );
    expect(req.headers?.['X-Token']).toBe('abc');
  });

  it('handles backslash line continuations (Chrome copy-as-curl)', () => {
    const input = `curl 'https://api.example.com/users' \\
      -H 'Accept: application/json' \\
      -H 'User-Agent: scrapeman/1.0' \\
      --compressed`;
    const req = parseCurlCommand(input);
    expect(req.url).toBe('https://api.example.com/users');
    expect(req.headers).toEqual({
      Accept: 'application/json',
      'User-Agent': 'scrapeman/1.0',
    });
  });

  it('treats -L as follow redirects', () => {
    const req = parseCurlCommand(`curl -L https://api.example.com`);
    expect(req.options?.redirect).toEqual({ follow: true, maxCount: 10 });
  });

  it('treats -k as ignoreInvalidCerts', () => {
    const req = parseCurlCommand(`curl -k https://self-signed.example.com`);
    expect(req.options?.tls?.ignoreInvalidCerts).toBe(true);
  });

  it('parses --user-agent', () => {
    const req = parseCurlCommand(
      `curl --user-agent 'Mozilla/5.0 scrapeman' https://api.example.com`,
    );
    expect(req.headers?.['User-Agent']).toBe('Mozilla/5.0 scrapeman');
  });

  it('parses -F multipart parts including file @ syntax', () => {
    const req = parseCurlCommand(
      `curl -F 'caption=hello world' -F 'file=@./photo.png' https://api.example.com/upload`,
    );
    expect(req.body?.type).toBe('multipart');
    expect(req.body).toEqual({
      type: 'multipart',
      parts: [
        { name: 'caption', type: 'text', value: 'hello world' },
        { name: 'file', type: 'file', file: './photo.png' },
      ],
    });
  });

  it('derives a readable name from the URL', () => {
    const req = parseCurlCommand(`curl https://api.example.com/users/42`);
    expect(req.meta.name).toBe('api.example.com — 42');
  });

  it('throws when no URL is present', () => {
    expect(() => parseCurlCommand(`curl -X GET`)).toThrow(CurlParseError);
  });

  it('is forgiving about extra unknown flags', () => {
    const req = parseCurlCommand(
      `curl --some-unknown-flag -X GET https://api.example.com`,
    );
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com');
  });

  it('parses --header with an equals sign form', () => {
    const req = parseCurlCommand(
      `curl --header='X-Debug: 1' https://api.example.com`,
    );
    expect(req.headers?.['X-Debug']).toBe('1');
  });

  it('preserves single-quoted special characters', () => {
    const req = parseCurlCommand(
      `curl -H 'Authorization: Bearer abc.def.ghi' https://api.example.com`,
    );
    expect(req.headers?.Authorization).toBe('Bearer abc.def.ghi');
  });

  it('captures -x http proxy into request.proxy', () => {
    const req = parseCurlCommand(
      `curl -x http://proxy.internal:8080 https://api.example.com`,
    );
    expect(req.proxy).toEqual({
      enabled: true,
      url: 'http://proxy.internal:8080',
    });
  });

  it('captures --proxy socks5 with auth via -U', () => {
    const req = parseCurlCommand(
      `curl --proxy socks5://127.0.0.1:9050 -U user:pass https://api.example.com`,
    );
    expect(req.proxy).toEqual({
      enabled: true,
      url: 'socks5://127.0.0.1:9050',
      auth: { username: 'user', password: 'pass' },
    });
  });

  it('captures --proxy with equals form', () => {
    const req = parseCurlCommand(
      `curl --proxy=http://p:3128 https://api.example.com`,
    );
    expect(req.proxy?.url).toBe('http://p:3128');
  });
});
