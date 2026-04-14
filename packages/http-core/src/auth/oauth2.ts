import { request as undiciRequest } from 'undici';
import { ExecutorError } from '../errors.js';

export interface OAuth2ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
}

interface CacheKey {
  tokenUrl: string;
  clientId: string;
  scope: string;
  audience: string;
}

/**
 * OAuth2 client credentials flow. Fetches a bearer token from the token
 * endpoint and caches it per (tokenUrl, clientId, scope, audience). Returns
 * the same token until 30 seconds before expiry.
 */
export class OAuth2Client {
  private readonly cache = new Map<string, TokenResponse>();

  async getToken(config: OAuth2ClientCredentialsConfig): Promise<TokenResponse> {
    const key = this.cacheKey(config);
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt - 30_000 > now) {
      return cached;
    }
    const fresh = await this.fetchToken(config);
    this.cache.set(key, fresh);
    return fresh;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async fetchToken(
    config: OAuth2ClientCredentialsConfig,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret);
    if (config.scope) body.set('scope', config.scope);
    if (config.audience) body.set('audience', config.audience);

    try {
      const result = await undiciRequest(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      const text = await readAll(result.body);
      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new ExecutorError(
          'protocol',
          `OAuth2 token endpoint returned ${result.statusCode}: ${text}`,
        );
      }

      const parsed = JSON.parse(text) as Record<string, unknown>;
      const accessToken = parsed['access_token'];
      if (typeof accessToken !== 'string') {
        throw new ExecutorError(
          'protocol',
          'OAuth2 token response missing access_token',
        );
      }
      const expiresIn =
        typeof parsed['expires_in'] === 'number' ? parsed['expires_in'] : 3600;
      const tokenType =
        typeof parsed['token_type'] === 'string' ? parsed['token_type'] : 'Bearer';
      return {
        accessToken,
        tokenType,
        expiresAt: Date.now() + expiresIn * 1000,
        ...(typeof parsed['scope'] === 'string' ? { scope: parsed['scope'] } : {}),
      };
    } catch (err) {
      if (err instanceof ExecutorError) throw err;
      throw new ExecutorError(
        'network',
        `OAuth2 token fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  private cacheKey(config: OAuth2ClientCredentialsConfig): string {
    const key: CacheKey = {
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      scope: config.scope ?? '',
      audience: config.audience ?? '',
    };
    return JSON.stringify(key);
  }
}

async function readAll(
  stream: AsyncIterable<Buffer | Uint8Array>,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
