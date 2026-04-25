# Scrapeman Documentation

Complete reference for every feature in Scrapeman. For installation and project overview, see the [README](README.md).

---

## Table of Contents

- [Getting Started](#getting-started)
- [Request Building](#request-building)
- [Environment Variables](#environment-variables)
- [Scoped Variables and Auth Inheritance](#scoped-variables-and-auth-inheritance)
- [Auth Schemes](#auth-schemes)
- [Collections and File Format](#collections-and-file-format)
- [Local History](#local-history)
- [Response Viewer](#response-viewer)
- [Code Export](#code-export)
- [Load Runner](#load-runner)
<<<<<<< HEAD
- [WebSocket](#websocket)
=======
- [Collection Runner](#collection-runner)
>>>>>>> ed92491 (feat: collection runner — sequential/parallel, CSV iterations, JSON/CSV/HTML export)
- [Import and Export](#import-and-export)
- [Proxy and Scrape.do Mode](#proxy-and-scrapedo-mode)
- [Scraping-first features](#scraping-first-features)
- [Cookie Jar](#cookie-jar)
- [In-App Git Integration](#in-app-git-integration)
- [Collection Search](#collection-search)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [UX Details](#ux-details)

---

## Getting Started

### Install

**macOS (Homebrew):**

```bash
brew tap scrape-do/scrapeman && brew install --cask scrapeman
```

**Direct download:**

Pre-built installers for every tagged release:
- **macOS** `.dmg` (Apple Silicon + Intel)
- **Windows** `.exe` NSIS installer (x64)
- **Linux** `.AppImage` and `.deb` (x64)

Download from [github.com/scrape-do/scrapeman/releases](https://github.com/scrape-do/scrapeman/releases).

### First request

1. Open Scrapeman. A new empty tab is ready with the cursor in the URL bar.
2. Paste a URL: `https://httpbin.org/get`
3. Method defaults to `GET`. Press `Cmd+Enter` (Mac) or `Ctrl+Enter` (Win/Linux) to send.
4. The response appears in the right panel: status, headers, body (auto-detected as JSON and rendered in the Pretty view).

### Save to collection

1. Press `Cmd+S`. If the request has never been saved, a dialog asks for a name and folder.
2. The file is written to your workspace folder as a `.sman` file.
3. The request appears in the sidebar collection tree.

---

## Request Building

### URL bar

The URL bar supports `{{var}}` syntax with live highlighting. Variables resolve from the active environment, collection variables, and built-in dynamics.

An autocomplete popover appears when you type `{{` showing all available variables with their current resolved values.

### Tabs

- **Params** — key-value table with two-way URL sync. Editing a param updates the URL query string and vice versa.
- **Headers** — key-value table. Auto-headers (Content-Type, Accept-Encoding, User-Agent) are shown with a toggle to disable or override each one. A bulk-edit toggle (pencil icon, top-right of the table) switches the view to a textarea where each line is `Key: Value`. Prefix a line with `//` to disable it. Switching back to the table is lossless — disabled state and `{{var}}` placeholders are preserved.
- **Body** — modes: none, raw (JSON, XML, HTML, text, JavaScript), form-urlencoded, multipart form-data, binary file, GraphQL (planned). When mode is **JSON**, a **Beautify** button appears in the type bar to format the body with 2-space indent. The shortcut **Shift+Cmd+F** (macOS) / **Shift+Ctrl+F** (Windows/Linux) triggers beautify while the body editor is focused. Bodies containing `{{variable}}` placeholders are not formatted (use environments to resolve them first).
- **Auth** — see [Auth Schemes](#auth-schemes) below.
- **Settings** — per-request proxy, timeout, redirect, TLS, HTTP version, and Scrape.do native mode. See [Proxy and Scrape.do Mode](#proxy-and-scrapedo-mode).
- **Code** — see [Code Export](#code-export) below.

### Key-value table keyboard shortcuts

In both Headers and Params tables:
- **Shift+Enter** — insert a new empty row below the current one, focus moves to the new Key cell.
- **Tab from the last row's Key cell** — if the Key cell is non-empty, a new empty row is appended automatically. No need to click "Add row."

### Auto-headers

Scrapeman automatically sets three headers based on the request:
- **Content-Type** — derived from the body mode (application/json for JSON body, application/x-www-form-urlencoded for form, etc.)
- **Accept-Encoding** — `gzip, br, deflate` so the response is auto-decompressed by undici.
- **User-Agent** — `Scrapeman/<version>`.

Each auto-header can be disabled or overridden per-request from the Headers tab. If you manually set the same header, your value wins.

---

## Environment Variables

### Setup

Environments are stored as `.env.yaml` files under `.scrapeman/environments/` in your workspace.

```yaml
# .scrapeman/environments/dev.env.yaml
name: Development
variables:
  - key: baseUrl
    value: https://api.example.com
    secret: false
  - key: token
    value: sk-live-abc123
    secret: true
```

### Variable resolution

`{{var}}` syntax works across: URL, params, headers, body, auth fields, proxy fields, and Scrape.do fields.

**Scope precedence** (highest wins):
1. Folder chain (deepest folder overrides shallower)
2. Active environment
3. Collection variables
4. Global variables
5. Built-in dynamics

See [Scoped Variables and Auth Inheritance](#scoped-variables-and-auth-inheritance) for details on each scope.

### Built-in dynamic variables

These re-resolve on every send:

| Variable | Output |
|---|---|
| `{{random}}` | Random 8-char alphanumeric string |
| `{{uuid}}` | UUID v4 |
| `{{timestamp}}` | Unix timestamp in milliseconds |
| `{{timestampSec}}` | Unix timestamp in seconds |
| `{{isoDate}}` | ISO 8601 date string |
| `{{randomInt}}` | Random integer 0-9999 |

### Secret variables

Variables with `secret: true` are masked in the UI (shown as `••••••`). They resolve normally at send time. History entries preserve the template (`{{token}}`) on disk, never the resolved secret value.

---

## Scoped Variables and Auth Inheritance

Variables resolve in this order (rightmost wins):

```
Global → Collection → Environment → Folder chain (root → leaf)
```

### Global variables

Stored at `.scrapeman/globals.yaml`. Available to every request in the workspace, across all environments. Edit via the workspace settings gear icon in the sidebar.

```yaml
# .scrapeman/globals.yaml
scrapeman: "2.0"
variables:
  - key: COMPANY_ID
    value: acme
    enabled: true
    secret: false
```

### Collection variables

Stored at `.scrapeman/collection.yaml`. Apply to all requests. Lower precedence than environment variables. Also holds the collection-level default auth. Edit via the workspace settings gear icon → "Collection settings…".

```yaml
# .scrapeman/collection.yaml
scrapeman: "2.0"
variables:
  - key: API_VERSION
    value: v2
    enabled: true
    secret: false
auth:
  type: bearer
  token: "{{BEARER_TOKEN}}"
```

### Folder variables and auth

Each folder can have a `_folder.yaml` file with variables and an optional auth block. Right-click a folder in the sidebar and select "Folder settings…" to open the two-tab dialog (Variables / Auth).

```yaml
# api/users/_folder.yaml
scrapeman: "2.0"
variables:
  - key: RESOURCE
    value: users
    enabled: true
    secret: false
auth:
  type: apiKey
  key: X-Api-Key
  value: "{{API_KEY}}"
  in: header
```

Folder variables from ancestor folders are merged first (root to leaf), so a deeper folder's variable wins over a shallower one's.

### Auth inheritance

When a request's Auth tab is set to "None" (or the Inherit option), Scrapeman walks the folder chain from the request's folder up to the workspace root. The first ancestor with an `auth` block in its `_folder.yaml` is used. If no folder defines auth, the collection default auth is applied.

The Auth tab shows an "Inherited from /path" label when inheritance is active. Set an explicit auth type on the request to override it.

---

## Auth Schemes

Six auth types are built in. Select from the Auth tab in the request builder.

### None

No auth headers are sent. This is the default.

### Basic

Provide `username` and `password`. Scrapeman encodes them as `Authorization: Basic <base64(user:pass)>` at send time.

### Bearer

Provide a `token` string. Sent as `Authorization: Bearer <token>`. The token can be a `{{var}}` reference.

### API Key

Provide `key`, `value`, and `placement` (header or query). If placement is `header`, the key-value pair is injected as a request header. If `query`, it is appended to the URL as a query parameter.

### OAuth 2.0

Three flows are supported. Select from the Flow dropdown in the Auth tab.

**Client credentials**

Configure: Token URL, Client ID, Client Secret, Scope (optional), Audience (optional).

Scrapeman fetches the token automatically before sending the request. Tokens are cached until expiry and then refreshed. Concurrent requests share one in-flight token fetch.

**Authorization code / Authorization code + PKCE**

Configure: Token URL, Auth URL, Client ID, Client Secret (optional for PKCE flows), Scope, Audience (optional).

Click "Get token" to start the flow. Scrapeman opens your default browser to the auth URL, spins up a local loopback server on a random port, and waits for the redirect callback. Once the code arrives, Scrapeman exchanges it for a token and caches the result. The token is then applied automatically to all subsequent requests.

Authorization code + PKCE generates a code_verifier / code_challenge pair using S256. No client secret is required for pure PKCE flows.

The redirect URI is always `http://127.0.0.1:<port>/callback` (ephemeral port). Register this pattern in your authorization server if it requires an exact match.

**OIDC discovery**

Set the Discovery URL field to a `.well-known/openid-configuration` endpoint and click "Load". Scrapeman reads the document and auto-fills Token URL, Auth URL, and the supported scopes list.

**Token placement**

By default the access token is sent as `Authorization: Bearer <token>`. The `accessTokenPlacement` field in the `.sman` file accepts three variants:

```yaml
auth:
  type: oauth2
  # Default — sends as Authorization: Bearer <token>
  accessTokenPlacement:
    in: header
    name: Authorization
    prefix: Bearer

  # Custom header name / prefix
  accessTokenPlacement:
    in: header
    name: X-Auth-Token
    prefix: ""

  # Query parameter
  accessTokenPlacement:
    in: query
    name: access_token

  # Form body (POST/PUT/PATCH with formUrlEncoded body only)
  accessTokenPlacement:
    in: body
    name: access_token
```

**Token inspector**

When the token response contains an `access_token` or `id_token` that is a JWT, Scrapeman shows a collapsible Token Inspector panel below the token management buttons. The inspector decodes the header and payload and shows a live countdown to the `exp` claim. No signature is verified — the panel is for display only.

### AWS Signature v4

Configure:
- **Access Key ID** and **Secret Access Key**
- **Session Token** (optional, for temporary credentials)
- **Region** (e.g., `us-east-1`)
- **Service** (e.g., `s3`, `execute-api`)

Scrapeman signs the request using the `aws4` library. The signature covers method, URL, headers, and body.

---

## Collections and File Format

### File structure

Every request is one `.sman` file (YAML content, custom extension):

```yaml
# products/list.sman
scrapeman: "2.0"
meta:
  name: List products
method: GET
url: "https://api.example.com/products?page={{page}}"
headers:
  Accept: application/json
auth:
  type: bearer
  token: "{{token}}"
```

Key order is stable (deterministic serializer), so git diffs are clean and human-readable.

#### `.req.yaml` compatibility (pre-0.4 workspaces)

Files saved by earlier versions used `.req.yaml` with `scrapeman: "1.0"`. Scrapeman still reads those files transparently; when you save one, it is rewritten as `.sman` next to the old file and the `.req.yaml` is removed. If both extensions happen to exist with the same stem, the `.sman` wins and the `.req.yaml` is hidden from the sidebar.

### Body sidecars

Payloads 4KB or larger are automatically promoted to a sidecar file under `files/<slug>.body.<ext>`. The `.sman` file references the sidecar by path. This keeps the main file small and diffs focused on metadata changes.

### Workspace folder

Scrapeman writes only inside the workspace folder you choose. History, cookies, and state live in the app data directory, never the workspace. The workspace is safe to commit to git.

### Multiple workspaces

You can keep more than one workspace open in the same window and switch between them from the sidebar header. Click the workspace name (just above the Files / Git tab strip) to drop down a list of every workspace you have opened this session.

The dropdown lets you:

- Switch to another open workspace (the current workspace's open tabs, active environment, and sidebar view get snapshotted in memory and restored when you switch back).
- Open another workspace folder via the standard picker.
- Close the current workspace, or close any other open workspace from its row (× on hover).

When more than one workspace is open, the title bar shows the active workspace name in bold along with an "(N open)" counter.

Persistence: the list of open workspaces and the last-active path persist to localStorage, so the same set reopens on next launch. Per-workspace UI snapshots (open tabs, active env, sidebar view) live in memory only — they are not saved across restarts. File-backed tabs reopen because they live on disk; unsaved draft tabs do not survive a quit.

Out of scope for now: side-by-side workspace columns, dragging requests between workspaces, workspace-specific keyboard shortcuts. The undo-close-tab stack (`⌘⇧T`) is shared across workspaces in this release.

### Per-request git sync toggle

Right-click a request in the sidebar and select "Stop syncing to git" to exclude it from version control. Backed by `.git/info/exclude` (never pushed to remote). Shortcut: `Cmd+Shift+H` on the active tab. A crossed-eye icon marks unsynced requests.

---

## Local History

Every sent request is captured to a per-workspace JSONL file under the app data directory (never the workspace folder).

**Template-preserving**: `{{token}}` stays as `{{token}}` on disk. Secrets are never baked into history.

**Compressed**: body preview fields are gzipped on disk when 256 bytes or larger (5-10x smaller).

### History panel

The sidebar History panel shows recent requests with:
- Method badge (GET/POST/PUT/etc.)
- Status pill (200 green, 4xx red, etc.)
- Relative time ("2 min ago")

Click any entry to restore it into a new tab. Duplicate restores are detected and skipped.

### Search and filter

The history panel has a search bar that filters by request name and URL.

---

## Response Viewer

### Content detection

Scrapeman auto-detects the response content type: JSON, HTML, XML, JavaScript, CSS, image, PDF, text, or binary.

### View modes per content type

| Content type | Available modes |
|---|---|
| SSE (`text/event-stream`) | Events (default), Raw |
| JSON | Raw, Pretty (CodeMirror syntax-highlighted, formatted), Tree (collapsible with JSONPath copy) |
| HTML | Raw, Pretty (CodeMirror syntax-highlighted), Preview (sandboxed iframe) |
| XML | Raw, Pretty (CodeMirror syntax-highlighted, indented) |
| JavaScript | Raw, Pretty (CodeMirror syntax-highlighted) |
| CSS | Raw, Pretty (CodeMirror syntax-highlighted) |
| Image | Raw (hex), Preview (rendered) |
| PDF | Raw, Preview (Chromium PDF viewer) |
| Text/binary | Raw |

Pretty mode uses CodeMirror with the one-dark theme in dark mode and a neutral light theme otherwise. Syntax coloring follows the language grammar: key/value colors for JSON, tag/attribute for XML, keyword/string for JavaScript, and selector/property for CSS.

**Lazy parsing**: the default view is Raw. JSON.parse and tree rendering only happen when you switch to Pretty or Tree view.

### SSE Events mode

When the response is `text/event-stream` (or `ExecutedResponse.sseEvents` is populated), the viewer defaults to **Events** mode:

- Each event is shown in its own block with `id`, `event`, `retry` fields in the header row and the `data` body below.
- If `data` is valid JSON, it renders as a collapsible JSON tree (same component used in the Tree view). Otherwise it displays as monospace text.
- **Auto-scroll**: the list follows new events as they arrive. Click "Scroll: off" to pause and browse earlier events; click again to resume.
- **Export JSON**: saves the full `sseEvents` array as a `.json` file via the system save dialog.
- Raw and Pretty modes remain accessible for inspecting the raw stream text.

Detection fires on either `Content-Type: text/event-stream` in the response headers, or when the executor sets `sseEvents` on the response (which it does for all SSE responses regardless of the header).

### Response body search

Search within the response body with highlight, previous/next navigation. The search persists across sends and auto-re-runs when a new response arrives.

- **Debounced input**: the match scan runs 150 ms after you stop typing so keystrokes feel instant even on large bodies.
- **Virtualized rendering**: Raw views render only the visible lines — 5 MB bodies scroll and search without jank.
- **Enter / Shift+Enter**: jump to next / previous match; the viewport scrolls to the active match automatically.
- **Large body warning**: switching to Pretty mode on a body over 500 KB shows a banner suggesting Raw for best performance. Applies to all syntax-highlighted kinds (JSON, HTML, XML, JavaScript, CSS).

### Metrics

Every response shows: HTTP status, TTFB (time to first byte), download time, body size, and protocol (HTTP/1.1 or h2).

### Dev Tools tab

The Dev Tools tab appears next to Body and Headers after every response. It shows:

**Timing waterfall** — horizontal bar chart with one segment per measured phase: DNS lookup, TCP connect, TLS handshake, time to first byte, and download. Each segment is proportional to its share of total time and labelled with its exact millisecond value.

**Request metadata**

| Field | Description |
|---|---|
| URL | The final URL after variable resolution, Scrape.do composition, and auth |
| HTTP version | Protocol used for the response (http/1.1 or h2) |
| Remote address | IP and port of the server that answered |
| Compression | Wire size from Content-Length vs decoded size, e.g. `12.4 KB → 48.1 KB (3.9× decoded)`. Shown only when Content-Length is present and differs from decoded size. |

**Sent headers** — all headers actually sent on the wire after auto-header merge and auth injection.

**Redirect chain** — each 3xx hop before the final response, shown as a vertical list:
```
301  https://example.com/old  →  /new
302  https://example.com/new  →  /final
```

**TLS certificate** — subject CN, issuer CN, validity dates, and SHA-256 fingerprint. Days-remaining warning appears when fewer than 30 days remain. Shown only for HTTPS responses. Displays "TLS info unavailable" when the certificate could not be read (e.g. resumed TLS session).

**Script console** — output from pre/post-request scripts (issue #20, not yet shipped). Shows "No script output" when no script was attached or the script produced no output.

---

## Code Export

Generate code from the current request in four languages:

| Language | Library |
|---|---|
| curl | curl CLI |
| JavaScript | fetch API |
| Python | requests |
| Go | net/http |

Each generator respects method, URL, params, headers, body, and Basic/Bearer auth.

**Variable toggle**: switch between "inline resolved values" and "keep `{{var}}` templates" in the generated code.

Copy the generated code to clipboard with one click. The Code tab in the request builder shows a read-only preview.

---

## Load Runner

Stress-test any request with bounded concurrency.

### Configuration

- **Total requests** — how many times to send
- **Concurrency** — how many in-flight at once
- **Per-iteration delay** (optional)

Each iteration re-resolves `{{random}}`, `{{timestamp}}`, and other dynamics, so every request is unique.

**Config is per-tab.** Each request tab has its own load test configuration. Switching tabs does not reset another tab's settings.

### Live metrics

While running, you see:
- Sent / remaining / requests per second
- Latency: p50, p95, p99
- Success rate
- Status histogram (200, 201, 400, 500, ...)
- Error kind breakdown (timeout, connection refused, etc.)

Hover any metric to see a description of what it measures.

### Tab isolation

Load test state (config, progress, event log) is stored per tab in the application state. A test started in Tab A continues running when you switch to Tab B — progress is preserved and visible when you return to Tab A.

### Response validator

Set expected status codes (e.g., `200, 201`) and an optional body-contains substring. Requests that fail validation are flagged in the console log.

### Controls

- **Stop** mid-run with partial results preserved.
- Console log with color-coded rows: green for success, yellow for validation fail, red for network error.

---

<<<<<<< HEAD
## WebSocket

The "WebSocket" tab on any request tab opens a bidirectional WebSocket client. It does not replace the HTTP request builder — both live in the same tab.

### Connecting

Enter a `ws://` or `wss://` URL and click **Connect** (or press Enter). The status dot in the top bar changes:

- Gray — closed
- Yellow — connecting or closing
- Green — open
- Red — closed after error

Click **Disconnect** to close the connection with code 1000.

### Sending messages

Type in the send area at the bottom. Press **Send** or **⌘↵** to send. The message appears in the timeline with a ↑ direction indicator.

### Timeline

Each message row shows:
- **↓** — inbound message
- **↑** — outbound message
- **●** — ping sent (application-level keep-alive)
- **○** — pong received (with round-trip latency in ms)
- **—** — status event (connected, disconnected, error)

JSON payloads have an expand toggle that renders the collapsible tree viewer inline.

**Auto-scroll** keeps the timeline pinned to the bottom as new messages arrive. Scrolling up manually pauses it; clicking the Auto-scroll button resumes it.

Click **Export** to download the full timeline as a JSON file.

### Ping / keep-alive

By default the client sends an application-level ping message every 30 seconds. Servers that echo it back are used to measure round-trip latency. The pong row shows the latency in milliseconds.

This is not a WebSocket protocol-level ping frame — it is a text message with a sentinel value, because the undici WebSocket implementation does not expose raw ping frame APIs to userland.

### Connection state across tab switches

Switching to another tab does not close the socket. The connection stays open in the background. Switching back resumes the live timeline from where you left off.

### Proxy support

The WebSocket client routes through the same proxy configuration used for HTTP requests. Set a proxy URL in the connection options, and all WebSocket handshake and frames will go through it. This includes Scrape.do proxy endpoints for scraping targets that require it.
=======
## Collection Runner

Run all requests in a folder together — useful for smoke-testing a workflow, seeding test data, or running a multi-step scraping sequence.

### Opening the runner

Right-click any folder in the sidebar and choose **Run folder…**. The runner panel opens pre-filled with that folder's request list.

### Modes

**Sequential** — requests fire one at a time in the order they appear in the folder tree. Each request waits for its response before the next starts. Use this for workflows where order matters (e.g., login → fetch → clean up).

**Parallel** — requests in each iteration fire simultaneously, up to the configured **Concurrency** limit. Iterations are still sequential (one iteration completes before the next starts).

### Configuration options

| Option | Default | Notes |
|---|---|---|
| Mode | Sequential | Sequential or Parallel |
| Concurrency | 5 | Parallel mode only; max simultaneous in-flight requests |
| Delay (ms) | 0 | Wait after each request completes, before the next starts |
| Iterations | 1 | How many full-collection passes to run |
| CSV file | — | Replaces the iterations counter; see data-driven below |

### Data-driven iterations (CSV)

Upload a CSV file to run the collection once per data row. The header row defines variable names; each subsequent row becomes one iteration's variable bag, merged on top of the active environment.

Example:

```csv
user_id,token
42,abc123
99,xyz789
```

With this CSV, the collection runs twice. In iteration 1, `{{user_id}}` resolves to `42` and `{{token}}` to `abc123`. In iteration 2 they resolve to `99` and `xyz789`.

### Results list

Each completed request shows:
- Pass (✓) or fail (✗) indicator
- Iteration number, request name, method, HTTP status, duration
- Click any row to expand it: URL, response headers, body preview, and error detail

### Progress bar

A live progress bar tracks `completed / total` across all iterations.

### Abort

Click **Stop** at any time. In-flight requests are cancelled via AbortSignal; partial results are preserved in the results list and are still exportable.

### Export

After a run completes, three export buttons appear:

- **JSON** — full `RunnerResult` object including all per-request results, timings, and metadata
- **CSV** — one row per request: iteration, name, method, URL, status, duration, ok, error
- **HTML** — self-contained styled report; dark theme, summary cards, full results table

The native file-save dialog prompts for a destination on each export.

### Scrape.do compatibility

If a request in the folder has `scrapeDo.enabled: true`, the runner honours it — just as the single-request executor does. The runner does not force Scrape.do on globally; per-request settings are respected.
>>>>>>> ed92491 (feat: collection runner — sequential/parallel, CSV iterations, JSON/CSV/HTML export)

---

## Import and Export

### Import from other tools

Scrapeman reads collections from these formats:

**OpenAPI 3.0.x / 3.1.x and Swagger 2.0** (`importOpenApiSpec`)
- Accepts JSON or YAML string — format is auto-detected from content
- Each `paths[*][method]` operation becomes one request
- `operationId` is used as the request name, then `summary`, then `METHOD /path`
- Operations grouped by `tags[0]` into folders; untagged operations go to the workspace root
- Server URL written to `base_url` environment variable; request URLs are `{{base_url}}/path`
- Parameters: `in: query` to `params`, `in: header` to `headers`, `in: path` substituted as `{{paramName}}` in the URL
- Request body: prefers `application/json`, falls back through `application/xml`, `text/plain`, `application/x-www-form-urlencoded`, `multipart/form-data`. Uses `example`/`examples` when present; otherwise generates a minimal example from the schema (max depth 5)
- `$ref` resolution: local refs (`#/components/schemas/Foo`, `#/definitions/Foo`) are resolved. Remote URL refs are skipped with a warning
- Auth schemes (`http:bearer`, `http:basic`, `apiKey`, `oauth2`) mapped to request auth; secrets written as `{{VAR_NAME}}` placeholders in a generated environment (with empty values to fill in)
- UI: "Import OpenAPI / Swagger" in the command palette or workspace menu. Enter a URL to fetch, or paste JSON/YAML. Preview shows endpoint count, tag list, and auth types before import

**Postman Collection v2.1** (`importPostmanCollection`)
- Reads the standard Postman JSON export format
- Preserves folder hierarchy, auth (basic/bearer/apikey/oauth2/awsSigV4), headers, body modes (raw/json/xml/urlencoded/formdata/binary/graphql), and variables
- Unsupported features (scripts, unknown auth types) generate warnings

**Bruno .bru folders** (`importBrunoFolder`)
- Reads a directory of `.bru` files (Bruno's INI-like format)
- Parses method blocks, headers, auth (bearer/basic), body (json/xml/text/form-urlencoded/multipart), and query/path params
- Folder hierarchy matches the directory structure

**Insomnia v4 JSON** (`importInsomniaExport`)
- Reads Insomnia v4 export files (`_type: "export"`, `__export_format: 4`)
- Walks resources by type: request, request_group, environment, cookie_jar
- Maps _id/parentId to folder tree, maps all 5 auth types
- Cookie jars and workspaces generate warnings

**HAR 1.2** (`importHar`)
- Reads Chrome DevTools HAR exports
- Each `log.entries[].request` becomes one request
- Handles JSON, XML, form, HTML, and text body types
- Skips HTTP/2 pseudo-headers

**curl** (already shipped before M9)
- Paste a curl command or import from file
- Parses -X, -H, -d, --data-*, -u, --cookie, -F, --proxy

### Export

**HAR 1.2** (`exportHar`)
- Converts history entries to HAR format
- Maps request, response, timings, and query parameters
- Round-trip tested: import then export then re-import matches

**Postman v2.1 exporter** — planned (T093)

**`.sman` bundle** — planned (T097/T098): ZIP-based portable bundle containing `.sman` files, environments, and body sidecars. See [planning/issues/sman-bundle-format.md](planning/issues/sman-bundle-format.md).

---

## Proxy and Scrape.do Mode

### Standard proxy

Configure per-request in the Settings tab:
- **Protocol**: HTTP or HTTPS
- **Host** and **Port**
- **Auth**: username + password (basic auth to the proxy)

The proxy is applied via undici's ProxyAgent.

### Scrape.do native mode

Flip the Scrape.do toggle in the Settings tab to route the request through Scrape.do's infrastructure:
- **Residential rotation** — automatic IP rotation from the residential pool
- **JS rendering** — headless browser renders the target page
- **Geo targeting** — route through a specific country
- **Ban retry** — automatic retry on detection/block responses

The main process rewrites the URL to `api.scrape.do` and injects the configured parameters. Your Scrape.do token is stored as a secret environment variable.

---

## Scraping-first features

### User-Agent presets

The Settings tab has a "User-Agent" section with a preset picker. Select a preset to change the User-Agent header sent with every request.

| Preset key | Label |
|---|---|
| `scrapeman` | Scrapeman \<version\> (default) |
| `chrome-macos` | Chrome 124 macOS |
| `chrome-windows` | Chrome 124 Windows |
| `firefox-macos` | Firefox 125 macOS |
| `firefox-windows` | Firefox 125 Windows |
| `safari-macos` | Safari 17 macOS |
| `safari-ios` | Safari 17 iOS |
| `googlebot` | Googlebot 2.1 |
| `curl` | curl 8.7 |

The selected UA string is shown as a preview below the picker. If you manually set a `User-Agent` header in the Headers tab, that value overrides the preset.

### Anti-bot detection

After every request, Scrapeman checks the response for anti-bot signals and displays a banner above the response body when one is found. The banner is dismissable and resets on the next send.

Detected signals:

| Signal | Trigger |
|---|---|
| Cloudflare | `cf-ray` header present, or HTTP 403 with Cloudflare browser-check body |
| Rate limited | HTTP 429 or `Retry-After` header |
| CAPTCHA | Body contains `hcaptcha`, `recaptcha`, `captcha-container`, or `turnstile` |
| Bot block | HTTP 403 with body matching `access denied`, `bot detected`, `automated access`, or `automated request` |

When a `Retry-After` header is present, the number of seconds to wait is shown in the banner.

Cloudflare is checked before ratelimit, ratelimit before CAPTCHA, CAPTCHA before bot block. Only one signal is shown per response.

### Rate limiting

Per-request rate limiting controls the delay the Collection Runner and Load Runner insert between requests. It has no effect on single-send.

Configure in the Settings tab under "Rate limit":
- **Fixed delay** — wait this many milliseconds after each request.
- **Jitter min / max** — add a random extra delay between min and max ms on top of the fixed delay.

Run-level delay (from the Load Runner config) and per-request rate limit stack: if the run-level delay is greater than 0, the request rate limit is not added on top.

Example: fixed delay `500ms`, jitter `0–200ms` → each request waits 500-700ms before the next.

### Rotating proxy

Supply multiple proxy URLs and let Scrapeman rotate through them automatically.

In the Settings tab, toggle "Rotate through multiple proxies" and add proxy URLs one per line. Choose a strategy:

- **Round-robin** — cycles through the list in order; the position is shared across all concurrent slots in a run.
- **Random** — picks a random proxy for each request.

When a rotate list is non-empty, the single "URL" field is ignored. If the list is empty, the single URL is used as before.

---

## Cookie Jar

Scrapeman uses `tough-cookie` (RFC 6265 compliant) for cookie management.

- Cookies survive app restarts. The jar is written to disk synchronously on every change.
- Cookies are scoped per workspace and per active environment.
- Set-Cookie headers from responses are automatically captured.
- Cookie headers are automatically injected on matching requests.

### Cookies inspector

Open the Cookies panel from the sidebar (or the keyboard shortcut) to inspect, edit, and manage the jar for the current workspace and environment.

**Filter:** Type in the domain filter at the top to narrow the list. Clearing it restores all domains.

**Add a cookie manually:** Click **+ Add** to open an inline form. Fields: name, value, domain, path (default `/`), expires (ISO date or blank for session), httpOnly, Secure, SameSite. Save inserts the cookie into the jar immediately.

**Edit a cookie:** Click any cookie row to open the same form pre-filled. Saving replaces the existing entry (delete + re-insert under the hood). The existing delete button (×) is still available on hover.

**httpOnly masking:** Cookies with `httpOnly: true` show `••••••••` for the value by default. Click the eye icon to reveal the real value.

**Export JSON:** Exports the currently visible cookies (respecting the domain filter) as a pretty-printed JSON array and triggers a browser download (`cookies.json`). The shape matches `CookieEntry` from the Scrapeman type definitions.

**Export Netscape:** Exports cookies in Netscape `cookies.txt` format (tab-separated: domain, flag, path, secure, expires, name, value). Compatible with Playwright, Selenium, and curl (`--cookie cookies.txt`).

**Import:** Click **Import** and paste either:
- A `document.cookie` string: `name1=val1; name2=val2` — you must also enter the domain these cookies belong to.
- A Netscape cookies.txt body — domain is read from each line; the domain field is ignored.

The format is detected automatically (presence of tabs signals Netscape format). Each parsed cookie is inserted into the jar immediately.

---

## In-App Git Integration

A VS Code-style git panel built on simple-git:

- **Status bar**: current branch name shown at the bottom of the window.
- **Source Control panel**: staged/unstaged file list in the sidebar.
- **Stage/unstage**: individual files or all at once.
- **Commit**: write a message and commit from the UI.
- **Push/Pull**: uses OS credential store (no SSH key management UI). Pull defaults to fast-forward; if branches have diverged a dialog prompts you to choose **Rebase** or **Merge commit**.
- **Diff viewer**: click a changed file to see a line-by-line diff (green/red, VS Code style).
- **Per-request sync toggle**: `Cmd+Shift+H` to exclude a request from git tracking.

---

## Collection Search

The sidebar has a search input at the top of the collection tree.

- **Real-time filter**: type and the tree filters instantly (case-insensitive, substring match on request name and URL).
- **Method prefix**: type `GET /users` to filter by method and name/URL together.
- **Folder behavior**: folders with zero matching descendants auto-hide. Matched folders auto-expand.
- **Shortcuts**: `Cmd+Shift+F` focuses the search from anywhere. `Cmd+F` focuses it when the sidebar has focus. `Escape` clears the filter and returns focus to the tree.
- **Empty state**: "No requests match" message with a clear-filter button.

---

## Keyboard Shortcuts

All shortcuts use `Cmd` on macOS and `Ctrl` on Windows/Linux.

### Global

| Shortcut | Action |
|---|---|
| `Cmd+N` | New tab (auto-focuses URL bar) |
| `Cmd+T` | New tab |
| `Cmd+W` | Close active tab (with dirty guard) |
| `Cmd+Shift+W` | Close all tabs (with dirty guard) |
| `Cmd+Enter` | Send request |
| `Cmd+S` | Save request |
| `Cmd+Shift+F` | Focus collection search |
| `Cmd+Shift+H` | Toggle git sync on active request |

### Tab management

| Shortcut | Action |
|---|---|
| Middle-click on tab | Close tab (with dirty guard) |
| `Cmd+1` through `Cmd+9` | Switch to tab N |

### Command palette

Open with `Cmd+K`. Type to filter any listed command.

| Command | Action |
|---|---|
| Add URL parameter | Switch to Params tab, focus the first empty Key cell (adds a row if all rows are filled) |

### Headers/Params table

| Shortcut | Action |
|---|---|
| `Shift+Enter` | Insert new row below, focus Key cell |
| `Tab` (from last row Key) | Auto-append new row |
| `Tab` into empty table | Create first row and focus its Key cell |

### Dirty tab guard

When closing a tab with unsaved changes (any close method: Cmd+W, middle-click, close button, context menu, Cmd+Shift+W):
- A confirmation dialog shows the tab name and asks to save, discard, or cancel.
- **"Don't ask again for this session"** checkbox: when checked, subsequent dirty closes discard immediately. Resets on app restart.

---

## UX Details

### HTTP engine

- Built on **undici 7** (Node.js official HTTP client).
- **HTTP/1.1 and HTTP/2**: toggle via `allowH2` in per-request settings. Uses ALPN negotiation.
- **All HTTP methods**: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, and custom verbs (PROPFIND, QUERY, etc.).
- **Timeouts**: connect, read, and total timeouts with AbortSignal cancellation.
- **Response body cap**: 200 MB max.
- **Auto-decompression**: gzip, brotli, and deflate responses decode automatically via Accept-Encoding.

### Tabs

- Method badge on each tab (GET green, POST blue, PUT yellow, DELETE red).
- Dirty indicator (dot) on unsaved tabs.
- Middle-click to close.
- Resizable + orientable split: toggle between horizontal and vertical layout, persisted in localStorage.

### Fonts

- **Inter** (variable) — UI text
- **Geist Mono** — code blocks, URL bar, response body, terminal-style panels

### Theme

- Dark mode with CSS custom properties.
- System preference fallback.
- Design tokens: `--bg-white-0` through `--bg-sub-300`, `--text-strong-950` through `--text-disabled-300`, `--primary-base` (#FF6C37, Scrape.do orange), `--success-base`, `--error-base`.

---

## Stack

- **Electron 33** + **Vite** (via electron-vite) + **React 18** + **TypeScript 5**
- **Tailwind CSS** + **Radix UI** primitives (ContextMenu, Dialog, DropdownMenu, Tooltip)
- **Zustand** for renderer state
- **undici 7** for HTTP (ProxyAgent, allowH2, AbortSignal)
- **tough-cookie 5** for RFC 6265 cookie jar
- **yaml** for file format parse (custom deterministic serializer)
- **aws4** for Signature v4 signing
- **chokidar 4** for workspace file watching
- **pnpm workspaces** monorepo

---

## License

Apache 2.0. See [LICENSE](LICENSE). The name "Scrapeman" and the Scrape.do logo are trademarks of Scrape.do and are not covered by the license.
