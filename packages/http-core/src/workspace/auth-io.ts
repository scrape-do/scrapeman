/**
 * Shared helpers for reading and writing AuthConfig in YAML files.
 * Used by both CollectionFs and FolderSettingsFs.
 */
import type { AuthConfig } from '@scrapeman/shared-types';

function str(rec: Record<string, unknown>, key: string): string {
  return typeof rec[key] === 'string' ? (rec[key] as string) : '';
}

export function parseAuthConfig(
  raw: Record<string, unknown>,
): AuthConfig | undefined {
  const type = typeof raw['type'] === 'string' ? raw['type'] : '';
  switch (type) {
    case 'none':
      return { type: 'none' };
    case 'basic':
      return {
        type: 'basic',
        username: str(raw, 'username'),
        password: str(raw, 'password'),
      };
    case 'bearer':
      return { type: 'bearer', token: str(raw, 'token') };
    case 'apiKey': {
      const inVal = raw['in'] === 'query' ? 'query' : 'header';
      return {
        type: 'apiKey',
        key: str(raw, 'key'),
        value: str(raw, 'value'),
        in: inVal,
      };
    }
    case 'oauth2': {
      const flow: 'authorizationCode' | 'clientCredentials' =
        raw['flow'] === 'authorizationCode'
          ? 'authorizationCode'
          : 'clientCredentials';
      const base: Extract<AuthConfig, { type: 'oauth2' }> = {
        type: 'oauth2',
        flow,
        tokenUrl: str(raw, 'tokenUrl'),
        clientId: str(raw, 'clientId'),
        clientSecret: str(raw, 'clientSecret'),
        ...(raw['authUrl'] !== undefined
          ? { authUrl: str(raw, 'authUrl') }
          : {}),
        ...(raw['scope'] !== undefined ? { scope: str(raw, 'scope') } : {}),
        ...(raw['audience'] !== undefined
          ? { audience: str(raw, 'audience') }
          : {}),
        ...(raw['usePkce'] === true ? { usePkce: true as const } : {}),
      };
      return base;
    }
    case 'awsSigV4': {
      const base = {
        type: 'awsSigV4' as const,
        accessKeyId: str(raw, 'accessKeyId'),
        secretAccessKey: str(raw, 'secretAccessKey'),
        region: str(raw, 'region'),
        service: str(raw, 'service'),
      };
      return {
        ...base,
        ...(raw['sessionToken'] !== undefined
          ? { sessionToken: str(raw, 'sessionToken') }
          : {}),
      };
    }
    default:
      return undefined;
  }
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

/**
 * Serialize an AuthConfig to YAML lines without the top-level `auth:` key.
 * Callers indent as needed.
 */
export function serializeAuthConfig(auth: AuthConfig): string[] {
  const lines: string[] = [];
  lines.push(`type: ${auth.type}`);
  switch (auth.type) {
    case 'none':
      break;
    case 'basic':
      lines.push(`username: ${yamlString(auth.username)}`);
      lines.push(`password: ${yamlString(auth.password)}`);
      break;
    case 'bearer':
      lines.push(`token: ${yamlString(auth.token)}`);
      break;
    case 'apiKey':
      lines.push(`key: ${yamlString(auth.key)}`);
      lines.push(`value: ${yamlString(auth.value)}`);
      lines.push(`in: ${auth.in}`);
      break;
    case 'oauth2':
      lines.push(`flow: ${auth.flow}`);
      lines.push(`tokenUrl: ${yamlString(auth.tokenUrl)}`);
      lines.push(`clientId: ${yamlString(auth.clientId)}`);
      lines.push(`clientSecret: ${yamlString(auth.clientSecret)}`);
      if (auth.authUrl !== undefined) {
        lines.push(`authUrl: ${yamlString(auth.authUrl)}`);
      }
      if (auth.scope !== undefined) {
        lines.push(`scope: ${yamlString(auth.scope)}`);
      }
      if (auth.audience !== undefined) {
        lines.push(`audience: ${yamlString(auth.audience)}`);
      }
      if (auth.usePkce === true) {
        lines.push('usePkce: true');
      }
      break;
    case 'awsSigV4':
      lines.push(`accessKeyId: ${yamlString(auth.accessKeyId)}`);
      lines.push(`secretAccessKey: ${yamlString(auth.secretAccessKey)}`);
      lines.push(`region: ${yamlString(auth.region)}`);
      lines.push(`service: ${yamlString(auth.service)}`);
      if (auth.sessionToken !== undefined) {
        lines.push(`sessionToken: ${yamlString(auth.sessionToken)}`);
      }
      break;
  }
  return lines;
}
