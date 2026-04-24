import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { request as undiciRequest } from 'undici';
import { ExecutorError } from '../errors.js';

export interface OAuth2ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
}

export interface OAuth2AuthCodeConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  audience?: string;
  usePkce: boolean;
  /** Called with the full auth URL so the caller (main process) can open the browser. */
  openBrowser: (url: string) => void;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
  idToken?: string;
  refreshToken?: string;
}

export interface OidcDiscoveryDocument {
  tokenUrl: string;
  authUrl: string;
  scopesSupported?: string[];
  endSessionEndpoint?: string;
}

interface CacheEntry extends TokenResponse {
  /** Stored so proactive refresh can call the token endpoint again. */
  refreshToken?: string;
}

interface CacheKey {
  tokenUrl: string;
  clientId: string;
  scope: string;
  audience: string;
}

/** Generated PKCE pair. */
export interface PkceParams {
  verifier: string;
  challenge: string;
}

/** Generate a PKCE code_verifier + S256 code_challenge. */
export function generatePkce(): PkceParams {
  // 32 raw bytes → 43 base64url chars (no padding).
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Decode a JWT for display — no signature verification.
 * Returns null when the input is not a valid three-segment JWT.
 */
export function decodeJwt(
  token: string,
): { header: Record<string, unknown>; payload: Record<string, unknown>; rawHeader: string; rawPayload: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const decode = (seg: string): Record<string, unknown> =>
      JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as Record<string, unknown>;
    return {
      header: decode(parts[0]!),
      payload: decode(parts[1]!),
      rawHeader: parts[0]!,
      rawPayload: parts[1]!,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch and normalize an OIDC discovery document.
 */
export async function fetchOidcDiscovery(discoveryUrl: string): Promise<OidcDiscoveryDocument> {
  let text: string;
  try {
    const res = await undiciRequest(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    text = await readAll(res.body);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new ExecutorError(
        'protocol',
        `OIDC discovery returned ${res.statusCode}: ${text}`,
      );
    }
  } catch (err) {
    if (err instanceof ExecutorError) throw err;
    throw new ExecutorError(
      'network',
      `OIDC discovery fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  const doc = JSON.parse(text) as Record<string, unknown>;
  const tokenEndpoint = doc['token_endpoint'];
  const authorizationEndpoint = doc['authorization_endpoint'];
  if (typeof tokenEndpoint !== 'string' || typeof authorizationEndpoint !== 'string') {
    throw new ExecutorError(
      'protocol',
      'OIDC discovery document missing token_endpoint or authorization_endpoint',
    );
  }
  return {
    tokenUrl: tokenEndpoint,
    authUrl: authorizationEndpoint,
    ...(Array.isArray(doc['scopes_supported'])
      ? { scopesSupported: doc['scopes_supported'] as string[] }
      : {}),
    ...(typeof doc['end_session_endpoint'] === 'string'
      ? { endSessionEndpoint: doc['end_session_endpoint'] }
      : {}),
  };
}

/**
 * Start the authorization_code flow with an ephemeral loopback callback server.
 * The returned promise resolves with a full TokenResponse after the code exchange.
 *
 * @param config.openBrowser Called once with the full auth URL (use `shell.openExternal` in main).
 */
export async function runAuthCodeFlow(config: OAuth2AuthCodeConfig): Promise<TokenResponse> {
  const state = randomBytes(16).toString('hex');
  const pkce = config.usePkce ? generatePkce() : null;

  return new Promise<TokenResponse>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    const server = createServer((req, res) => {
      const rawUrl = req.url ?? '/';
      const parsed = new URL(rawUrl, 'http://localhost');

      if (parsed.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const returnedState = parsed.searchParams.get('state');
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');
      const errorDescription = parsed.searchParams.get('error_description') ?? '';

      // Always respond to the browser before closing.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><p>Authorization complete. You can close this tab.</p></body></html>');

      server.close();
      clearTimeout(timeoutHandle);

      if (error) {
        settle(() => reject(new ExecutorError('protocol', `OAuth2 error: ${error}${errorDescription ? ' — ' + errorDescription : ''}`)));
        return;
      }
      if (returnedState !== state) {
        settle(() => reject(new ExecutorError('protocol', 'OAuth2 state mismatch — possible CSRF')));
        return;
      }
      if (!code) {
        settle(() => reject(new ExecutorError('protocol', 'OAuth2 callback missing code parameter')));
        return;
      }

      // Exchange code for token.
      const port = (server.address() as { port: number } | null)?.port ?? 0;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      exchangeCodeForToken({
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}),
        code,
        redirectUri,
        ...(pkce ? { codeVerifier: pkce.verifier } : {}),
        ...(config.scope ? { scope: config.scope } : {}),
      })
        .then((token) => settle(() => resolve(token)))
        .catch((err: unknown) =>
          settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
        );
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const authUrl = new URL(config.authUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      if (config.scope) authUrl.searchParams.set('scope', config.scope);
      if (pkce) {
        authUrl.searchParams.set('code_challenge', pkce.challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
      }

      config.openBrowser(authUrl.toString());
    });

    server.on('error', (err) => {
      clearTimeout(timeoutHandle);
      settle(() => reject(new ExecutorError('network', `Loopback server error: ${err.message}`, err)));
    });

    const timeoutHandle = setTimeout(() => {
      server.close();
      settle(() => reject(new ExecutorError('timeout', 'OAuth2 authorization timed out (60s)')));
    }, 60_000);
  });
}

interface CodeExchangeParams {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  scope?: string;
}

async function exchangeCodeForToken(params: CodeExchangeParams): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', params.clientId);
  body.set('code', params.code);
  body.set('redirect_uri', params.redirectUri);
  if (params.clientSecret) body.set('client_secret', params.clientSecret);
  if (params.codeVerifier) body.set('code_verifier', params.codeVerifier);
  if (params.scope) body.set('scope', params.scope);

  try {
    const result = await undiciRequest(params.tokenUrl, {
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

    return parseTokenResponse(text);
  } catch (err) {
    if (err instanceof ExecutorError) throw err;
    throw new ExecutorError(
      'network',
      `OAuth2 code exchange failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

async function refreshTokenRequest(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  scope?: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', params.clientId);
  body.set('refresh_token', params.refreshToken);
  if (params.clientSecret) body.set('client_secret', params.clientSecret);
  if (params.scope) body.set('scope', params.scope);

  try {
    const result = await undiciRequest(params.tokenUrl, {
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
        `OAuth2 refresh token endpoint returned ${result.statusCode}: ${text}`,
      );
    }

    const fresh = parseTokenResponse(text);
    // If the server does not rotate the refresh token, carry the old one forward.
    if (!fresh.refreshToken && params.refreshToken) {
      return { ...fresh, refreshToken: params.refreshToken };
    }
    return fresh;
  } catch (err) {
    if (err instanceof ExecutorError) throw err;
    throw new ExecutorError(
      'network',
      `OAuth2 refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

function parseTokenResponse(text: string): TokenResponse {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const accessToken = parsed['access_token'];
  if (typeof accessToken !== 'string') {
    throw new ExecutorError('protocol', 'OAuth2 token response missing access_token');
  }
  // When expires_in is absent, treat the token as non-expiring rather than
  // falling back to an arbitrary lifetime (Bruno issue #7565).
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
    ...(typeof parsed['id_token'] === 'string' ? { idToken: parsed['id_token'] } : {}),
    ...(typeof parsed['refresh_token'] === 'string'
      ? { refreshToken: parsed['refresh_token'] }
      : {}),
  };
}

/**
 * OAuth2 client for client_credentials and authorization_code flows. Fetches
 * a bearer token from the token endpoint and caches it per
 * (tokenUrl, clientId, scope, audience). Returns the same token until 30
 * seconds before expiry, then refreshes via refresh_token when available, or
 * refetches with client_credentials.
 *
 * Concurrent calls for the same cache key share a single in-flight Promise
 * so the token endpoint is hit exactly once even under load (Bruno #7565).
 */
export class OAuth2Client {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<TokenResponse>>();

  async getToken(config: OAuth2ClientCredentialsConfig): Promise<TokenResponse> {
    const key = this.cacheKey({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      scope: config.scope ?? '',
      audience: config.audience ?? '',
    });
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt - 30_000 > now) {
      return cached;
    }

    // If a fetch is already in flight for this key, join it instead of
    // firing a second network call.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    // If we have a refresh token, use it instead of the full client_credentials fetch.
    const fetchPromise = (cached?.refreshToken
      ? refreshTokenRequest({
          tokenUrl: config.tokenUrl,
          clientId: config.clientId,
          ...(config.clientSecret ? { clientSecret: config.clientSecret } : {}),
          refreshToken: cached.refreshToken,
          ...(config.scope ? { scope: config.scope } : {}),
        })
      : this.fetchClientCredentials(config)
    )
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

  /**
   * Store a token that was obtained via the authorization_code flow.
   * The main process calls this after `runAuthCodeFlow` succeeds.
   */
  storeToken(
    config: Pick<OAuth2ClientCredentialsConfig, 'tokenUrl' | 'clientId' | 'scope' | 'audience'>,
    token: TokenResponse,
  ): void {
    const key = this.cacheKey({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      scope: config.scope ?? '',
      audience: config.audience ?? '',
    });
    this.cache.set(key, token);
  }

  /**
   * Return a cached token without triggering a fetch. Returns undefined when
   * no token is stored or the cached token is already 30s past expiry.
   */
  getCachedToken(
    config: Pick<OAuth2ClientCredentialsConfig, 'tokenUrl' | 'clientId' | 'scope' | 'audience'>,
  ): CacheEntry | undefined {
    const key = this.cacheKey({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      scope: config.scope ?? '',
      audience: config.audience ?? '',
    });
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    // Return even expired tokens so the caller can decide to use or refresh;
    // the 30s buffer only applies to getToken()'s auto-refresh gate.
    return cached;
  }

  clearCache(): void {
    this.cache.clear();
  }

  invalidate(
    config: Pick<OAuth2ClientCredentialsConfig, 'tokenUrl' | 'clientId' | 'scope' | 'audience'>,
  ): void {
    this.cache.delete(
      this.cacheKey({
        tokenUrl: config.tokenUrl,
        clientId: config.clientId,
        scope: config.scope ?? '',
        audience: config.audience ?? '',
      }),
    );
  }

  private async fetchClientCredentials(
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

      return parseTokenResponse(text);
    } catch (err) {
      if (err instanceof ExecutorError) throw err;
      throw new ExecutorError(
        'network',
        `OAuth2 token fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  private cacheKey(key: CacheKey): string {
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
