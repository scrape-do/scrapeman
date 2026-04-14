import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  Environment,
  EnvironmentVariable,
  WorkspaceState,
} from '@scrapeman/shared-types';
import { FORMAT_VERSION } from '@scrapeman/shared-types';

const ENV_DIR = '.scrapeman/environments';
const STATE_FILE = '.scrapeman/state.json';
const ENV_EXT = '.env.yaml';

export class EnvironmentsFs {
  constructor(private readonly root: string) {}

  async listEnvironments(): Promise<Environment[]> {
    const dir = join(this.root, ENV_DIR);
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const envs: Environment[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(ENV_EXT)) continue;
      const name = entry.slice(0, -ENV_EXT.length);
      const env = await this.readEnvironment(name);
      if (env) envs.push(env);
    }
    envs.sort((a, b) => a.name.localeCompare(b.name));
    return envs;
  }

  async readEnvironment(name: string): Promise<Environment | null> {
    const path = join(this.root, ENV_DIR, `${name}${ENV_EXT}`);
    let text: string;
    try {
      text = await fsp.readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    let raw: unknown;
    try {
      raw = parseYaml(text);
    } catch {
      return null;
    }
    if (!isObject(raw)) return null;
    const variables: EnvironmentVariable[] = [];
    if (Array.isArray(raw['variables'])) {
      for (const item of raw['variables']) {
        if (!isObject(item)) continue;
        const key = typeof item['key'] === 'string' ? item['key'] : '';
        const value = typeof item['value'] === 'string' ? item['value'] : '';
        const enabled = item['enabled'] !== false;
        const secret = item['secret'] === true;
        if (key) variables.push({ key, value, enabled, secret });
      }
    }
    return {
      name,
      variables,
    };
  }

  async writeEnvironment(env: Environment): Promise<void> {
    const dir = join(this.root, ENV_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const path = join(dir, `${env.name}${ENV_EXT}`);
    const lines: string[] = [];
    lines.push(`scrapeman: "${FORMAT_VERSION}"`);
    lines.push(`name: ${yamlString(env.name)}`);
    if (env.variables.length === 0) {
      lines.push('variables: []');
    } else {
      lines.push('variables:');
      for (const variable of env.variables) {
        lines.push(`  - key: ${yamlString(variable.key)}`);
        lines.push(`    value: ${yamlString(variable.value)}`);
        lines.push(`    enabled: ${variable.enabled}`);
        if (variable.secret) lines.push(`    secret: true`);
      }
    }
    await atomicWrite(path, lines.join('\n') + '\n');
  }

  async deleteEnvironment(name: string): Promise<void> {
    const path = join(this.root, ENV_DIR, `${name}${ENV_EXT}`);
    try {
      await fsp.rm(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async readState(): Promise<WorkspaceState> {
    const path = join(this.root, STATE_FILE);
    try {
      const text = await fsp.readFile(path, 'utf8');
      const raw = JSON.parse(text);
      if (isObject(raw)) {
        return {
          activeEnvironment:
            typeof raw['activeEnvironment'] === 'string'
              ? raw['activeEnvironment']
              : null,
        };
      }
    } catch {
      /* fall through */
    }
    return { activeEnvironment: null };
  }

  async writeState(state: WorkspaceState): Promise<void> {
    const dir = join(this.root, '.scrapeman');
    await fsp.mkdir(dir, { recursive: true });
    const path = join(this.root, STATE_FILE);
    await atomicWrite(path, JSON.stringify(state, null, 2));
  }

  async resolveVariables(
    activeEnv: string | null,
  ): Promise<Record<string, string>> {
    if (!activeEnv) return {};
    const env = await this.readEnvironment(activeEnv);
    if (!env) return {};
    const out: Record<string, string> = {};
    for (const variable of env.variables) {
      if (variable.enabled) out[variable.key] = variable.value;
    }
    return out;
  }
}

async function atomicWrite(absPath: string, data: string): Promise<void> {
  const tmp = `${absPath}.tmp-${Math.random().toString(36).slice(2)}`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, absPath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yamlString(value: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_./:\-+]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)) {
    return value;
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}
