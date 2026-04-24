import { describe, it, expect } from 'vitest';
import { UA_PRESETS, type UaPresetKey } from '../src/ua-presets.js';
import { resolveUserAgent } from '../src/auto-headers.js';

const ENV = { version: '1.2.3', platform: 'darwin arm64' };

// Snapshot each preset so regressions in UA strings are caught at review time.
describe('UA_PRESETS', () => {
  const keys = Object.keys(UA_PRESETS) as UaPresetKey[];

  it('has at least 9 entries', () => {
    expect(keys.length).toBeGreaterThanOrEqual(9);
  });

  it.each(keys)('%s is a non-empty string', (key) => {
    const value = UA_PRESETS[key];
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
  });

  it('chrome-macos starts with Mozilla/5.0 (Macintosh', () => {
    expect(UA_PRESETS['chrome-macos']).toMatch(/^Mozilla\/5\.0 \(Macintosh/);
  });

  it('chrome-windows contains Windows NT', () => {
    expect(UA_PRESETS['chrome-windows']).toContain('Windows NT');
  });

  it('firefox-macos contains Firefox/', () => {
    expect(UA_PRESETS['firefox-macos']).toContain('Firefox/');
  });

  it('firefox-windows contains Windows NT', () => {
    expect(UA_PRESETS['firefox-windows']).toContain('Windows NT');
  });

  it('safari-macos contains Safari/ and Version/', () => {
    expect(UA_PRESETS['safari-macos']).toContain('Safari/');
    expect(UA_PRESETS['safari-macos']).toContain('Version/');
  });

  it('safari-ios contains iPhone and Mobile/', () => {
    expect(UA_PRESETS['safari-ios']).toContain('iPhone');
    expect(UA_PRESETS['safari-ios']).toContain('Mobile/');
  });

  it('googlebot contains Googlebot/', () => {
    expect(UA_PRESETS['googlebot']).toContain('Googlebot/');
  });

  it('curl starts with curl/', () => {
    expect(UA_PRESETS['curl']).toMatch(/^curl\//);
  });
});

describe('resolveUserAgent', () => {
  const base = {
    scrapeman: '2.0' as const,
    meta: { name: 'test' },
    method: 'GET' as const,
    url: 'http://example.com',
  };

  it('returns versioned UA when no preset set', () => {
    const ua = resolveUserAgent(base, ENV);
    expect(ua).toBe('Scrapeman/1.2.3 (darwin arm64)');
  });

  it('returns versioned UA for scrapeman preset', () => {
    const ua = resolveUserAgent({ ...base, uaPreset: 'scrapeman' }, ENV);
    expect(ua).toBe('Scrapeman/1.2.3 (darwin arm64)');
  });

  it('returns chrome-macos UA for chrome-macos preset', () => {
    const ua = resolveUserAgent({ ...base, uaPreset: 'chrome-macos' }, ENV);
    expect(ua).toBe(UA_PRESETS['chrome-macos']);
  });

  it('falls back to default UA for unknown preset', () => {
    const ua = resolveUserAgent({ ...base, uaPreset: 'totally-unknown-ua' }, ENV);
    expect(ua).toBe('Scrapeman/1.2.3 (darwin arm64)');
  });

  it('returns googlebot UA for googlebot preset', () => {
    const ua = resolveUserAgent({ ...base, uaPreset: 'googlebot' }, ENV);
    expect(ua).toBe(UA_PRESETS['googlebot']);
  });
});
