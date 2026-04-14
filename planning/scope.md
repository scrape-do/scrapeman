---
doc: scope
owner: product-manager
status: draft
updated: 2026-04-14
---

# Scope — v1.0

## In scope

### HTTP engine
- All standard methods + arbitrary custom method strings (WebDAV, QUERY, etc.)
- HTTP/1.1 and HTTP/2 (auto-negotiate via ALPN, manual override)
- TLS options: ignore invalid certs toggle, custom CA, client certs
- Redirect control (follow/don't, max count, preserve method on 307/308)
- Timeouts (connect, read, total)
- Request/response size limits with streaming for large payloads

### Request building
- URL bar with `{{var}}` highlighting
- Params tab with two-way URL↔params sync (enable/disable, edit inline)
- Headers table with autocomplete for common headers
- Body types: none, raw (json/xml/text/html/js), form-urlencoded, multipart (with file upload), binary file
- Variable substitution: `{{var}}` in URL, params, headers, body, auth, proxy, scrape-do fields
- Built-in dynamic variables: `{{random}}` (UUID), `{{timestamp}}`, `{{isoDate}}`, `{{randomInt}}`
- **Settings tab (per-request)** next to Params/Headers/Body:
  - Proxy (HTTP/HTTPS/SOCKS5 + auth + bypass list)
  - Timeout (connect, read, total)
  - Redirect (follow, max count, preserve method)
  - TLS (ignore invalid certs, custom CA, client cert)
  - HTTP version (auto/1.x/2)
  - scrape-do native mode toggle with parameter UI
- **Right-click context menus on editable cells** (URL, param value, header value):
  - URL encode / URL decode
  - Base64 encode / Base64 decode
  - Copy / paste
  - Clear

### Auth helpers
- None, Basic, Bearer token, API Key (header or query)
- OAuth2: authorization code flow, client credentials flow, token refresh, token cache
- AWS SigV4 (scrape-do customers hit AWS endpoints frequently)
- Custom header auth (pre-filled template)

### Cookie jar
- Persistent per-environment cookie store (tough-cookie)
- Domain/path scoped, Set-Cookie parsing, expiry handling
- Manual cookie inspector/editor per domain
- Clear cookies button per environment

### Proxy
- HTTP, HTTPS, SOCKS5 proxies
- Per-request and per-environment proxy config
- **scrape-do native mode:** toggle that injects scrape-do proxy + token + parameter UI (render, super, geoCode, waitUntil, etc.) without manual URL building
- Proxy bypass list

### Response viewer
- JSON tree (collapsible, search, copy path)
- Raw text, pretty HTML, image preview, binary hex
- Headers table, cookies table, timings (DNS, connect, TLS, TTFB, download)
- Size, status, duration badges
- Save response to file

### Collections & environments
- Folder tree, drag-drop reorder
- File format: one request per file (git-friendly YAML)
- Environment variables: global, collection, environment, per-request scopes with precedence
- Secret variables (masked display, optional OS keychain storage)
- **Import sources (first-class):**
  - Postman Collection v2.1 (`.postman_collection.json`) + v2.1 environments
  - Bruno collections (`.bru` files, folder tree)
  - Insomnia v4 export JSON (resources: requests, environments, cookies)
  - HAR (Chrome/Firefox devtools export → one request per entry)
  - curl command (paste + file)
  - OpenAPI 3.x / Swagger 2.0 → collection of requests (deferred to v1.5)
- **Export sources:** Postman v2.1 JSON, curl, HAR
- **One-click "Import from…" menu** in the sidebar header with format auto-detection by file extension

### Code generation
- **MVP targets (hand-written, v1.0 early):** curl, JavaScript fetch, Python `requests`, Go `net/http`
- **Full targets via `postman-code-generators` (v1.0 late):** 20+ languages incl. libcurl C, Java OkHttp, PHP, Ruby, C# HttpClient, Swift, Kotlin, Node http, Rust reqwest, Dart http
- Respects current auth, headers, body, params, proxy, scrape-do settings
- Resolves `{{var}}` at generation time (user can toggle "with variables inlined" vs "as-is with templates")
- Copy to clipboard, language switcher, syntax-highlighted preview (CodeMirror read-only)

### Git sync (collections only, optional)
- Collections stored as plain files in user-chosen directory
- User can point scrapeman at an existing git repo or any folder — scrapeman does not manage git itself
- No built-in git UI in v1 — user uses their own git client / IDE / terminal
- File format designed for clean diffs (stable key order, one request per file, no timestamps, no generated IDs)
- **History is NEVER written to the collection folder** — history lives in app data dir and never gets committed by accident

### History (local-only, unlimited)
- **Every** sent request captured: method, URL, params, headers, body, resolved variables, response status, response headers, response body (up to configurable size), timings, duration, protocol, workspace + active environment at send time
- Stored in **SQLite** under app data dir (`~/Library/Application Support/Scrapeman/` on mac, equivalent on win/linux)
- **Never synced, never uploaded, never written to the workspace folder**
- Searchable by URL, method, status, date range, response body text (FTS5 index)
- Restore any past request into a new tab with one click
- "Save to collection" — promote a history entry to a `.req.yaml` in the workspace
- Retention: unlimited by default; user-configurable max entries / max age / max disk size
- Clear-history, per-entry delete, bulk delete by filter
- Export selected history entries as HAR or curl
- Diff two history entries (response bodies + timings) — v1.5

### Load runner (single-request stress test)
- **"Run with load…"** action on any saved request or active tab
- Configure:
  - Total requests (`N`)
  - Concurrency (`C` — parallel in-flight)
  - Ramp-up duration (optional)
  - Per-iteration delay (optional)
  - Data iteration source (CSV/JSON, one row per iteration) — v1.5
- Live metrics during run:
  - Requests sent / remaining / per second
  - Latency: min / p50 / p95 / p99 / max
  - Error rate by kind (network / timeout / tls / status≥500 / status 4xx)
  - Status code histogram
  - Live chart: latency over time, throughput over time
- Stop mid-run; partial results retained
- Export results as CSV, JSON, HAR
- Resolves `{{var}}` per iteration (so `{{random}}` and `{{timestamp}}` change per request)
- Isolated from history by default (optional "record to history" toggle)

### UX essentials
- Tabs (multiple requests open)
- History (last N requests, searchable)
- Keyboard shortcuts (Cmd+Enter send, Cmd+T new tab, Cmd+P quick open, Cmd+S save)
- Light + dark theme
- Resizable panels, remembered layout

## Out of scope (v1)

- Pre-request / post-response scripts (no JS sandbox) — revisit in v2 if demand is real
- WebSocket, gRPC, GraphQL dedicated UIs
- Mock server, monitors, API docs hosting
- Team sync backend, accounts, workspaces
- Browser extension / interceptor
- HTTP/3 (QUIC)
- Mobile app
- Plugin system

## Deferred to v1.5

- Request chaining (use response of A as input to B) via simple variable capture, no scripting
- **Collection runner** (run a collection end-to-end with per-request assertions, report pass/fail) — Newman equivalent, unlimited. **Distinct from the v1.0 load runner**, which fires one request many times; the collection runner runs a sequence of requests.
- Response diffing between two history entries or between two runs
- History entry diff
- Snippet library for common scrape-do patterns
- Data-driven runs for the load runner (CSV/JSON input file → N iterations, one row per iteration)
- OpenAPI 3.x / Swagger 2.0 import
- GraphQL dedicated editor (GraphQL body can be sent via raw JSON in v1.0)
- "Quick look" eye icon on env variables (show resolved values panel)
- Request comments and shared notes on `.req.yaml` files
