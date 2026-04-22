import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { EnvironmentVariable } from '@scrapeman/shared-types';
import { FORMAT_VERSION } from '@scrapeman/shared-types';

const GLOBALS_FILE = '.scrapeman/globals.yaml';

export interface GlobalVariables {
  variables: EnvironmentVariable[];
}

function parseVariables(raw: Record<string, unknown>): EnvironmentVariable[] {
  if (!Array.isArray(raw['variables'])) return [];
  const out: EnvironmentVariable[] = [];
  for (const item of raw['variables']) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec['key'] === 'string' ? rec['key'] : '';
    const value = typeof rec['value'] === 'string' ? rec['value'] : '';
    const enabled = rec['enabled'] !== false;
    const secret = rec['secret'] === true;
    if (key) out.push({ key, value, enabled, secret });
  }
  return out;
}

async function atomicWrite(absPath: string, data: string): Promise<void> {
  const tmp = `${absPath}.tmp-${Math.random().toString(36).slice(2)}`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, absPath);
}

function yamlString(value: string): string {
  if (
    /^[A-Za-z_][A-Za-z0-9_./:\-+]*$/.test(value) &&
    !/^(true|false|null|yes|no|on|off)$/i.test(value)
  ) {
    return value;
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

export class GlobalsFs {
  constructor(private readonly root: string) {}

  async read(): Promise<GlobalVariables> {
    const path = join(this.root, GLOBALS_FILE);
    let text: string;
    try {
      text = await fsp.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { variables: [] };
      }
      throw err;
    }
    let raw: unknown;
    try {
      raw = parseYaml(text);
    } catch {
      return { variables: [] };
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { variables: [] };
    }
    return { variables: parseVariables(raw as Record<string, unknown>) };
  }

  async write(globals: GlobalVariables): Promise<void> {
    const dir = join(this.root, '.scrapeman');
    await fsp.mkdir(dir, { recursive: true });
    const path = join(this.root, GLOBALS_FILE);
    const lines: string[] = [];
    lines.push(`scrapeman: "${FORMAT_VERSION}"`);
    if (globals.variables.length === 0) {
      lines.push('variables: []');
    } else {
      lines.push('variables:');
      for (const v of globals.variables) {
        lines.push(`  - key: ${yamlString(v.key)}`);
        lines.push(`    value: ${yamlString(v.value)}`);
        lines.push(`    enabled: ${v.enabled}`);
        if (v.secret) lines.push('    secret: true');
      }
    }
    await atomicWrite(path, lines.join('\n') + '\n');
  }

  /** Resolve enabled global variables to a flat key→value map. */
  async resolveVariables(): Promise<Record<string, string>> {
    const globals = await this.read();
    const out: Record<string, string> = {};
    for (const v of globals.variables) {
      if (v.enabled) out[v.key] = v.value;
    }
    return out;
  }

  async resolveSecretKeys(): Promise<Set<string>> {
    const globals = await this.read();
    const keys = new Set<string>();
    for (const v of globals.variables) {
      if (v.enabled && v.secret) keys.add(v.key);
    }
    return keys;
  }
}
