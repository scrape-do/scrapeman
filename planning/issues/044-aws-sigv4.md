# Issue 044 — AWS SigV4 signer

## Background

AWS SigV4 is required for S3, DynamoDB, API Gateway, and any AWS service that uses IAM authentication. `signAwsSigV4` already exists at `packages/http-core/src/auth/sigv4.ts` using the `aws4` library. The `applyAuth` function has a no-op stub for `awsSigV4` — this task wires the stub to the real implementation.

Security: AWS keys must always come from `{{env_var}}` substitution. They must never be hardcoded in `.req.yaml` files, which are committed to git.

## Acceptance criteria

- `applyAuth` no-op stub for `awsSigV4` replaced with real signing call
- Signs all required headers: `Authorization`, `X-Amz-Date`, `X-Amz-Content-Sha256`, (optional) `X-Amz-Security-Token`
- Session token optional — omit `X-Amz-Security-Token` when not set
- S3 path-style URL supported (i.e., `https://s3.amazonaws.com/<bucket>/key`)
- Keys must come from `{{env_var}}` resolution — validated at UI level (show warning if value doesn't start with `{{`)
- Integration test: sign an S3 GET, assert signature headers present and structurally correct (no live AWS call needed in CI — use `aws4.sign()` output validation)

## UI fields (verify they exist in AuthTab.tsx)

| Field | Notes |
|-------|-------|
| Access Key ID | Supports `{{vars}}`, warn if literal value |
| Secret Access Key | Masked, supports `{{vars}}`, warn if literal value |
| Session Token | Optional, masked, supports `{{vars}}` |
| Region | e.g. `us-east-1`, supports `{{vars}}` |
| Service | e.g. `s3`, `execute-api`, supports `{{vars}}` |

## Technical design

### Existing implementation (read before touching)

`packages/http-core/src/auth/sigv4.ts` — `signAwsSigV4(request, config)` already:
- Builds `aws4` options from the request (method, path, headers, body)
- Calls `aws4.sign(opts, credentials)`
- Returns the signed headers

### Wiring into applyAuth

Replace the no-op stub in `apply.ts`:
```typescript
case 'awsSigV4': {
  const signedHeaders = signAwsSigV4(request, config);
  return { ...request, headers: { ...request.headers, ...signedHeaders } };
}
```

### Body handling

`aws4` needs the body as a string or Buffer for `X-Amz-Content-Sha256`. Map body modes:
- `json` → `JSON.stringify(body.json)`
- `text` → `body.text`
- `formUrlEncoded` → URL-encoded string
- `none` → `''`
- `multipart` / `binary` → unsupported for SigV4 (document this clearly)

### Session token

```typescript
const credentials: aws4.Credentials = {
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey,
  ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
};
```

## Test scenarios

| Scenario | Input | Expected |
|----------|-------|----------|
| S3 GET | method=GET, service=s3, region=us-east-1, url=`https://s3.amazonaws.com/my-bucket/file.txt` | `Authorization` starts with `AWS4-HMAC-SHA256`, `X-Amz-Date` present |
| With session token | sessionToken provided | `X-Amz-Security-Token` header present |
| Without session token | sessionToken absent | `X-Amz-Security-Token` header NOT present |
| JSON body | POST with JSON body | `X-Amz-Content-Sha256` equals sha256 of the JSON string |
| No body | GET | `X-Amz-Content-Sha256` equals sha256 of empty string |
| Sign does not mutate input | Pass immutable request | Original request headers unchanged |

> CI: No live AWS call needed. Validate signature structure using `aws4` deterministic output — sign the same request twice with the same timestamp and assert identical results.

## Files to touch

- `packages/http-core/src/auth/apply.ts` — remove no-op stub, call `signAwsSigV4`
- `packages/http-core/src/auth/sigv4.ts` — add session token support if not already present; verify body mapping
- `packages/http-core/tests/sigv4.test.ts` — new test file with all scenarios above
