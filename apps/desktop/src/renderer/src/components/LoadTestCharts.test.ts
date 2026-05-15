import { describe, expect, it } from 'vitest';
import type { LoadEvent } from '@scrapeman/shared-types';
import {
  bucketByStatus,
  buildPath,
  mapY,
  sampleLatencies,
} from './LoadTestCharts.js';

function ev(
  iteration: number,
  status: number,
  durationMs: number,
  overrides: Partial<LoadEvent> = {},
): LoadEvent {
  return {
    kind: 'iteration',
    iteration,
    status,
    durationMs,
    valid: status >= 200 && status < 400,
    ...overrides,
  } as LoadEvent;
}

describe('sampleLatencies', () => {
  it('returns every event when the run is short', () => {
    const events = Array.from({ length: 10 }, (_, i) => ev(i + 1, 200, 100 + i));
    const out = sampleLatencies(events);
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual({ x: 1, y: 100 });
    expect(out[9]).toEqual({ x: 10, y: 109 });
  });

  it('downsamples runs over 300 iterations to ~300 points', () => {
    const events = Array.from({ length: 900 }, (_, i) => ev(i + 1, 200, i));
    const out = sampleLatencies(events);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(320);
    // The last event must be present so the user sees the current value
    // even when the step skipped it.
    expect(out[out.length - 1]).toEqual({ x: 900, y: 899 });
  });

  it('returns [] for an empty run', () => {
    expect(sampleLatencies([])).toEqual([]);
  });
});

describe('buildPath', () => {
  it('returns an empty string for no points', () => {
    expect(buildPath([], 100, 200, 50)).toBe('');
  });

  it('emits M for the first point and L for the rest', () => {
    const path = buildPath(
      [
        { x: 0, y: 0 },
        { x: 5, y: 50 },
        { x: 10, y: 100 },
      ],
      100,
      200,
      50,
    );
    expect(path.startsWith('M')).toBe(true);
    expect(path.split('L').length).toBe(3); // first M + two L = three segments after split
  });

  it('maps y values inverted (higher y = lower SVG coordinate)', () => {
    // With maxY=100, value=0 should hit the bottom (height), value=100 the top (0).
    const path = buildPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 100 },
      ],
      100,
      200,
      50,
    );
    // First point at bottom (y=50), last at top (y=0).
    expect(path).toContain('M0.0,50.0');
    expect(path).toContain('L200.0,0.0');
  });
});

describe('mapY', () => {
  it('puts 0 at the bottom and maxY at the top', () => {
    expect(mapY(0, 100, 50)).toBe(50);
    expect(mapY(100, 100, 50)).toBe(0);
    expect(mapY(50, 100, 50)).toBe(25);
  });

  it('clamps values above maxY to the top', () => {
    expect(mapY(500, 100, 50)).toBe(0);
  });

  it('clamps negative values to the bottom', () => {
    expect(mapY(-10, 100, 50)).toBe(50);
  });

  it('handles maxY=0 without dividing by zero', () => {
    expect(mapY(10, 0, 50)).toBe(50);
  });
});

describe('bucketByStatus', () => {
  it('groups events by status code', () => {
    const events = [
      ev(1, 200, 100),
      ev(2, 200, 110),
      ev(3, 404, 90),
      ev(4, 500, 50),
    ];
    const out = bucketByStatus(events);
    expect(out).toEqual([
      { label: '200', count: 2, kind: 'ok' },
      { label: '404', count: 1, kind: 'clientError' },
      { label: '500', count: 1, kind: 'serverError' },
    ]);
  });

  it('puts network errors into the "err" bucket', () => {
    const events = [
      ev(1, 200, 100),
      ev(2, 0, 0, { errorKind: 'ECONNRESET' }),
      ev(3, 0, 0, { errorKind: 'ETIMEDOUT' }),
    ];
    const out = bucketByStatus(events);
    expect(out).toEqual([
      { label: '200', count: 1, kind: 'ok' },
      { label: 'err', count: 2, kind: 'error' },
    ]);
  });

  it('orders status buckets ascending, errors last', () => {
    const events = [
      ev(1, 500, 100),
      ev(2, 200, 50),
      ev(3, 0, 0, { errorKind: 'X' }),
      ev(4, 404, 80),
    ];
    const out = bucketByStatus(events).map((b) => b.label);
    expect(out).toEqual(['200', '404', '500', 'err']);
  });

  it('returns [] for no events', () => {
    expect(bucketByStatus([])).toEqual([]);
  });
});
