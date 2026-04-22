import type { RunnerResult, RunnerRequestResult } from './index.js';

// ---------- JSON export -----------------------------------------------------

export function exportRunnerJson(result: RunnerResult): string {
  return JSON.stringify(result, null, 2);
}

// ---------- CSV export ------------------------------------------------------

/** Serialize a field value for CSV: escape quotes and wrap in quotes if needed. */
function csvField(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  // Wrap in quotes if the value contains a comma, quote, or newline.
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_HEADERS = [
  'iteration',
  'requestIndex',
  'requestName',
  'method',
  'url',
  'status',
  'durationMs',
  'ok',
  'errorKind',
  'errorMessage',
  'startedAt',
];

function resultToCsvRow(r: RunnerRequestResult): string {
  return [
    r.iteration,
    r.requestIndex,
    r.requestName,
    r.method,
    r.url,
    r.status,
    r.durationMs,
    r.ok,
    r.errorKind ?? '',
    r.errorMessage ?? '',
    r.startedAt,
  ]
    .map(csvField)
    .join(',');
}

export function exportRunnerCsv(result: RunnerResult): string {
  const rows = [CSV_HEADERS.join(','), ...result.results.map(resultToCsvRow)];
  return rows.join('\n');
}

// ---------- HTML export -----------------------------------------------------

/** Minimal self-contained HTML report — no external dependencies. */
export function exportRunnerHtml(result: RunnerResult): string {
  const passRate =
    result.results.length > 0
      ? Math.round((result.totalSucceeded / result.results.length) * 100)
      : 0;

  const rowsHtml = result.results
    .map((r) => {
      const statusClass = r.ok ? 'ok' : 'fail';
      const statusText = r.status === 0 ? 'ERR' : String(r.status);
      const error = r.errorMessage ? escapeHtml(r.errorMessage) : '';
      return `<tr class="${statusClass}">
      <td>${r.iteration + 1}</td>
      <td>${escapeHtml(r.requestName)}</td>
      <td class="method">${escapeHtml(r.method)}</td>
      <td class="url">${escapeHtml(r.url)}</td>
      <td class="status">${statusText}</td>
      <td>${r.durationMs} ms</td>
      <td>${error}</td>
    </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Collection runner report</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 24px; background: #0b0d10; color: #e2e8f0; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #94a3b8; margin-bottom: 24px; }
  .summary { display: flex; gap: 16px; margin-bottom: 24px; }
  .stat { background: #1e2028; border-radius: 6px; padding: 12px 16px; }
  .stat .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  .stat .value { font-size: 20px; font-weight: 700; margin-top: 2px; }
  .ok .value, .ok-val { color: #4ade80; }
  .fail .value, .fail-val { color: #f87171; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th { background: #1e2028; color: #94a3b8; text-align: left; padding: 6px 10px; font-weight: 600; border-bottom: 1px solid #334155; }
  td { padding: 5px 10px; border-bottom: 1px solid #1e2028; vertical-align: top; }
  tr.ok td { background: #0f1a12; }
  tr.fail td { background: #1a0f10; }
  .method { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; color: #93c5fd; }
  .url { font-family: ui-monospace, monospace; font-size: 11px; color: #cbd5e1; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { font-family: ui-monospace, monospace; font-weight: 700; }
  tr.ok .status { color: #4ade80; }
  tr.fail .status { color: #f87171; }
</style>
</head>
<body>
<h1>Collection runner report</h1>
<div class="meta">Started: ${result.startedAt} &bull; Duration: ${result.totalDurationMs} ms &bull; ${result.iterations} iteration(s) &bull; ${result.requestCount} request(s)</div>
<div class="summary">
  <div class="stat">
    <div class="label">Total requests</div>
    <div class="value">${result.results.length}</div>
  </div>
  <div class="stat ok">
    <div class="label">Succeeded</div>
    <div class="value ok-val">${result.totalSucceeded}</div>
  </div>
  <div class="stat fail">
    <div class="label">Failed</div>
    <div class="value fail-val">${result.totalFailed}</div>
  </div>
  <div class="stat">
    <div class="label">Pass rate</div>
    <div class="value">${passRate}%</div>
  </div>
  <div class="stat">
    <div class="label">Total time</div>
    <div class="value">${result.totalDurationMs} ms</div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Request</th>
      <th>Method</th>
      <th>URL</th>
      <th>Status</th>
      <th>Duration</th>
      <th>Error</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
