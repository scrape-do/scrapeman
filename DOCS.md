# Scrapeman Documentation

Complete reference for every feature in Scrapeman. For installation and project overview, see the [README](README.md).

---

## Table of Contents

- [Getting Started](#getting-started)
- [Request Building](#request-building)
- [Environment Variables](#environment-variables)
- [Auth Schemes](#auth-schemes)
- [Collections and File Format](#collections-and-file-format)
- [Local History](#local-history)
- [Response Viewer](#response-viewer)
- [Code Export](#code-export)
- [Load Runner](#load-runner)
- [Import and Export](#import-and-export)
- [Proxy and Scrape.do Mode](#proxy-and-scrapedo-mode)
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
2. The file is written to your workspace folder as a `.req.yaml` file.
3. The request appears in the sidebar collection tree.

---

## Request Building

### URL bar

The URL bar supports `{{var}}` syntax with live highlighting. Variables resolve from the active environment, collection variables, and built-in dynamics.

An autocomplete popover appears when you type `{{` showing all available variables with their current resolved values.

### Tabs

- **Params** — key-value table with two-way URL sync. Editing a param updates the URL query string and vice versa.
- **Headers** — key-value table. Auto-headers (Content-Type, Accept-Encoding, User-Agent) are shown with a toggle to disable or override each one.
- **Body** — modes: none, raw (JSON, XML, HTML, text, JavaScript), form-urlencoded, multipart form-data, binary file, GraphQL (planned).
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

**Scope precedence** (highest to lowest):
1. Per-request overrides
2. Active environment
3. Collection-level variables
4. Built-in dynamics

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

### OAuth 2.0 Client Credentials

Configure:
- **Token URL** — the authorization server endpoint
- **Client ID** and **Client Secret**
- **Scope** (optional)

Scrapeman fetches the token automatically before sending the request. Tokens are cached until they expire, then refreshed in the background. Concurrent requests share one in-flight token fetch (no hammering the token endpoint).

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

Every request is one `.req.yaml` file:

```yaml
# products/list.req.yaml
method: GET
url: "https://api.example.com/products?page={{page}}"
headers:
  - key: Accept
    value: application/json
    enabled: true
auth:
  type: bearer
  token: "{{token}}"
```

Key order is stable (deterministic serializer), so git diffs are clean and human-readable.

### Body sidecars

Payloads 4KB or larger are automatically promoted to a sidecar file under `files/<slug>.body.<ext>`. The `.req.yaml` references the sidecar by path. This keeps YAML files small and diffs focused on metadata changes.

### Workspace folder

Scrapeman writes only inside the workspace folder you choose. History, cookies, and state live in the app data directory, never the workspace. The workspace is safe to commit to git.

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

Scrapeman auto-detects the response content type: JSON, HTML, XML, image, PDF, text, or binary.

### View modes per content type

| Content type | Available modes |
|---|---|
| JSON | Raw, Pretty (formatted), Tree (collapsible with JSONPath copy) |
| HTML | Raw, Pretty, Preview (sandboxed iframe) |
| XML | Raw, Pretty |
| Image | Raw (hex), Preview (rendered) |
| PDF | Raw, Preview (Chromium PDF viewer) |
| Text/binary | Raw |

**Lazy parsing**: the default view is Raw. JSON.parse and tree rendering only happen when you switch to Pretty or Tree view.

### Response body search

Search within the response body with highlight, previous/next navigation. The search persists across sends and auto-re-runs when a new response arrives.

### Metrics

Every response shows: HTTP status, TTFB (time to first byte), download time, body size, and protocol (HTTP/1.1 or h2).

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

### Live metrics

While running, you see:
- Sent / remaining / requests per second
- Latency: p50, p95, p99
- Success rate
- Status histogram (200, 201, 400, 500, ...)
- Error kind breakdown (timeout, connection refused, etc.)

### Response validator

Set expected status codes (e.g., `200, 201`) and an optional body-contains substring. Requests that fail validation are flagged in the console log.

### Controls

- **Stop** mid-run with partial results preserved.
- Console log with color-coded rows: green for success, yellow for validation fail, red for network error.

---

## Import and Export

### Import from other tools

Scrapeman reads collections from four formats:

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

**`.sman` bundle** — planned (T097/T098): ZIP-based portable bundle containing `.req.yaml` files, environments, and body sidecars. See [planning/issues/sman-bundle-format.md](planning/issues/sman-bundle-format.md).

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

## Cookie Jar

Scrapeman uses `tough-cookie` (RFC 6265 compliant) for cookie management.

- Cookies survive app restarts. The jar is written to disk on every change.
- Cookies are scoped per workspace and environment.
- The Cookies inspector (in the sidebar) shows all stored cookies with domain, path, expiry, and flags.
- Set-Cookie headers from responses are automatically captured.
- Cookie headers are automatically injected on matching requests.

---

## In-App Git Integration

A VS Code-style git panel built on simple-git:

- **Status bar**: current branch name shown at the bottom of the window.
- **Source Control panel**: staged/unstaged file list in the sidebar.
- **Stage/unstage**: individual files or all at once.
- **Commit**: write a message and commit from the UI.
- **Push/Pull**: uses OS credential store (no SSH key management UI).
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

### Headers/Params table

| Shortcut | Action |
|---|---|
| `Shift+Enter` | Insert new row below, focus Key cell |
| `Tab` (from last row Key) | Auto-append new row |

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
