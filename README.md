<p align="center">
  <img src="assets/logos/scrapeman-mark.svg" alt="Scrapeman" width="96" height="96" />
</p>

<h1 align="center">Scrapeman</h1>

<p align="center">
  <strong>The unlimited API client</strong><br/>
  Local-first · git-friendly collections · built-in load testing · unlimited history
</p>

<p align="center">
  <sub>by <a href="https://scrape.do">Scrape.do</a></sub>
</p>

<p align="center">
  <a href="https://scrape.do"><img alt="Built by Scrape.do" src="https://img.shields.io/badge/built%20by-Scrape.do-FF6C37?style=for-the-badge&labelColor=0b0d10" /></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-0CBB52?style=for-the-badge" /></a>
  <img alt="Electron" src="https://img.shields.io/badge/electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-196%20passing-0CBB52?style=for-the-badge" />
</p>

---

## About

**Scrapeman** is an open-source desktop API client built by **Scrape.do** to give every developer Postman's paid features for free. It keeps everything on your machine, treats your filesystem + git as the source of truth, and ships first-class proxy support so the scraping use case is a one-toggle affair instead of a side plugin.

Apache 2.0, runs offline on macOS, Windows, and Linux. No account. No cloud sync. No paywall.

**[Full documentation](DOCS.md)** — every feature, every shortcut, every config option in one file.

## Useful resources

The full marketing site lives at **[scrapeman.app](https://scrapeman.app)** and breaks the project down by what it replaces and how:

- **[scrapeman.app](https://scrapeman.app/)** — the pitch in 30 seconds
- **[/features](https://scrapeman.app/features)** — every feature broken down into one-liners
- **[/postman-alternative](https://scrapeman.app/postman-alternative)** — Postman caps free history at 25 requests, locks OAuth2 behind $19/seat, and syncs collections to its cloud. Scrapeman ships every paid feature for free
- **[/bruno-alternative](https://scrapeman.app/bruno-alternative)** — Bruno is great for git-friendly collections but has open bugs blocking real work (SSE hangs #7083, large-response crashes #7624, cookies dropping #6903, OAuth2 race #7565). Scrapeman fixes all four
- **[/insomnia-alternative](https://scrapeman.app/insomnia-alternative)** — Kong acquired Insomnia in 2023 and forced cloud sync. Scrapeman is the Apache 2.0 alternative no acquisition can change
- **[/hoppscotch-alternative](https://scrapeman.app/hoppscotch-alternative)** — Hoppscotch is web-based. Scrapeman is a native desktop app with git-friendly YAML, native proxy, a built-in load runner, and every auth flow free
- **[/yaak-alternative](https://scrapeman.app/yaak-alternative)** — Yaak is a great desktop client. Scrapeman is the Apache 2.0 alternative with native Scrape.do proxy support, a built-in load runner, and the backing of a funded company

## Why not just use Postman / Bruno / Insomnia?

| | Postman | Bruno | Insomnia | **Scrapeman** |
|---|---|---|---|---|
| Unlimited history | ❌ (paid) | ❌ | ❌ (cloud) | ✅ local JSONL |
| Unlimited env vars | ❌ (paid) | ✅ | ✅ | ✅ |
| Unlimited collection runs | ❌ (paid) | ✅ | ✅ (paid) | ✅ (load runner) |
| Native Scrape.do proxy mode | ❌ | ❌ | ❌ | ✅ first-class |
| Local-first / no cloud sync | ❌ | ✅ | ❌ | ✅ |
| Git-friendly file format | ❌ | ✅ | ❌ | ✅ YAML, one file per req |
| HTTP/2 toggle | ✅ | ❌ | ❌ | ✅ (undici `allowH2`) |
| Single-request load testing | ❌ | ❌ | ❌ | ✅ with validator |
| WebSocket client | ✅ (paid) | ❌ | ✅ | ✅ bidirectional timeline |
| Response body search + highlight | ✅ | ❌ | ✅ | ✅ auto re-run |
| `{{var}}` autocomplete | ✅ | ❌ | ❌ | ✅ with built-ins |
| Dark mode | ✅ | ✅ | ✅ | ✅ (CSS variables) |
| Electron UI polish | ✅ | ⚠️ clunky | ✅ | ✅ Radix + Postman light |

## Features

### HTTP engine (undici)
- All HTTP methods including custom verbs (`PROPFIND`, `QUERY`, …)
- HTTP/1.1 and HTTP/2 (`allowH2` toggle via ALPN negotiation)
- Proxy: HTTP / HTTPS with basic auth (SOCKS5 planned)
- Timeouts: connect / read / total with AbortSignal cancellation
- 200 MB response body cap, TTFB + download latency measurement
- Dev Tools tab: timing waterfall, sent URL/headers, redirect chain, TLS cert info, remote IP

### Request building
- URL bar with `{{var}}` syntax highlighting (overlay technique)
- **Params** tab with two-way URL ↔ params sync
- **Headers** / **Auth** / **Body** / **Settings** / **Code** tabs
- Per-request settings: proxy, timeout, redirect, TLS, HTTP version, Scrape.do native mode
- `{{var}}` autocomplete popover — env variables + built-in dynamics (`{{random}}`, `{{timestamp}}`, `{{isoDate}}`, `{{randomInt}}`)
- Right-click cell context menu: URL/Base64 encode-decode, copy, paste, clear

### Auth helpers
- None / Basic / Bearer / API Key (header or query)
- OAuth 2.0 client credentials — token cache, auto-refresh, concurrent-dedup
- OAuth 2.0 authorization code — browser-based flow with local loopback callback, state validation
- OAuth 2.0 authorization code + PKCE — S256 code_challenge, no client secret required
- OIDC discovery — loads Token URL + Auth URL from `.well-known/openid-configuration`
- Access-token placement: Authorization header (default), query param, or form body field
- JWT token inspector — decodes header + payload, live `exp` countdown (display only, no signature check)
- AWS Signature v4 (via `aws4`)

### Environment variables and scoped variables
- Per-workspace environments stored as `.env.yaml` files under `.scrapeman/environments/`
- Secret flag with masked display
- Active environment persisted in workspace state
- `{{var}}` resolution across URL, params, headers, body, auth, proxy, Scrape.do fields
- Built-in dynamic variables fresh per send: `{{random}}`, `{{uuid}}`, `{{timestamp}}`, `{{timestampSec}}`, `{{isoDate}}`, `{{randomInt}}`
- **Global variables** (`.scrapeman/globals.yaml`) — lowest precedence, available across all environments
- **Collection variables** (`.scrapeman/collection.yaml`) — workspace-wide defaults with optional default auth
- **Folder variables and auth** (`_folder.yaml` per folder) — per-folder variable overrides and auth inheritance
- Variable precedence (highest wins): folder chain → environment → collection → global

### Collections & file format
- Custom YAML format (`*.sman`), one file per request, stable key order → clean git diffs (legacy `*.req.yaml` files remain readable and are migrated to `.sman` on next save)
- Body sidecar: payloads >= 4KB auto-promoted to `files/<slug>.body.<ext>`
- Variable + collection tree lives in a user-chosen workspace folder — scrapeman never writes outside it
- **Multiple workspaces**: open several workspaces in one window and switch between them from the sidebar header. Open tabs, active environment, and sidebar view per workspace are remembered while the app runs; the open-list persists across restarts
- Live file-watcher (chokidar) reloads external edits with self-write suppression
- **Per-request sync toggle**: right-click a request → "Stop syncing to git" to keep it local only. Backed by `.git/info/exclude` (never pushed) + `git rm --cached`, so teammates never see it. `⌘⇧H` toggles on the active tab. A crossed-eye icon marks unsynced requests in the sidebar and on the tab. If you later `git add` the file yourself, scrapeman notices and the icon clears automatically
- **Pull**: supports fast-forward, rebase, and merge strategies. If local and remote branches have diverged, a dialog prompts you to choose Rebase or Merge commit before proceeding.

### Local history
- Every sent request captured to a per-workspace JSONL file under app data dir (never the workspace)
- **Template-preserving**: `{{token}}` stays as `{{token}}` on disk — no secrets baked in
- **gzipped**: body preview fields compressed on disk when >= 256 bytes (typical 5-10× smaller)
- Restore to new tab with one click, dedup if already restored
- Sidebar panel with clear/delete, method badges, status pills, relative time
- Cookies inspector (workspace × env scoped via `tough-cookie`) — filter by domain, add/edit cookies manually, httpOnly masking with reveal toggle, export JSON or Netscape cookies.txt, import from `document.cookie` string or cookies.txt

### Scraping-first features
- **User-Agent presets** — 9 presets (Scrapeman, Chrome 124 macOS/Windows, Firefox 125 macOS/Windows, Safari 17 macOS/iOS, Googlebot, curl). Custom UA in the Headers tab always overrides.
- **Anti-bot detection** — banner above the response body on Cloudflare challenges, HTTP 429, CAPTCHA markers, and generic bot-block pages. Includes Retry-After countdown. Dismissable per response.
- **Rate limiting** — per-request `fixedDelayMs` + optional random jitter range applied by the Collection Runner and Load Runner between requests. No-op on single send.
- **Rotating proxy** — supply a list of proxy URLs with round-robin or random strategy. Collection Runner rotates per request; Load Runner rotates per concurrent slot.

### Response viewer
- Content-kind detection: JSON / HTML / XML / image / PDF / text / binary
- Per-kind view modes:
  - **JSON**: Raw / Pretty / Tree (collapsible with JSONPath copy)
  - **HTML**: Raw / Pretty / Preview (sandboxed iframe)
  - **XML**: Raw / Pretty
  - **Image**: Raw / Preview (data URL)
  - **PDF**: Raw / Preview (Chromium PDF viewer)
- **Lazy parse** — Raw default, JSON.parse only when user picks Tree/Pretty
- **Response body search** with highlight, prev/next navigation, persists across sends (auto re-runs)
- Status / TTFB / download / size / protocol metrics

### Code export
- Hand-written generators (fast, dependency-free): curl, JS fetch, Python requests, Go net/http
- Respects method, URL, params, headers, body, basic/bearer auth
- Toggle **inline variables** vs **keep `{{var}}` templates**
- Full 20+ language support via `postman-code-generators` — planned

### Load runner
- Single-request stress testing with bounded concurrency
- Live metrics: sent/total, RPS, success rate, p50/p95/p99 latency, inflight
- Per-iteration variable resolution — `{{random}}` and `{{timestamp}}` fresh every call
- **Built-in response validator**: expected status codes + body-contains substring
- Console log with success/validation-fail/network-error color coding
- Status histogram + error kind breakdown
- Stop mid-run with AbortSignal, partial results preserved
- **Per-tab isolation** — start a load test in one tab, switch to another, come back — your config and progress are preserved. Hover any metric for a description.

<<<<<<< HEAD
### WebSocket client
- Full bidirectional messaging from a "WebSocket" pane on any tab
- Live timeline: each message shows direction arrow (↓ in / ↑ out), timestamp, and payload
- JSON payloads expand inline with the existing tree viewer
- Auto-scroll to bottom; scrolling up pauses auto-scroll and a button resumes it
- Application-level ping/pong with round-trip latency tracking
- Per-connection proxy support (standard HTTP proxy or Scrape.do WS proxy)
- Export full timeline as JSON
- Connection state persists when switching tabs — switch away and back without losing messages
=======
### Collection runner
- Run an entire folder of requests as a sequence or in parallel
- **Sequential** mode: each request fires and waits for its response before the next starts
- **Parallel** mode: up to N requests in flight simultaneously (configurable concurrency)
- Delay between requests (ms) for rate-limiting scraping workflows
- Iterations: repeat the whole collection N times
- **Data-driven iterations** via CSV upload — header row defines variable names, each data row becomes one iteration's variable bag (merged on top of the active environment)
- Incremental results list with pass/fail icons, status codes, durations, and expandable request/response details
- Abort mid-run; partial results are preserved
- Export report as **JSON**, **CSV**, or self-contained **HTML**
- Opens from any folder's right-click context menu ("Run folder…")
>>>>>>> ed92491 (feat: collection runner — sequential/parallel, CSV iterations, JSON/CSV/HTML export)

### Import/export
- curl command (paste or file)
- OpenAPI 3.0.x / 3.1.x and Swagger 2.0 (JSON or YAML, URL or paste; groups by tag, generates environment with auth variable stubs)
- Postman Collection v2.1 (folder hierarchy, auth, variables, body modes)
- Bruno `.bru` folder trees (INI-like format, auth, body, params)
- Insomnia v4 JSON (resources, folder tree, auth, environments)
- HAR 1.2 import + export (Chrome DevTools format, round-trip tested)
- `.sman` collection bundle (ZIP-based portable format) — planned

### UX essentials
- Tabs with method badges, dirty indicator, middle-click close
- Resizable + orientable split (horizontal ↔ vertical, persistent)
- Resizable sidebar + history panel
- Dark mode with CSS variable tokens, system preference fallback
- Cross-platform keyboard shortcuts: ⌘T new tab, ⌘W close, ⌘↵ send, ⌘S save (with draft save-as flow), ⌘⇧H toggle git-sync on active request
- Postman-light design system, Inter + Geist Mono fonts

## Install

### macOS (Homebrew, recommended)

```bash
brew tap scrape-do/scrapeman && brew install --cask scrapeman
```

Taps `scrape-do/homebrew-scrapeman` on the first run, then installs the
cask, which picks the right DMG for your arch (arm64 or x64) and drops
Scrapeman into `/Applications`. Future releases bump the cask automatically
via the `bump-cask` job in `.github/workflows/release.yml`, so
`brew upgrade --cask scrapeman` keeps you current.

### Direct downloads

Pre-built installers are published on the [Releases page](https://github.com/scrape-do/scrapeman/releases) for every tagged version:

- **macOS** — `.dmg` (Apple Silicon + Intel)
- **Windows** — `.exe` NSIS installer (x64)
- **Linux** — `.AppImage` and `.deb` (x64)

> Builds are currently **ad-hoc signed but not notarized**. First-launch friction:
>
> - **macOS:** right-click the app in Applications → **Open** → confirm "Open" in the Gatekeeper prompt. After that it launches normally.
>   If you see *"App is damaged"* (only the very first v0.1.0 release had this), open Terminal and run:
>   ```bash
>   sudo xattr -cr /Applications/Scrapeman.app
>   sudo codesign --force --deep --sign - /Applications/Scrapeman.app
>   ```
>   v0.1.1+ ships with the build-time ad-hoc signing fix and doesn't need this.
> - **Windows:** SmartScreen → **More info** → **Run anyway**.
> - **Linux:** `chmod +x` the AppImage, or `sudo dpkg -i` the deb.
>
> Real Developer ID signing + Apple notarization + Windows EV cert are tracked in M10 release polish.

To produce a release locally:

```bash
pnpm install
pnpm run build:packages
pnpm --filter=@scrapeman/desktop dist          # current platform
pnpm --filter=@scrapeman/desktop dist:mac      # mac dmg (arm64 + x64)
pnpm --filter=@scrapeman/desktop dist:win      # windows exe
pnpm --filter=@scrapeman/desktop dist:linux    # AppImage + deb
```

Output lands in `apps/desktop/release/`.

## Stack

- **Electron 33** + **Vite** (via `electron-vite`) + **React 18** + **TypeScript 5**
- **Tailwind CSS** + **Radix UI** primitives (ContextMenu, Dialog, DropdownMenu, Tooltip)
- **Zustand** for renderer state
- **undici 7** for HTTP (ProxyAgent, allowH2, AbortSignal)
- **tough-cookie 5** for RFC 6265 cookie jar
- **yaml** for file format parse (custom deterministic serializer)
- **aws4** for Signature v4 signing
- **chokidar 4** for workspace file watching
- **pnpm workspaces** monorepo

## Monorepo layout

```
scrapeman/
├── packages/
│   ├── shared-types/       # @scrapeman/shared-types — typed IPC contract
│   └── http-core/          # @scrapeman/http-core — engine, runner, parsers, codegen
├── apps/
│   └── desktop/            # @scrapeman/desktop — Electron shell
├── planning/               # living roadmap + specs
│   ├── session-state.md    # start here for current status
│   ├── vision.md
│   ├── scope.md
│   ├── architecture.md
│   ├── file-format.md
│   ├── milestones.yaml
│   ├── tasks.yaml
│   └── postman-parity.md
├── .github/workflows/      # CI (mac + linux + windows)
└── README.md
```

## Development

```bash
# Prereqs: Node 20+, pnpm 10+
pnpm install

# Dev — runs 3 concurrent watchers (types / core / desktop)
pnpm dev

# Type-check everything
pnpm -r typecheck

# Run tests (vitest, 125 tests across 12 files)
pnpm -r test

# Production build
pnpm -r build
```

### Project commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start Electron app with hot reload across all packages |
| `pnpm -r test` | Run all vitest suites |
| `pnpm -r test:watch` | Vitest watch mode |
| `pnpm -r typecheck` | tsc --noEmit across all packages |
| `pnpm -r build` | Production build (all packages + electron-vite) |
| `pnpm run build:packages` | Build only publishable packages |
| `pnpm format` | Prettier on the whole tree |

## Architecture highlights

- **RequestExecutor interface** is the seam between HTTP engine and the rest of the app. Only `UndiciExecutor` exists today; HTTP/3 or a custom adapter could slot in without UI changes.
- **Main process execution pipeline** (order matters):
  1. `resolveRequest` — substitute `{{var}}` including built-in dynamics
  2. `composeScrapeDoRequest` — rewrite URL to `api.scrape.do` if Scrape.do native mode is on
  3. `signAwsSigV4` — sign if auth type is SigV4
  4. `OAuth2Client.getToken` — fetch + cache bearer if auth type is OAuth2
  5. `applyAuth` — inject Authorization / API Key headers
  6. Cookie jar — inject `Cookie` header from persistent store
  7. `executor.execute` — wire HTTP with proxy + HTTP/2 + timeout + redirect
  8. Set-Cookie capture — update jar from response
  9. History insert — stores **original** request (templates preserved)
- **History is template-preserving** — the unresolved request is written to disk so secrets and `{{random}}` stay dynamic per replay.
- **File format is custom YAML** emitted by a deterministic serializer (stable key order → clean git diffs). Parsing goes through the `yaml` library then through a hand-written type check.

See [`planning/architecture.md`](planning/architecture.md) for all key decisions (D1–D8).

## Roadmap

Live in [`planning/milestones.yaml`](planning/milestones.yaml) with task-level detail in [`planning/tasks.yaml`](planning/tasks.yaml). High-level:

- **M0–M6** ✅ Scaffold, HTTP engine, collections, env vars, auth, proxy + Scrape.do, cookie jar + HTTP/2
- **M7** 🔵 Full code generation (20+ langs via postman-code-generators)
- **M8** 🟡 UX polish — dark mode ✅, response search ✅, JSON tree ✅, timings ✅, virtual-scroll history + large-response streaming pending
- **M9** 🔵 Import/export (Postman v2.1 / Bruno / Insomnia / HAR)
- **M10** 🔵 Packaging — signed mac / win / linux installers, auto-update
- **M11** 🟡 Load runner — MVP ✅, chart + export pending

Feature parity tracking vs Postman in [`planning/postman-parity.md`](planning/postman-parity.md).

## Design principles

1. **Local-first.** Nothing ever leaves your machine unless you explicitly commit collections to a git remote. History is never synced.
2. **Git-friendly.** Collections live as human-readable YAML with stable key order. Secrets (history, cookies, state) live in app data dir and never touch the workspace folder.
3. **Postman-grade polish.** Feel fast, feel stable. Radix primitives, CSS-variable theming, keyboard-accessible everywhere.
4. **Scrape.do native.** Proxy-first mindset. `{{var}}` + per-request proxy + load runner are the things our users need daily.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 Scrape.do.

The name "Scrapeman" and the Scrape.do logo are trademarks of Scrape.do and
are not covered by the license — see Section 6 of the Apache License.

## Contributing

Issues and PRs welcome. See [`.github/pull_request_template.md`](.github/pull_request_template.md) for the PR checklist. By submitting a contribution you agree to license it under Apache 2.0.

---

<p align="center">
  Made with ❤️, ☕ and a lot of <strong>vibe-coding</strong> by humans + AI<br/>
  <sub>at <a href="https://scrape.do">Scrape.do</a> — the scraping infrastructure of the internet</sub>
</p>

<p align="center">
  <sub>
    <em>No tabs were harmed in the making of this app.<br/>
    {{token}} stays {{token}} on disk. We promise.</em>
  </sub>
</p>
