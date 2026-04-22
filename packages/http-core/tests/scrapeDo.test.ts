import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, type ScrapemanRequest } from '@scrapeman/shared-types';
import { composeScrapeDoRequest } from '../src/scrapeDo/compose.js';

function req(overrides: Partial<ScrapemanRequest> & Pick<ScrapemanRequest, 'method' | 'url'>): ScrapemanRequest {
  return {
    scrapeman: FORMAT_VERSION,
    meta: { name: 'test' },
    ...overrides,
  };
}

describe('composeScrapeDoRequest', () => {
  it('is a no-op when scrapeDo is missing', () => {
    const r = req({ method: 'GET', url: 'https://target.com' });
    expect(composeScrapeDoRequest(r)).toEqual(r);
  });

  it('is a no-op when scrapeDo is disabled', () => {
    const r = req({
      method: 'GET',
      url: 'https://target.com',
      scrapeDo: { enabled: false, token: 'tok' },
    });
    expect(composeScrapeDoRequest(r)).toEqual(r);
  });

  it('rewrites URL to api.scrape.do with token + url params', () => {
    const out = composeScrapeDoRequest(
      req({
        method: 'GET',
        url: 'https://target.com/path',
        scrapeDo: { enabled: true, token: 'sd_abc' },
      }),
    );
    const u = new URL(out.url);
    expect(u.host).toBe('api.scrape.do');
    expect(u.searchParams.get('token')).toBe('sd_abc');
    expect(u.searchParams.get('url')).toBe('https://target.com/path');
  });

  it('appends optional params: render, super, geoCode, customHeaders, waitUntil', () => {
    const out = composeScrapeDoRequest(
      req({
        method: 'GET',
        url: 'https://target.com',
        scrapeDo: {
          enabled: true,
          token: 'tok',
          render: true,
          super: true,
          geoCode: 'us',
          customHeaders: true,
          waitUntil: 'domcontentloaded',
        },
      }),
    );
    const u = new URL(out.url);
    expect(u.searchParams.get('render')).toBe('true');
    expect(u.searchParams.get('super')).toBe('true');
    expect(u.searchParams.get('geoCode')).toBe('us');
    expect(u.searchParams.get('customHeaders')).toBe('true');
    expect(u.searchParams.get('waitUntil')).toBe('domcontentloaded');
  });

  it('omits boolean params when false', () => {
    const out = composeScrapeDoRequest(
      req({
        method: 'GET',
        url: 'https://target.com',
        scrapeDo: { enabled: true, token: 'tok', render: false, super: false },
      }),
    );
    const u = new URL(out.url);
    expect(u.searchParams.has('render')).toBe(false);
    expect(u.searchParams.has('super')).toBe(false);
  });

  it('uses request.url verbatim as the inner target (no params re-appending)', () => {
    // request.url already carries every enabled param via the URL bar.
    // The composer must not re-append request.params or the scrape.do API
    // rejects duplicated keys with
    // "Wrong query parameter. You are sending multiple value via same parameter(...)".
    const out = composeScrapeDoRequest(
      req({
        method: 'GET',
        url: 'https://target.com/search?q=scrape+do&page=2',
        params: { q: 'scrape do', page: '2', ghost: 'leftover' },
        scrapeDo: { enabled: true, token: 'tok' },
      }),
    );
    const u = new URL(out.url);
    const inner = u.searchParams.get('url');
    expect(inner).toBe('https://target.com/search?q=scrape+do&page=2');
    const innerUrl = new URL(inner!);
    expect(innerUrl.searchParams.getAll('q')).toEqual(['scrape do']);
    expect(innerUrl.searchParams.get('page')).toBe('2');
    expect(innerUrl.searchParams.has('ghost')).toBe(false);
  });

  it('clears request.params and request.scrapeDo on the composed request', () => {
    const out = composeScrapeDoRequest(
      req({
        method: 'GET',
        url: 'https://target.com',
        params: { q: 'x' },
        scrapeDo: { enabled: true, token: 'tok' },
      }),
    );
    expect(out.params).toBeUndefined();
    expect(out.scrapeDo).toBeUndefined();
  });

  it('round-trip stable: composing twice gives the same URL', () => {
    const r = req({
      method: 'GET',
      url: 'https://target.com',
      scrapeDo: { enabled: true, token: 'tok', render: true },
    });
    const once = composeScrapeDoRequest(r);
    const twice = composeScrapeDoRequest(once);
    expect(twice.url).toBe(once.url);
  });
});
