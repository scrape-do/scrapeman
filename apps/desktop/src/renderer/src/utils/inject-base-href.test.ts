import { describe, expect, it } from 'vitest';
import { injectBaseHref } from './inject-base-href.js';

describe('injectBaseHref', () => {
  const URL = 'https://www.printables.com/@DukeDoks';

  it('injects right after <head> when one is present', () => {
    const out = injectBaseHref(
      '<!DOCTYPE html><html><head><title>x</title></head><body>hi</body></html>',
      URL,
    );
    expect(out).toContain('<head><base href="https://www.printables.com/@DukeDoks"><title>');
  });

  it('handles <head> with attributes', () => {
    const out = injectBaseHref('<html><head lang="en"><title>x</title></head></html>', URL);
    expect(out).toContain('<head lang="en"><base href=');
  });

  it('does not override an existing <base>', () => {
    const html = '<html><head><base href="https://other.example/"><title>x</title></head></html>';
    expect(injectBaseHref(html, URL)).toBe(html);
  });

  it('wraps <html> with a synthetic <head> when there is no head', () => {
    const out = injectBaseHref('<html><body>hi</body></html>', URL);
    expect(out).toContain('<html><head><base href="https://www.printables.com/@DukeDoks"></head><body>');
  });

  it('prepends a synthetic head when there is no <html> at all', () => {
    const out = injectBaseHref('<p>fragment only</p>', URL);
    expect(out.startsWith('<head><base href="https://www.printables.com/@DukeDoks"></head>')).toBe(true);
    expect(out).toContain('<p>fragment only</p>');
  });

  it('encodes embedded double quotes in the URL', () => {
    const dirty = 'https://x.example/?q="evil"';
    const out = injectBaseHref('<head></head>', dirty);
    // The closing quote of the href attr cannot be terminated early by the URL.
    expect(out).toContain('href="https://x.example/?q=&quot;evil&quot;"');
  });

  it('returns the html untouched when url is empty', () => {
    const html = '<head></head><body>x</body>';
    expect(injectBaseHref(html, '')).toBe(html);
  });
});
