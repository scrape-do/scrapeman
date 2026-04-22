/**
 * Bulk-edit helpers for the Headers table.
 *
 * Format: one header per line, "Key: Value".
 * A line starting with "//" marks a disabled header.
 * Blank lines are silently ignored.
 *
 * Lives in renderer utils (not http-core) so the Headers editor does not
 * import from @scrapeman/http-core, which would pull undici into the
 * browser bundle.
 */

export interface BulkHeaderRow {
  key: string;
  value: string;
  enabled: boolean;
}

export function serializeHeaderBulk(rows: BulkHeaderRow[]): string {
  return rows
    .map((row) => {
      const line = `${row.key}: ${row.value}`;
      return row.enabled ? line : `// ${line}`;
    })
    .join('\n');
}

export function parseHeaderBulk(text: string): BulkHeaderRow[] {
  const result: BulkHeaderRow[] = [];

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed === '') continue;

    let enabled = true;
    let line = trimmed;

    if (line.startsWith('//')) {
      enabled = false;
      line = line.slice(2).trim();
    }

    const colonIdx = line.indexOf(':');
    let key: string;
    let value: string;

    if (colonIdx === -1) {
      key = line.trim();
      value = '';
    } else {
      key = line.slice(0, colonIdx).trim();
      value = line.slice(colonIdx + 1).trim();
    }

    // Duplicate key: last wins — matches HTTP semantics used elsewhere.
    const existingIdx = result.findIndex((r) => r.key === key);
    if (existingIdx !== -1) {
      result[existingIdx] = { key, value, enabled };
    } else {
      result.push({ key, value, enabled });
    }
  }

  return result;
}
