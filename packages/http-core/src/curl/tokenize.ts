// Shell-ish tokenizer for curl command lines.
// Supports: single quotes, double quotes (with \" and \\), backslash line
// continuations, whitespace token separation. Not a full POSIX shell parser —
// handles the shapes curl commands come in when copied from Chrome, Firefox,
// Postman, Insomnia, etc.

export function tokenize(input: string): string[] {
  const source = input.replace(/\\\r?\n/g, ' ');
  const tokens: string[] = [];
  let i = 0;
  let current = '';
  let hasCurrent = false;

  const push = (): void => {
    if (hasCurrent) {
      tokens.push(current);
      current = '';
      hasCurrent = false;
    }
  };

  while (i < source.length) {
    const ch = source[i]!;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      push();
      i++;
      continue;
    }

    // Bash ANSI-C quoting: $'...'. Backslash escapes expand ( \n, \t, \uXXXX,
    // \xHH, \NNN, \', \\, \", etc.). This is what Chrome / Firefox "Copy as
    // cURL (bash)" emits for bodies containing non-printable bytes, and what
    // GraphQL clients use for `\u0021` → "!" in query strings.
    if (ch === '$' && source[i + 1] === "'") {
      hasCurrent = true;
      i += 2;
      while (i < source.length && source[i] !== "'") {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[i + 1]!;
          if (next === 'n') { current += '\n'; i += 2; continue; }
          if (next === 't') { current += '\t'; i += 2; continue; }
          if (next === 'r') { current += '\r'; i += 2; continue; }
          if (next === 'b') { current += '\b'; i += 2; continue; }
          if (next === 'f') { current += '\f'; i += 2; continue; }
          if (next === 'v') { current += '\v'; i += 2; continue; }
          if (next === 'a') { current += '\x07'; i += 2; continue; }
          if (next === 'e' || next === 'E') { current += '\x1b'; i += 2; continue; }
          if (next === '\\' || next === "'" || next === '"' || next === '?') {
            current += next; i += 2; continue;
          }
          if (next === 'x') {
            const hex = source.slice(i + 2, i + 4).match(/^[0-9a-fA-F]{1,2}/)?.[0] ?? '';
            if (hex) { current += String.fromCharCode(parseInt(hex, 16)); i += 2 + hex.length; continue; }
          }
          if (next === 'u') {
            const hex = source.slice(i + 2, i + 6).match(/^[0-9a-fA-F]{1,4}/)?.[0] ?? '';
            if (hex) { current += String.fromCharCode(parseInt(hex, 16)); i += 2 + hex.length; continue; }
          }
          if (next === 'U') {
            const hex = source.slice(i + 2, i + 10).match(/^[0-9a-fA-F]{1,8}/)?.[0] ?? '';
            if (hex) { current += String.fromCodePoint(parseInt(hex, 16)); i += 2 + hex.length; continue; }
          }
          if (/^[0-7]$/.test(next)) {
            const oct = source.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? '';
            if (oct) { current += String.fromCharCode(parseInt(oct, 8)); i += 1 + oct.length; continue; }
          }
          // Unknown escape — keep the backslash and the next char literal,
          // matching bash fallback behavior.
          current += '\\' + next;
          i += 2;
          continue;
        }
        current += source[i];
        i++;
      }
      i++;
      continue;
    }

    if (ch === "'") {
      hasCurrent = true;
      i++;
      while (i < source.length && source[i] !== "'") {
        current += source[i];
        i++;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      hasCurrent = true;
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[i + 1]!;
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
            i += 2;
            continue;
          }
        }
        current += source[i];
        i++;
      }
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < source.length) {
      hasCurrent = true;
      current += source[i + 1];
      i += 2;
      continue;
    }

    hasCurrent = true;
    current += ch;
    i++;
  }

  push();
  return tokens;
}
