---
doc: file-format
owner: team-lead
status: draft
updated: 2026-04-14
---

# Scrapeman request file format

Version: `scrapeman/1.0`

## Goals

1. **Git-diff friendly** — stable key order, no generated IDs, no timestamps, no churn.
2. **Human readable** — a developer reviewing a PR should grok a request without tools.
3. **Parser-mature** — use YAML 1.2 so we inherit battle-tested parsers and editor highlighting.
4. **Deterministic emission** — scrapeman emits files with its own serializer to guarantee byte-stability.
5. **One request per file** — no bundled collections; the folder tree is the collection.

## File extension

- Requests: `*.req.yaml`
- Environments: `*.env.yaml` (under `.scrapeman/environments/`)
- Body sidecar files: arbitrary (`*.json`, `*.xml`, `*.bin`, etc.) under `files/` sibling to the request

## Encoding

- UTF-8, LF line endings, trailing newline.
- No BOM.
- Maximum line width: soft 120 cols (serializer will not break strings, but prefers block scalars for long content).

## Top-level key order (enforced by serializer)

1. `scrapeman` — format version tag, always first line
2. `meta` — name, description, tags
3. `method`
4. `url`
5. `params` — URL query parameters as a table (optional; alternative to inlining in url)
6. `headers`
7. `auth`
8. `body`
9. `proxy`
10. `scrapeDo` — scrape-do native mode config (optional)
11. `options` — per-request advanced options (timeout, redirect, tls, httpVersion)

Keys absent from a request are omitted (not written as `null`).

## Key order within nested blocks

- Each nested block also has a fixed key order defined in the serializer.
- Map entries the user controls (headers, params, variables) preserve insertion order and are written as YAML block-style maps.

## Body handling — inline vs sidecar

- **Threshold: 4096 bytes** of UTF-8 serialized body content.
- **Inline** (body < 4KB): body content lives directly in the file under `body.content` as a YAML literal block (`|`).
- **Sidecar** (body >= 4KB, or user-forced, or binary): body written to a sibling file; request references it via `body.file`.
- **Multipart form**: parts with `type: file` always use sidecar references under `files/`.
- **User can force sidecar** regardless of size via `body.forceSidecar: true`.

Sidecar filename convention: `<request-slug>.body.<ext>` where ext is `json`, `xml`, `txt`, `bin` based on content-type.

## Examples

### Example 1: Simple GET

```yaml
scrapeman: "1.0"
meta:
  name: Health check
method: GET
url: https://api.example.com/health
headers:
  Accept: application/json
```

### Example 2: POST with inline JSON body

```yaml
scrapeman: "1.0"
meta:
  name: Create user
  tags: [users, write]
method: POST
url: https://api.example.com/users
headers:
  Content-Type: application/json
  Accept: application/json
auth:
  type: bearer
  token: "{{apiToken}}"
body:
  type: json
  content: |
    {
      "name": "Ada Lovelace",
      "email": "ada@example.com"
    }
```

### Example 3: POST with sidecar body (large payload)

```yaml
scrapeman: "1.0"
meta:
  name: Bulk import products
method: POST
url: https://api.example.com/products/bulk
headers:
  Content-Type: application/json
auth:
  type: bearer
  token: "{{apiToken}}"
body:
  type: json
  file: ./files/bulk-import-products.body.json
```

### Example 4: Multipart form with file upload

```yaml
scrapeman: "1.0"
meta:
  name: Upload avatar
method: POST
url: https://api.example.com/users/{{userId}}/avatar
auth:
  type: bearer
  token: "{{apiToken}}"
body:
  type: multipart
  parts:
    - name: caption
      type: text
      value: Profile picture
    - name: file
      type: file
      file: ./files/upload-avatar.avatar.png
      contentType: image/png
```

### Example 5: OAuth2 client credentials + scrape-do native mode

```yaml
scrapeman: "1.0"
meta:
  name: Fetch protected product page via scrape-do
  description: Exercises OAuth2 client creds AND scrape-do proxy in one request
method: GET
url: https://target-site.com/products/42
headers:
  Accept: text/html
auth:
  type: oauth2
  flow: clientCredentials
  tokenUrl: https://auth.example.com/oauth/token
  clientId: "{{oauthClientId}}"
  clientSecret: "{{oauthClientSecret}}"
  scope: read:products
scrapeDo:
  enabled: true
  token: "{{scrapeDoToken}}"
  render: true
  super: false
  geoCode: us
  waitUntil: domcontentloaded
  customHeaders: true
options:
  timeout:
    total: 60000
  redirect:
    follow: true
    maxCount: 10
  httpVersion: auto
```

## Parser + serializer contract

- **Parse:** use the `yaml` npm package (eemeli/yaml) with `{ strict: true }`.
- **Validate:** against a Zod schema derived from `@scrapeman/shared-types`. Unknown keys are warnings, not errors, so forward-compat is preserved.
- **Serialize:** custom function in `@scrapeman/http-core/src/format/serialize.ts` that:
  1. Walks the Request type in fixed key order.
  2. Emits YAML manually (not via `yaml.stringify`) so key order is guaranteed.
  3. Uses literal block (`|`) for multiline strings >80 chars or containing newlines.
  4. Double-quotes strings only when necessary (leading `*`, `@`, pure numbers, `yes/no/true/false` words — the YAML Norway problem).
  5. Never emits anchors, tags, or aliases.
  6. Ends with a trailing newline.

## Round-trip guarantee

`serialize(parse(file)) === file` for any well-formed scrapeman request file emitted by the serializer. (User-edited files may normalize on first save.)

Tested via snapshot tests in `packages/http-core/tests/format.test.ts` covering all 5 example types above plus edge cases (empty body, nested vars, binary file part, Norway values).
