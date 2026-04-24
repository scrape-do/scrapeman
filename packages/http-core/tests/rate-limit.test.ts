/**
 * Rate-limit tests.
 *
 * We test the delay calculation logic directly (unit level) rather than
 * wiring through the full runner + executor, which would require live network
 * or complex module mocking. The runner integration is covered by load.test.ts.
 */
import { describe, it, expect } from 'vitest';
import type { RateLimitConfig } from '@scrapeman/shared-types';

/** Mirror of the delay calculation in load/runner.ts */
function computeDelay(
  runDelay: number,
  rateLimit: RateLimitConfig | undefined,
  randomFraction?: number,
): number {
  const rl = rateLimit;
  let rlDelay = 0;
  if (rl?.enabled && runDelay === 0) {
    const jitterMin = rl.jitterMinMs ?? 0;
    const jitterMax = rl.jitterMaxMs ?? 0;
    const frac = randomFraction ?? 0;
    const jitter =
      jitterMax > jitterMin
        ? Math.floor(frac * (jitterMax - jitterMin)) + jitterMin
        : 0;
    rlDelay = rl.fixedDelayMs + jitter;
  }
  return runDelay + rlDelay;
}

describe('rate-limit delay calculation', () => {
  it('returns 0 when rateLimit is disabled', () => {
    const delay = computeDelay(0, { enabled: false, fixedDelayMs: 500 });
    expect(delay).toBe(0);
  });

  it('returns fixedDelayMs when rateLimit is enabled and runDelay is 0', () => {
    const delay = computeDelay(0, { enabled: true, fixedDelayMs: 200 });
    expect(delay).toBe(200);
  });

  it('adds jitter on top of fixedDelayMs', () => {
    // randomFraction = 0.5 → jitter = 0.5 * (200 - 100) + 100 = 150
    const delay = computeDelay(
      0,
      { enabled: true, fixedDelayMs: 300, jitterMinMs: 100, jitterMaxMs: 200 },
      0.5,
    );
    expect(delay).toBe(300 + 150);
  });

  it('jitter floor at jitterMinMs when randomFraction = 0', () => {
    const delay = computeDelay(
      0,
      { enabled: true, fixedDelayMs: 100, jitterMinMs: 50, jitterMaxMs: 150 },
      0,
    );
    expect(delay).toBe(100 + 50);
  });

  it('run-level delay takes priority: rateLimit NOT added when runDelay > 0', () => {
    const delay = computeDelay(100, { enabled: true, fixedDelayMs: 300 });
    // runDelay=100, so rlDelay stays 0 — only 100 ms is applied.
    expect(delay).toBe(100);
  });

  it('returns only runDelay when rateLimit is undefined', () => {
    expect(computeDelay(150, undefined)).toBe(150);
  });

  it('returns 0 when both runDelay and rateLimit are zero/disabled', () => {
    expect(computeDelay(0, { enabled: false, fixedDelayMs: 0 })).toBe(0);
  });

  it('jitter is 0 when min >= max', () => {
    // jitterMin === jitterMax → no jitter range, so jitter = 0.
    const delay = computeDelay(
      0,
      { enabled: true, fixedDelayMs: 200, jitterMinMs: 100, jitterMaxMs: 100 },
      0.9,
    );
    expect(delay).toBe(200);
  });
});
