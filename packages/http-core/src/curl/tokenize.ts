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
