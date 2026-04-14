import type { AuthConfig, ScrapemanRequest } from '@scrapeman/shared-types';

/**
 * Applies auth config onto a request by injecting the Authorization header,
 * API key header, or query parameter. Returns a new request — never mutates.
 *
 * OAuth2 / AWS SigV4 flows are handled by their own helpers (M4.T042, T044)
 * and then go through this function as bearer/awsSigV4 once token or
 * signature is resolved.
 */
export function applyAuth(request: ScrapemanRequest): ScrapemanRequest {
  const auth = request.auth;
  if (!auth || auth.type === 'none') return request;

  const headers = { ...(request.headers ?? {}) };
  const params = { ...(request.params ?? {}) };
  let url = request.url;

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
        url = appendQuery(url, auth.key, auth.value);
      } else {
        headers[auth.key] = auth.value;
      }
      break;
    }
    case 'oauth2':
      // Token acquisition handled upstream in the OAuth2 flow — by the time
      // we reach this function for execution, the bearer token should have
      // been swapped in already. If not, leave the request unchanged.
      break;
    case 'awsSigV4':
      // Signing handled upstream (M4.T044). Left as a no-op here so the
      // unsigned auth block does not break execution for unconfigured
      // requests.
      break;
  }

  const out: ScrapemanRequest = { ...request, url };
  if (Object.keys(headers).length > 0) out.headers = headers;
  if (Object.keys(params).length > 0) out.params = params;
  return out;
}

function appendQuery(url: string, key: string, value: string): string {
  // For query-style API key we only update request.params, not the URL
  // string — undici handles params from url internally via URL(). But if the
  // caller derived url from the URL bar already containing params, we keep
  // the url string untouched and trust the executor to combine params.
  return url;
}

export function needsTokenAcquisition(auth: AuthConfig): boolean {
  return auth.type === 'oauth2';
}
