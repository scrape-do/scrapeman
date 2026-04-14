# Issue 042 — OAuth2 client credentials flow

## Background

Bruno does not cache `expiresAt` correctly (usebruno/bruno#7565). It refetches a token on every request if the token doesn't carry an explicit expiry signal, and concurrent requests each fire a separate token fetch. Scrapeman fixes both.

The `OAuth2Client` class already exists at `packages/http-core/src/auth/oauth2.ts` with a `Map<string, TokenResponse>` cache. Two known bugs to fix:
1. No in-flight Promise sharing — concurrent requests each fire a separate token fetch.
2. `expires_in` absent → falls back to 3600s instead of treating the token as non-expiring.

## Acceptance criteria

- Token endpoint called with `grant_type=client_credentials`, `client_id`, `client_secret`, optional `scope`
- `expiresAt = Date.now() + expires_in * 1000` stored in cache
- Proactive refresh 30s before expiry (`expiresAt - 30_000 < Date.now()`)
- `expires_in` absent → `expiresAt = Number.MAX_SAFE_INTEGER` (never expires)
- Concurrent requests → single in-flight `Promise<TokenResponse>` (not just a value check)
- On 401 → invalidate cache entry → retry request exactly once → no second retry
- Access token injected as `Authorization: Bearer <token>` header at send time
- Works against a real provider (Auth0 test tenant or equivalent)

## UI fields (already in AuthTab.tsx — verify they exist)

| Field | Notes |
|-------|-------|
| Flow | `clientCredentials` (this task) vs `authorizationCode` (T043) |
| Token URL | Full endpoint URL, supports `{{vars}}` |
| Client ID | Plain text, supports `{{vars}}` |
| Client Secret | Masked, supports `{{vars}}` |
| Scope | Space-separated, optional |
| Header prefix | Default: `Bearer` (editable for non-standard providers) |

## Technical design

### Cache key
`sha1(tokenUrl + clientId + scope)` — so different scopes get separate cached tokens.

### In-flight deduplication
```typescript
// Replace: Map<string, TokenResponse>
// With:    Map<string, Promise<TokenResponse>>

private inFlight = new Map<string, Promise<TokenResponse>>();
private cache    = new Map<string, TokenResponse & { expiresAt: number }>();

async getToken(config: OAuth2ClientCredentialsConfig): Promise<string> {
  const key = cacheKey(config);

  const cached = this.cache.get(key);
  if (cached && cached.expiresAt - 30_000 > Date.now()) {
    return cached.access_token;
  }

  // Return existing in-flight promise if one is pending
  const inFlight = this.inFlight.get(key);
  if (inFlight) return (await inFlight).access_token;

  const fetch = this.fetchToken(config).finally(() => this.inFlight.delete(key));
  this.inFlight.set(key, fetch);
  const token = await fetch;
  this.cache.set(key, token);
  return token.access_token;
}
```

### 401 retry (in applyAuth or executor middleware)
```typescript
let res = await executor.execute(resolved);
if (res.status === 401 && request.auth.type === 'oauth2') {
  oauth2Client.invalidate(cacheKey(request.auth));
  const refreshed = applyAuth(request); // re-fetches token
  res = await executor.execute(refreshed);
  // No further retry
}
```

### expires_in absent
```typescript
const expiresAt = token.expires_in != null
  ? Date.now() + token.expires_in * 1000
  : Number.MAX_SAFE_INTEGER;
```

## Test scenarios

| Scenario | Setup | Expected |
|----------|-------|----------|
| Happy path | Mock token endpoint returns `{ access_token: "tok", expires_in: 3600 }` | `Authorization: Bearer tok` on request |
| Concurrent requests | Fire 5 requests simultaneously | Token endpoint called exactly once |
| Token expiry | Set `expiresAt` to `Date.now() - 1` | New token fetched on next request |
| Proactive refresh | Set `expiresAt` to `Date.now() + 20_000` (< 30s away) | New token fetched |
| No `expires_in` | Mock returns `{ access_token: "tok" }` | Token treated as non-expiring (`MAX_SAFE_INTEGER`) |
| 401 retry | First request returns 401, second 200 | Exactly one retry, cache invalidated between |
| 401 no infinite loop | Every response returns 401 | Request fails after exactly one retry |

## Files to touch

- `packages/http-core/src/auth/oauth2.ts` — fix in-flight deduplication + expires_in fallback
- `packages/http-core/src/auth/apply.ts` — remove no-op stub for `oauth2`, wire `OAuth2Client.getToken()`
- `apps/desktop/src/main/index.ts` — add 401 retry middleware around executor call (or in executor itself)
- `packages/http-core/tests/oauth2.test.ts` — new test file with all scenarios above
