import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AuthConfig, EnvironmentVariable } from '@scrapeman/shared-types';
import { FORMAT_VERSION } from '@scrapeman/shared-types';
import { parseAuthConfig, serializeAuthConfig } from './auth-io.js';

// Each folder can carry a `_folder.yaml` file with variables and optional auth.
export const FOLDER_SETTINGS_FILE = '_folder.yaml';

export interface FolderSettings {
  variables: EnvironmentVariable[];
  /** Auth that applies to all requests in this folder unless overridden. */
  auth?: AuthConfig;
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

export class FolderSettingsFs {
  constructor(private readonly workspaceRoot: string) {}

  private absPath(folderRelPath: string): string {
    // folderRelPath is relative to workspace root (e.g. "users" or "api/users").
    // An empty string means the workspace root itself (same level as collection).
    if (folderRelPath === '') {
      return join(this.workspaceRoot, FOLDER_SETTINGS_FILE);
    }
    return join(this.workspaceRoot, folderRelPath, FOLDER_SETTINGS_FILE);
  }

  async read(folderRelPath: string): Promise<FolderSettings> {
    const path = this.absPath(folderRelPath);
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
    return { variables, ...(auth !== undefined ? { auth } : {}) };
  }

  async write(folderRelPath: string, settings: FolderSettings): Promise<void> {
    // Ensure the folder exists before writing the settings file.
    const dir =
      folderRelPath === ''
        ? this.workspaceRoot
        : join(this.workspaceRoot, folderRelPath);
    await fsp.mkdir(dir, { recursive: true });
    const path = this.absPath(folderRelPath);
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
    await atomicWrite(path, lines.join('\n') + '\n');
  }

  async resolveVariables(folderRelPath: string): Promise<Record<string, string>> {
    const settings = await this.read(folderRelPath);
    const out: Record<string, string> = {};
    for (const v of settings.variables) {
      if (v.enabled) out[v.key] = v.value;
    }
    return out;
  }
}
