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
 *
 * Concurrent calls for the same cache key share a single in-flight Promise
 * so the token endpoint is hit exactly once even under load.
 */
export class OAuth2Client {
  private readonly cache = new Map<string, TokenResponse>();
  private readonly inFlight = new Map<string, Promise<TokenResponse>>();

  async getToken(config: OAuth2ClientCredentialsConfig): Promise<TokenResponse> {
    const key = this.cacheKey(config);
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt - 30_000 > now) {
      return cached;
    }
    // If a fetch is already in flight for this key, join it instead of
    // firing a second network call.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const fetchPromise = this.fetchToken(config)
      .then((fresh) => {
        this.cache.set(key, fresh);
        return fresh;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, fetchPromise);
    return fetchPromise;
  }

  clearCache(): void {
    this.cache.clear();
  }

  invalidate(config: OAuth2ClientCredentialsConfig): void {
    this.cache.delete(this.cacheKey(config));
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
      // When expires_in is absent, treat the token as non-expiring rather
      // than falling back to an arbitrary 1h lifetime (Bruno issue #7565).
      const expiresAt =
        typeof parsed['expires_in'] === 'number'
          ? Date.now() + parsed['expires_in'] * 1000
          : Number.MAX_SAFE_INTEGER;
      const tokenType =
        typeof parsed['token_type'] === 'string' ? parsed['token_type'] : 'Bearer';
      return {
        accessToken,
        tokenType,
        expiresAt,
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
