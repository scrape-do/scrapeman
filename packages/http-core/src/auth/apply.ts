import type {
  AuthConfig,
  BodyConfig,
  OAuth2TokenPlacement,
  ScrapemanRequest,
} from '@scrapeman/shared-types';
import { signAwsSigV4 } from './sigv4.js';
import { OAuth2Client } from './oauth2.js';

export interface ApplyAuthOptions {
  /**
   * OAuth2 client used for the client_credentials flow. When omitted a
   * process-wide default instance is used so callers that don't care about
   * sharing a cache don't need to thread a client through.
   */
  oauth2Client?: OAuth2Client;
}

// Process-wide default OAuth2 client. Callers that need to share a cache
// across code paths (main process, load runner) can pass their own via
// ApplyAuthOptions.
const defaultOAuth2Client = new OAuth2Client();

/**
 * Applies auth config onto a request by injecting the Authorization header,
 * API key header/query param, AWS SigV4 signature headers, or fetching an
 * OAuth2 bearer token. Returns a new request — never mutates.
 */
export async function applyAuth(
  request: ScrapemanRequest,
  options: ApplyAuthOptions = {},
): Promise<ScrapemanRequest> {
  const auth = request.auth;
  if (!auth || auth.type === 'none') return request;

  const headers = { ...(request.headers ?? {}) };
  const params = { ...(request.params ?? {}) };
  const url = request.url;
  let body: BodyConfig | undefined = request.body;

  switch (auth.type) {
    case 'basic': {
      const token = Buffer.from(
        `${auth.username}:${auth.password}`,
        'utf8',
      ).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
      break;
    }
    case 'bearer': {
      headers['Authorization'] = `Bearer ${auth.token}`;
      break;
    }
    case 'apiKey': {
      if (auth.in === 'query') {
        params[auth.key] = auth.value;
      } else {
        headers[auth.key] = auth.value;
      }
      break;
    }
    case 'oauth2': {
      // authorizationCode / authorizationCodePkce flows are handled upstream
      // by an interactive flow (IPC channel oauth2:startAuthCodeFlow). Tokens
      // are stored in the OAuth2Client cache via storeToken(). We read from
      // that cache here via getCachedToken() so requests go out with a token
      // automatically once the user has authorised at least once.
      if (auth.flow === 'clientCredentials') {
        const client = options.oauth2Client ?? defaultOAuth2Client;
        const token = await client.getToken({
          tokenUrl: auth.tokenUrl,
          clientId: auth.clientId,
          clientSecret: auth.clientSecret,
          ...(auth.scope ? { scope: auth.scope } : {}),
          ...(auth.audience ? { audience: auth.audience } : {}),
        });
        body = applyTokenPlacement(
          token.accessToken,
          token.tokenType,
          auth.accessTokenPlacement,
          headers,
          params,
          request,
        );
      } else {
        const client = options.oauth2Client ?? defaultOAuth2Client;
        const cached = client.getCachedToken({
          tokenUrl: auth.tokenUrl,
          clientId: auth.clientId,
          ...(auth.scope ? { scope: auth.scope } : {}),
          ...(auth.audience ? { audience: auth.audience } : {}),
        });
        if (cached) {
          body = applyTokenPlacement(
            cached.accessToken,
            cached.tokenType,
            auth.accessTokenPlacement,
            headers,
            params,
            request,
          );
        }
        // No cached token: request goes out without auth. User must "Get token" first.
      }
      break;
    }
    case 'awsSigV4': {
      // SigV4 signs the full request (method, path, headers, body) so we
      // delegate to the signer and merge its headers back in. Signer
      // returns a new request — we only pick up its headers to keep the
      // rest of the pipeline (params, url, body) untouched here.
      const signed = signAwsSigV4(request, {
        accessKeyId: auth.accessKeyId,
        secretAccessKey: auth.secretAccessKey,
        ...(auth.sessionToken ? { sessionToken: auth.sessionToken } : {}),
        region: auth.region,
        service: auth.service,
      });
      Object.assign(headers, signed.headers);
      break;
    }
  }

  const out: ScrapemanRequest = { ...request, url };
  if (Object.keys(headers).length > 0) out.headers = headers;
  if (Object.keys(params).length > 0) out.params = params;
  if (body !== request.body && body !== undefined) out.body = body;
  return out;
}

/**
 * Apply the OAuth2 access token to headers/params per the placement config.
 * Returns a new BodyConfig when `in: 'body'` placement is used and the body
 * needs updating, otherwise returns the original body unchanged.
 * Never mutates the incoming request or its body.
 */
function applyTokenPlacement(
  accessToken: string,
  tokenType: string,
  placement: OAuth2TokenPlacement | undefined,
  headers: Record<string, string>,
  params: Record<string, string>,
  request: ScrapemanRequest,
): BodyConfig | undefined {
  if (!placement || placement.in === 'header') {
    const headerName =
      placement?.in === 'header' && placement.name ? placement.name : 'Authorization';
    const prefix =
      placement?.in === 'header' && placement.prefix !== undefined
        ? placement.prefix
        : tokenType;
    headers[headerName] = prefix ? `${prefix} ${accessToken}` : accessToken;
    return request.body;
  }

  if (placement.in === 'query') {
    params[placement.name] = accessToken;
    return request.body;
  }

  // placement.in === 'body'
  const method = request.method.toUpperCase();
  const allowsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  if (allowsBody && request.body?.type === 'formUrlEncoded') {
    // Build a new body object with the token added — never mutate.
    return {
      type: 'formUrlEncoded',
      fields: { ...request.body.fields, [placement.name]: accessToken },
    };
  }
  // Fall back to Authorization header.
  headers['Authorization'] = `${tokenType} ${accessToken}`;
  return request.body;
}

export function needsTokenAcquisition(auth: AuthConfig): boolean {
  return auth.type === 'oauth2';
}
