import type { AntiBotSignal } from '@scrapeman/shared-types';

export interface AntiBotInput {
  status: number;
  headers: Array<[string, string]>;
  bodyText: string;
}

function header(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of headers) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * Inspect a response for anti-bot / rate-limit signals. Returns the first
 * signal that matches, or null when the response looks clean.
 *
 * Priority order: cloudflare > ratelimit > captcha > botblock.
 * Only the first match is returned so the banner stays unambiguous.
 */
export function detectAntiBot(input: AntiBotInput): AntiBotSignal | null {
  const { status, headers, bodyText } = input;
  const bodyLower = bodyText.toLowerCase();

  // Cloudflare: cf-ray header present, OR 403 with CF browser-check body.
  const hasCfRay = header(headers, 'cf-ray') !== undefined;
  const cfBodyMatch =
    status === 403 &&
    (bodyLower.includes('checking your browser') || bodyLower.includes('cf-challenge'));

  if (hasCfRay || cfBodyMatch) {
    return {
      type: 'cloudflare',
      confidence: hasCfRay ? 'certain' : 'likely',
      detail: hasCfRay ? 'cf-ray header present' : 'Cloudflare browser check page',
    };
  }

  // Rate-limit: 429 status OR Retry-After header.
  const retryAfterRaw = header(headers, 'retry-after');
  if (status === 429 || retryAfterRaw !== undefined) {
    const retryAfter = retryAfterRaw !== undefined ? parseRetryAfter(retryAfterRaw) : undefined;
    return {
      type: 'ratelimit',
      confidence: status === 429 ? 'certain' : 'likely',
      detail: status === 429 ? 'HTTP 429 Too Many Requests' : 'Retry-After header present',
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    };
  }

  // CAPTCHA: common challenge markers in the body.
  if (
    bodyLower.includes('hcaptcha') ||
    bodyLower.includes('recaptcha') ||
    bodyLower.includes('captcha-container') ||
    bodyLower.includes('turnstile')
  ) {
    return {
      type: 'captcha',
      confidence: 'certain',
      detail: 'CAPTCHA challenge detected in response body',
    };
  }

  // Generic bot block: 403 + known blocker body patterns.
  if (status === 403) {
    const blockPatterns = ['access denied', 'bot detected', 'automated access', 'automated request'];
    for (const pat of blockPatterns) {
      if (bodyLower.includes(pat)) {
        return {
          type: 'botblock',
          confidence: 'likely',
          detail: `403 with "${pat}" in body`,
        };
      }
    }
  }

  return null;
}

/**
 * Parse a Retry-After header value into seconds.
 * Supports both integer (delta-seconds) and HTTP-date formats.
 */
function parseRetryAfter(value: string): number | undefined {
  const trimmed = value.trim();
  const asInt = parseInt(trimmed, 10);
  if (!isNaN(asInt) && String(asInt) === trimmed) return asInt;
  // Try HTTP-date format.
  const asDate = Date.parse(trimmed);
  if (!isNaN(asDate)) {
    const secondsUntil = Math.max(0, Math.round((asDate - Date.now()) / 1000));
    return secondsUntil;
  }
  return undefined;
}
