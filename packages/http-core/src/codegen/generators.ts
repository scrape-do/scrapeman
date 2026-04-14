import type { ScrapemanRequest } from '@scrapeman/shared-types';
import { prepareRequest } from './prepare.js';
import type { Codegen, CodegenOptions } from './types.js';

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function jsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function pyString(value: string): string {
  if (value.includes('\n')) {
    return `"""${value.replace(/"""/g, '\\"\\"\\"')}"""`;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function goString(value: string): string {
  if (!value.includes('`') && !value.includes('\n')) {
    return `\`${value}\``;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export const curlGenerator: Codegen = {
  target: 'curl',
  label: 'curl',
  language: 'shell',
  generate(request: ScrapemanRequest, options: CodegenOptions): string {
    const p = prepareRequest(request, options);
    const parts: string[] = [`curl -X ${p.method}`];
    parts.push(`  ${shellSingleQuote(p.url)}`);
    for (const [key, value] of Object.entries(p.headers)) {
      parts.push(`  -H ${shellSingleQuote(`${key}: ${value}`)}`);
    }
    if (p.body !== null) {
      parts.push(`  --data-raw ${shellSingleQuote(p.body)}`);
    }
    return parts.join(' \\\n');
  },
};

export const fetchGenerator: Codegen = {
  target: 'fetch',
  label: 'JavaScript (fetch)',
  language: 'javascript',
  generate(request: ScrapemanRequest, options: CodegenOptions): string {
    const p = prepareRequest(request, options);
    const headerLines = Object.entries(p.headers)
      .map(([key, value]) => `    ${jsString(key)}: ${jsString(value)},`)
      .join('\n');
    const bodyLine =
      p.body !== null ? `\n  body: ${jsString(p.body)},` : '';
    const headerBlock =
      headerLines.length > 0 ? `\n  headers: {\n${headerLines}\n  },` : '';
    return `const response = await fetch(${jsString(p.url)}, {
  method: ${jsString(p.method)},${headerBlock}${bodyLine}
});

const data = await response.text();
console.log(response.status, data);`;
  },
};

export const pythonGenerator: Codegen = {
  target: 'python',
  label: 'Python (requests)',
  language: 'python',
  generate(request: ScrapemanRequest, options: CodegenOptions): string {
    const p = prepareRequest(request, options);
    const lines: string[] = ['import requests', ''];
    if (Object.keys(p.headers).length > 0) {
      lines.push('headers = {');
      for (const [key, value] of Object.entries(p.headers)) {
        lines.push(`    ${pyString(key)}: ${pyString(value)},`);
      }
      lines.push('}');
      lines.push('');
    }
    const args: string[] = [pyString(p.url)];
    if (Object.keys(p.headers).length > 0) args.push('headers=headers');
    if (p.body !== null) {
      if (p.bodyLooksJson) {
        args.push(`data=${pyString(p.body)}.encode('utf-8')`);
      } else {
        args.push(`data=${pyString(p.body)}`);
      }
    }
    lines.push(`response = requests.request(${pyString(p.method)}, ${args.join(', ')})`);
    lines.push('print(response.status_code, response.text)');
    return lines.join('\n');
  },
};

export const goGenerator: Codegen = {
  target: 'go',
  label: 'Go (net/http)',
  language: 'go',
  generate(request: ScrapemanRequest, options: CodegenOptions): string {
    const p = prepareRequest(request, options);
    const lines: string[] = [
      'package main',
      '',
      'import (',
      '\t"fmt"',
      '\t"io"',
      '\t"net/http"',
      ...(p.body !== null ? ['\t"strings"'] : []),
      ')',
      '',
      'func main() {',
    ];
    if (p.body !== null) {
      lines.push(`\tbody := strings.NewReader(${goString(p.body)})`);
      lines.push(
        `\treq, err := http.NewRequest(${goString(p.method)}, ${goString(p.url)}, body)`,
      );
    } else {
      lines.push(
        `\treq, err := http.NewRequest(${goString(p.method)}, ${goString(p.url)}, nil)`,
      );
    }
    lines.push('\tif err != nil { panic(err) }');
    for (const [key, value] of Object.entries(p.headers)) {
      lines.push(`\treq.Header.Set(${goString(key)}, ${goString(value)})`);
    }
    lines.push('');
    lines.push('\tresp, err := http.DefaultClient.Do(req)');
    lines.push('\tif err != nil { panic(err) }');
    lines.push('\tdefer resp.Body.Close()');
    lines.push('\tbodyBytes, _ := io.ReadAll(resp.Body)');
    lines.push('\tfmt.Println(resp.StatusCode, string(bodyBytes))');
    lines.push('}');
    return lines.join('\n');
  },
};

export const GENERATORS: Codegen[] = [
  curlGenerator,
  fetchGenerator,
  pythonGenerator,
  goGenerator,
];

export function generateCode(
  target: Codegen['target'],
  request: ScrapemanRequest,
  options: CodegenOptions,
): string {
  const gen = GENERATORS.find((g) => g.target === target);
  if (!gen) throw new Error(`Unknown codegen target: ${target}`);
  return gen.generate(request, options);
}
