import type { AuthConfig, ScrapemanRequest } from '@scrapeman/shared-types';
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
      // Only client_credentials is wired here. authorizationCode (T043) must
      // be handled upstream by an interactive flow and then re-enter this
      // function as bearer.
      if (auth.flow !== 'clientCredentials') {
        break;
      }
      const client = options.oauth2Client ?? defaultOAuth2Client;
      const token = await client.getToken({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        ...(auth.scope ? { scope: auth.scope } : {}),
        ...(auth.audience ? { audience: auth.audience } : {}),
      });
      headers['Authorization'] = `Bearer ${token.accessToken}`;
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
  return out;
}

export function needsTokenAcquisition(auth: AuthConfig): boolean {
  return auth.type === 'oauth2';
}
