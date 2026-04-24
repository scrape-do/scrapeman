import { describe, it, expect } from 'vitest';
import { detectAntiBot, type AntiBotInput } from '../src/anti-bot.js';

function make(overrides: Partial<AntiBotInput> = {}): AntiBotInput {
  return {
    status: 200,
    headers: [],
    bodyText: '',
    ...overrides,
  };
}

describe('detectAntiBot — cloudflare', () => {
  it('detects cf-ray header with certainty', () => {
    const signal = detectAntiBot(make({ headers: [['cf-ray', '8abc123def456789-AMS']] }));
    expect(signal).not.toBeNull();
    expect(signal!.type).toBe('cloudflare');
    expect(signal!.confidence).toBe('certain');
  });

  it('detects checking your browser on 403 as likely', () => {
    const signal = detectAntiBot(
      make({ status: 403, bodyText: 'Checking your browser before accessing the site.' }),
    );
    expect(signal!.type).toBe('cloudflare');
    expect(signal!.confidence).toBe('likely');
  });

  it('detects cf-challenge on 403 as likely', () => {
    const signal = detectAntiBot(make({ status: 403, bodyText: '<div id="cf-challenge">…</div>' }));
    expect(signal!.type).toBe('cloudflare');
    expect(signal!.confidence).toBe('likely');
  });

  it('ignores cf-challenge body on non-403 status', () => {
    // cf-challenge body on 200 should not trigger cloudflare detection.
    const signal = detectAntiBot(make({ status: 200, bodyText: 'cf-challenge something' }));
    expect(signal).toBeNull();
  });
});

describe('detectAntiBot — ratelimit', () => {
  it('detects HTTP 429 with certainty', () => {
    const signal = detectAntiBot(make({ status: 429 }));
    expect(signal!.type).toBe('ratelimit');
    expect(signal!.confidence).toBe('certain');
  });

  it('detects Retry-After header as likely', () => {
    const signal = detectAntiBot(make({ headers: [['retry-after', '60']] }));
    expect(signal!.type).toBe('ratelimit');
    expect(signal!.confidence).toBe('likely');
    expect(signal!.retryAfter).toBe(60);
  });

  it('parses Retry-After integer correctly', () => {
    const signal = detectAntiBot(make({ status: 429, headers: [['retry-after', '120']] }));
    expect(signal!.retryAfter).toBe(120);
  });

  it('parses Retry-After HTTP-date format', () => {
    // A date far in the future should give a positive retryAfter.
    const future = new Date(Date.now() + 90_000).toUTCString();
    const signal = detectAntiBot(make({ status: 429, headers: [['retry-after', future]] }));
    expect(typeof signal!.retryAfter).toBe('number');
    // Should be approximately 90 seconds (give generous range for timing).
    expect(signal!.retryAfter).toBeGreaterThan(85);
    expect(signal!.retryAfter).toBeLessThan(95);
  });
});

describe('detectAntiBot — captcha', () => {
  it('detects hcaptcha in body', () => {
    const signal = detectAntiBot(make({ bodyText: 'Please solve the hcaptcha challenge below.' }));
    expect(signal!.type).toBe('captcha');
    expect(signal!.confidence).toBe('certain');
  });

  it('detects recaptcha in body', () => {
    const signal = detectAntiBot(make({ bodyText: '<div class="g-recaptcha" data-sitekey="…">' }));
    expect(signal!.type).toBe('captcha');
    expect(signal!.confidence).toBe('certain');
  });

  it('detects captcha-container in body', () => {
    const signal = detectAntiBot(make({ bodyText: '<div id="captcha-container"></div>' }));
    expect(signal!.type).toBe('captcha');
  });

  it('detects turnstile in body', () => {
    const signal = detectAntiBot(make({ bodyText: 'cf-turnstile challenge widget' }));
    expect(signal!.type).toBe('captcha');
  });
});

describe('detectAntiBot — botblock', () => {
  it('detects access denied on 403', () => {
    const signal = detectAntiBot(make({ status: 403, bodyText: 'Access Denied' }));
    expect(signal!.type).toBe('botblock');
    expect(signal!.confidence).toBe('likely');
  });

  it('detects automated access on 403', () => {
    const signal = detectAntiBot(
      make({ status: 403, bodyText: 'Automated access to this service is not permitted.' }),
    );
    expect(signal!.type).toBe('botblock');
  });

  it('does not trigger botblock on 200 with "access denied" text', () => {
    // Only fires on 403.
    const signal = detectAntiBot(make({ status: 200, bodyText: 'access denied' }));
    expect(signal).toBeNull();
  });

  it('does not trigger botblock on 403 with unrelated body', () => {
    const signal = detectAntiBot(make({ status: 403, bodyText: 'Forbidden' }));
    expect(signal).toBeNull();
  });
});

describe('detectAntiBot — clean response', () => {
  it('returns null for a normal 200', () => {
    const signal = detectAntiBot(make({ status: 200, bodyText: '{"ok":true}' }));
    expect(signal).toBeNull();
  });

  it('cloudflare takes priority over ratelimit', () => {
    // Both cf-ray and 429 present — cloudflare wins because it is checked first.
    const signal = detectAntiBot(
      make({ status: 429, headers: [['cf-ray', 'abc123-DFW']] }),
    );
    expect(signal!.type).toBe('cloudflare');
  });
});
