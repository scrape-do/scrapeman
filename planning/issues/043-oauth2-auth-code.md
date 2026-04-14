# Issue 043 — OAuth2 authorization code flow with PKCE

## Background

Authorization code flow requires a browser redirect and a local callback server. Bruno does not implement PKCE (usebruno/bruno#7565 covers the broader OAuth2 weakness). Scrapeman implements the full flow with PKCE (S256) as default.

This task shares the token cache with T042 (client credentials) — same `OAuth2Client` module, different fetch path.

## Acceptance criteria

- Generate PKCE `code_verifier` (random 43-128 char, base64url) and `code_challenge` (SHA-256 hash, base64url)
- Open system browser to auth URL with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `code_challenge`, `code_challenge_method=S256`
- Spin up short-lived local HTTP server on a random port to receive callback
- Callback URL format: `http://localhost:<port>/callback?code=<code>&state=<state>`
- Exchange `code` for token: POST to token URL with `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, `client_id`, (optional) `client_secret`
- Callback server closes after: receiving code OR 60s timeout (whichever first)
- State parameter validated to prevent CSRF
- Token stored in the same `OAuth2Client` cache as client credentials (keyed by `tokenUrl + clientId + scope`)
- Token refresh and 401 retry behavior identical to T042

## UI fields

| Field | Notes |
|-------|-------|
| Flow | `authorizationCode` |
| Auth URL | Authorization endpoint, supports `{{vars}}` |
| Token URL | Token endpoint, supports `{{vars}}` |
| Client ID | Supports `{{vars}}` |
| Client Secret | Optional for PKCE flows, masked, supports `{{vars}}` |
| Redirect URI | Auto-set to `http://localhost:<port>/callback`; shown read-only |
| Scope | Space-separated, optional |
| PKCE | Toggle, on by default |

A "Authorize" button triggers the flow. UI shows: `Pending authorization…` while waiting, then `Authorized — expires in Xm` after success.

## Technical design

### PKCE generation
```typescript
import { randomBytes, createHash } from 'node:crypto';

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
```

### Callback server
```typescript
import { createServer } from 'node:http';
import { shell } from 'electron';

async function runAuthCodeFlow(config: OAuth2AuthCodeConfig): Promise<string> {
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      if (url.pathname !== '/callback') { res.end(); return; }

      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.end('<html><body>You can close this tab.</body></html>');
      server.close();
      clearTimeout(timeout);

      if (error) return reject(new Error(`OAuth2 error: ${error}`));
      if (returnedState !== state) return reject(new Error('State mismatch'));
      if (!code) return reject(new Error('No code in callback'));

      resolve(code);
    });

    server.listen(0, '127.0.0.1', async () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://localhost:${port}/callback`;

      const authUrl = new URL(config.authUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', config.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('state', state);
      if (config.scope) authUrl.searchParams.set('scope', config.scope);
      if (config.pkce) {
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
      }

      shell.openExternal(authUrl.toString());
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth2 authorization timed out (60s)'));
    }, 60_000);
  });
}
```

### IPC surface
The auth code flow must run in the main process (Node.js + `electron.shell`). Renderer triggers via `auth:oauth2:authorize` IPC channel. Result returned as `{ accessToken, expiresAt }` or error.

```typescript
// preload exposes:
authorizeOAuth2: () => Promise<{ accessToken: string; expiresAt: number }>
```

## Test scenarios

| Scenario | Setup | Expected |
|----------|-------|----------|
| PKCE generation | — | `verifier` is 43 chars, `challenge` = base64url(sha256(verifier)) |
| State validation | Mutate returned state | Flow rejects with "State mismatch" |
| Timeout | Server receives no callback in 60s | Rejects with timeout error |
| Code exchange | Mock token endpoint | Token cached, `Authorization: Bearer` on next send |
| Token reuse | Second request after auth | Token endpoint NOT called again (uses cache) |
| No client_secret | PKCE-only flow | Exchange succeeds without `client_secret` in body |

> Note: Full browser flow is not testable in CI. Test the PKCE math, state validation, timeout, and token exchange by mocking `shell.openExternal` and directly hitting the callback URL with a test HTTP request.

## Files to touch

- `packages/http-core/src/auth/oauth2.ts` — add `runAuthCodeFlow()` alongside existing client credentials path
- `apps/desktop/src/main/ipc/auth.ts` — new file, `auth:oauth2:authorize` handler
- `apps/desktop/src/preload/index.mjs` — expose `authorizeOAuth2`
- `apps/desktop/src/renderer/src/components/AuthTab.tsx` — "Authorize" button + status display
- `packages/http-core/tests/oauth2-pkce.test.ts` — PKCE math + callback server tests
