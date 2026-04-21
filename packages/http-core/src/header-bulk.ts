/**
 * Bulk-edit helpers for the Headers table.
 *
 * Format: one header per line, "Key: Value".
 * A line starting with "//" marks a disabled header.
 * Blank lines are silently ignored.
 */

export interface BulkHeaderRow {
  key: string;
  value: string;
  enabled: boolean;
}

/**
 * Convert an array of header rows to bulk-edit textarea text.
 *
 * Disabled rows are prefixed with "// ".
 * Enabled rows are written as "Key: Value".
 */
export function serializeHeaderBulk(rows: BulkHeaderRow[]): string {
  return rows
    .map((row) => {
      const line = `${row.key}: ${row.value}`;
      return row.enabled ? line : `// ${line}`;
    })
    .join('\n');
}

/**
 * Parse bulk-edit textarea text back into header rows.
 *
 * Rules:
 *   - Blank lines (after trim) are ignored.
 *   - Lines starting with "//" are disabled; the "//" prefix is stripped before parsing.
 *   - The first ":" splits key and value; value may contain further colons.
 *   - Key and value are trimmed of surrounding whitespace.
 *   - If a line has no ":", it is treated as a key with an empty value.
 *   - Duplicate keys: last occurrence wins (matches HTTP semantics used elsewhere).
 */
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

    // Duplicate key: last wins — find existing and replace.
    const existingIdx = result.findIndex((r) => r.key === key);
    if (existingIdx !== -1) {
      result[existingIdx] = { key, value, enabled };
    } else {
      result.push({ key, value, enabled });
    }
  }

  return result;
}
