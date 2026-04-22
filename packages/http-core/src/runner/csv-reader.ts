/**
 * Parses a CSV string into an array of variable bags.
 * The first row is treated as the header (variable names).
 * Each subsequent row becomes one iteration's variable overrides.
 *
 * Handles:
 * - Quoted fields (may contain commas or newlines).
 * - CRLF and LF line endings.
 * - Empty trailing rows (skipped).
 */
export function parseCsvIterations(
  csv: string,
): Array<Record<string, string>> {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const headers = rows[0]!;
  const result: Array<Record<string, string>> = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    // Skip completely empty rows.
    if (row.every((cell) => cell === '')) continue;
    const bag: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j]!.trim();
      if (key) {
        bag[key] = row[j] ?? '';
      }
    }
    result.push(bag);
  }

  return result;
}

/** Parse a CSV string into a 2-D array of string cells. */
function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const len = csv.length;

  while (i < len) {
    const ch = csv[i];

    if (ch === '"') {
      // Quoted field.
      let field = '';
      i++; // skip opening quote
      while (i < len) {
        if (csv[i] === '"') {
          if (csv[i + 1] === '"') {
            // Escaped quote.
            field += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          field += csv[i];
          i++;
        }
      }
      row.push(field);
      // Expect comma or newline next.
      if (csv[i] === ',') i++;
    } else if (ch === ',') {
      row.push('');
      i++;
    } else if (ch === '\r' || ch === '\n') {
      rows.push(row);
      row = [];
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      i++;
    } else {
      // Unquoted field.
      let field = '';
      while (i < len && csv[i] !== ',' && csv[i] !== '\r' && csv[i] !== '\n') {
        field += csv[i];
        i++;
      }
      row.push(field);
      if (csv[i] === ',') i++;
    }
  }

  // Push the last row if non-empty.
  if (row.length > 0) rows.push(row);

  return rows;
}
