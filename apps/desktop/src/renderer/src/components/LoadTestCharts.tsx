import { useMemo } from 'react';
import type { LoadEvent, LoadProgress } from '@scrapeman/shared-types';

/**
 * Tiny SVG charts for the load test panel. Two side-by-side panels:
 *
 *   1. Latency over time — every iteration's `durationMs` plotted as a
 *      polyline. P50 and P95 reference lines from the live progress
 *      stats overlay so the user can see drift relative to averages.
 *
 *   2. Status histogram — bar chart of HTTP status codes (plus a
 *      synthetic "err" bucket for network errors). Bars are colour-coded
 *      by status class so 2xx success / 4xx client error / 5xx server
 *      error read at a glance.
 *
 * Inline SVG, no external chart library — keeps the bundle lean and
 * matches the rest of the load test panel's hand-rolled UI.
 */

const LATENCY_W = 360;
const LATENCY_H = 96;
const HISTOGRAM_W = 200;
const HISTOGRAM_H = 96;
const PADDING = 6;

export function LoadTestCharts({
  events,
  progress,
}: {
  events: LoadEvent[];
  progress: LoadProgress | null;
}): JSX.Element | null {
  // Don't render until we have at least one settled iteration. The
  // empty axis box is just noise during the "waiting for first
  // response" state.
  if (events.length === 0) return null;

  return (
    <div className="grid grid-cols-[2fr_1fr] gap-3">
      <LatencyChart events={events} progress={progress} />
      <StatusHistogram events={events} />
    </div>
  );
}

function LatencyChart({
  events,
  progress,
}: {
  events: LoadEvent[];
  progress: LoadProgress | null;
}): JSX.Element {
  const data = useMemo(() => sampleLatencies(events), [events]);
  const maxY = useMemo(() => {
    const m = Math.max(...data.map((d) => d.y), progress?.latencyP99 ?? 0, 1);
    // Round up to a nice number so the y-scale doesn't jitter on every
    // new sample. 10 ms steps below 100, 50 ms below 1000, 200 ms above.
    if (m < 100) return Math.ceil(m / 10) * 10;
    if (m < 1000) return Math.ceil(m / 50) * 50;
    return Math.ceil(m / 200) * 200;
  }, [data, progress?.latencyP99]);

  const path = useMemo(() => buildPath(data, maxY, LATENCY_W, LATENCY_H), [data, maxY]);

  const p50Y = progress
    ? mapY(progress.latencyP50, maxY, LATENCY_H)
    : null;
  const p95Y = progress
    ? mapY(progress.latencyP95, maxY, LATENCY_H)
    : null;

  return (
    <div className="rounded-md border border-line bg-bg-canvas px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          Latency over time
        </span>
        <span className="font-mono text-[10px] text-ink-4">
          peak {maxY}ms · {events.length} iterations
        </span>
      </div>
      <svg
        viewBox={`0 0 ${LATENCY_W} ${LATENCY_H}`}
        className="w-full"
        preserveAspectRatio="none"
        aria-label={`Latency chart, peak ${maxY}ms, ${events.length} iterations`}
      >
        {/* Grid: 4 horizontal lines for visual reference. */}
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1="0"
            x2={LATENCY_W}
            y1={LATENCY_H * p}
            y2={LATENCY_H * p}
            stroke="currentColor"
            strokeWidth="0.5"
            className="text-line-subtle"
          />
        ))}
        {/* P50 reference line — solid accent. */}
        {p50Y !== null && (
          <g>
            <line
              x1="0"
              x2={LATENCY_W}
              y1={p50Y}
              y2={p50Y}
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 3"
              className="text-status-ok"
            />
            <text
              x="2"
              y={p50Y - 2}
              className="fill-current text-[8px] text-status-ok"
            >
              p50 {Math.round(progress!.latencyP50)}ms
            </text>
          </g>
        )}
        {/* P95 reference line — dashed warning. */}
        {p95Y !== null && (
          <g>
            <line
              x1="0"
              x2={LATENCY_W}
              y1={p95Y}
              y2={p95Y}
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="3 3"
              className="text-status-clientError"
            />
            <text
              x="2"
              y={p95Y - 2}
              className="fill-current text-[8px] text-status-clientError"
            >
              p95 {Math.round(progress!.latencyP95)}ms
            </text>
          </g>
        )}
        {/* The actual latency series. */}
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-accent"
        />
      </svg>
    </div>
  );
}

function StatusHistogram({ events }: { events: LoadEvent[] }): JSX.Element {
  const buckets = useMemo(() => bucketByStatus(events), [events]);
  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const barW = (HISTOGRAM_W - PADDING * 2) / Math.max(buckets.length, 1);

  return (
    <div className="rounded-md border border-line bg-bg-canvas px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          Status histogram
        </span>
        <span className="font-mono text-[10px] text-ink-4">
          {buckets.length} {buckets.length === 1 ? 'bucket' : 'buckets'}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${HISTOGRAM_W} ${HISTOGRAM_H}`}
        className="w-full"
        preserveAspectRatio="none"
        aria-label="Status code histogram"
      >
        {buckets.map((bucket, i) => {
          const h = (bucket.count / maxCount) * (HISTOGRAM_H - 18);
          const x = PADDING + i * barW;
          const y = HISTOGRAM_H - h - 14;
          return (
            <g key={bucket.label}>
              <rect
                x={x + 1}
                y={y}
                width={barW - 2}
                height={h}
                className={`fill-current ${barColorClass(bucket.kind)}`}
              >
                <title>
                  {bucket.label}: {bucket.count}
                </title>
              </rect>
              <text
                x={x + barW / 2}
                y={HISTOGRAM_H - 4}
                textAnchor="middle"
                className="fill-current text-[8px] font-mono text-ink-3"
              >
                {bucket.label}
              </text>
              <text
                x={x + barW / 2}
                y={y - 2}
                textAnchor="middle"
                className="fill-current text-[8px] font-mono text-ink-2"
              >
                {bucket.count}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- pure helpers below; exported for unit tests ---------------------------

export interface XY {
  x: number;
  y: number;
}

/**
 * Sample the events into a series of (iteration, latency) points. For
 * runs under ~300 iterations we plot every event; above that we
 * down-sample by stepping, so the SVG path stays under ~300 vertices
 * and the line stays readable.
 */
export function sampleLatencies(events: LoadEvent[]): XY[] {
  if (events.length === 0) return [];
  const MAX_POINTS = 300;
  const step = Math.max(1, Math.ceil(events.length / MAX_POINTS));
  const out: XY[] = [];
  for (let i = 0; i < events.length; i += step) {
    const e = events[i]!;
    out.push({ x: e.iteration, y: e.durationMs });
  }
  // Make sure the last event lands on the chart so the user sees the
  // most recent value, even if the step skipped it.
  const last = events[events.length - 1]!;
  if (out[out.length - 1]!.x !== last.iteration) {
    out.push({ x: last.iteration, y: last.durationMs });
  }
  return out;
}

/** Build the SVG path string for a series of latency points. */
export function buildPath(
  points: XY[],
  maxY: number,
  width: number,
  height: number,
): string {
  if (points.length === 0) return '';
  const minX = points[0]!.x;
  const maxX = points[points.length - 1]!.x;
  const xRange = Math.max(maxX - minX, 1);
  const cmds: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const x = ((p.x - minX) / xRange) * width;
    const y = mapY(p.y, maxY, height);
    cmds.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return cmds.join(' ');
}

/** Map a y value to chart-space, inverted so 0 is at the bottom. */
export function mapY(value: number, maxY: number, height: number): number {
  if (maxY <= 0) return height;
  const ratio = Math.min(1, Math.max(0, value / maxY));
  return height - ratio * height;
}

export type StatusKind = 'ok' | 'redirect' | 'clientError' | 'serverError' | 'error';

export interface StatusBucket {
  label: string;
  count: number;
  kind: StatusKind;
}

/**
 * Bucket events by HTTP status. Network errors (status 0) land in a
 * synthetic "err" bucket. Sorted: success first, then by status code
 * ascending, errors last.
 */
export function bucketByStatus(events: LoadEvent[]): StatusBucket[] {
  const byStatus = new Map<number, number>();
  let errorCount = 0;
  for (const e of events) {
    if (e.status === 0 || e.errorKind) {
      errorCount += 1;
    } else {
      byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
    }
  }
  const buckets: StatusBucket[] = [];
  const codes = Array.from(byStatus.keys()).sort((a, b) => a - b);
  for (const code of codes) {
    buckets.push({
      label: String(code),
      count: byStatus.get(code)!,
      kind: statusKind(code),
    });
  }
  if (errorCount > 0) {
    buckets.push({ label: 'err', count: errorCount, kind: 'error' });
  }
  return buckets;
}

function statusKind(code: number): StatusKind {
  if (code >= 200 && code < 300) return 'ok';
  if (code >= 300 && code < 400) return 'redirect';
  if (code >= 400 && code < 500) return 'clientError';
  if (code >= 500 && code < 600) return 'serverError';
  return 'error';
}

function barColorClass(kind: StatusKind): string {
  switch (kind) {
    case 'ok':
      return 'text-status-ok';
    case 'redirect':
      return 'text-status-redirect';
    case 'clientError':
      return 'text-status-clientError';
    case 'serverError':
    case 'error':
      return 'text-method-delete';
  }
}
