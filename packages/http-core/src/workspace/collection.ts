import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AuthConfig, CollectionSettings, EnvironmentVariable } from '@scrapeman/shared-types';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
import { parseAuthConfig, serializeAuthConfig } from './auth-io.js';

const COLLECTION_FILE = '.scrapeman/collection.yaml';

// Re-export so callers that import from this module still get the type.
export type { CollectionSettings };

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

function parseLoadTest(
  rec: Record<string, unknown>,
): CollectionSettings['loadTest'] | undefined {
  const lt = rec['loadTest'];
  if (typeof lt !== 'object' || lt === null) return undefined;
  const obj = lt as Record<string, unknown>;
  const watchedHeaders: string[] = [];
  if (Array.isArray(obj['watchedHeaders'])) {
    for (const item of obj['watchedHeaders']) {
      if (typeof item === 'string' && item.trim()) {
        watchedHeaders.push(item.trim());
      }
    }
  }
  const autoTrack =
    typeof obj['autoTrackScrapeDoHeaders'] === 'boolean'
      ? obj['autoTrackScrapeDoHeaders']
      : undefined;
  return {
    ...(watchedHeaders.length > 0 ? { watchedHeaders } : {}),
    ...(autoTrack !== undefined ? { autoTrackScrapeDoHeaders: autoTrack } : {}),
  };
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

export class CollectionFs {
  constructor(private readonly root: string) {}

  async read(): Promise<CollectionSettings> {
    const path = join(this.root, COLLECTION_FILE);
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
    const rec = raw as Record<string, unknown>;
    const variables = parseVariables(rec);
    const auth =
      typeof rec['auth'] === 'object' && rec['auth'] !== null
        ? parseAuthConfig(rec['auth'] as Record<string, unknown>)
        : undefined;
    const loadTest = parseLoadTest(rec);
    return {
      variables,
      ...(auth !== undefined ? { auth } : {}),
      ...(loadTest !== undefined ? { loadTest } : {}),
    };
  }

  async write(settings: CollectionSettings): Promise<void> {
    const dir = join(this.root, '.scrapeman');
    await fsp.mkdir(dir, { recursive: true });
    const path = join(this.root, COLLECTION_FILE);
    const lines: string[] = [];
    lines.push(`scrapeman: "${FORMAT_VERSION}"`);
    if (settings.variables.length === 0) {
      lines.push('variables: []');
    } else {
      lines.push('variables:');
      for (const v of settings.variables) {
        lines.push(`  - key: ${yamlString(v.key)}`);
        lines.push(`    value: ${yamlString(v.value)}`);
        lines.push(`    enabled: ${v.enabled}`);
        if (v.secret) lines.push('    secret: true');
      }
    }
    if (settings.auth && settings.auth.type !== 'none') {
      const authLines = serializeAuthConfig(settings.auth);
      lines.push('auth:');
      for (const l of authLines) {
        lines.push(`  ${l}`);
      }
    }
    if (settings.loadTest) {
      lines.push('loadTest:');
      const wh = settings.loadTest.watchedHeaders;
      if (wh && wh.length > 0) {
        lines.push('  watchedHeaders:');
        for (const h of wh) {
          lines.push(`    - ${yamlString(h)}`);
        }
      } else {
        lines.push('  watchedHeaders: []');
      }
      const autoTrack = settings.loadTest.autoTrackScrapeDoHeaders;
      if (autoTrack !== undefined) {
        lines.push(`  autoTrackScrapeDoHeaders: ${autoTrack}`);
      }
    }
    await atomicWrite(path, lines.join('\n') + '\n');
  }

  async resolveVariables(): Promise<Record<string, string>> {
    const settings = await this.read();
    const out: Record<string, string> = {};
    for (const v of settings.variables) {
      if (v.enabled) out[v.key] = v.value;
    }
    return out;
  }

  async resolveSecretKeys(): Promise<Set<string>> {
    const settings = await this.read();
    const keys = new Set<string>();
    for (const v of settings.variables) {
      if (v.enabled && v.secret) keys.add(v.key);
    }
    return keys;
  }
}
