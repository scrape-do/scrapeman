<p align="center">
  <img src="https://github.com/scrape-do.png" alt="scrape-do" width="96" height="96" />
</p>

<h1 align="center">Scrapeman</h1>

<p align="center">
  <strong>Postman-grade API client for every developer</strong><br/>
  Local-first · git-friendly collections · built-in load testing · unlimited history
</p>

<p align="center">
  <a href="https://scrape.do"><img alt="Built for scrape-do" src="https://img.shields.io/badge/built%20for-scrape--do-FF6C37?style=for-the-badge&labelColor=0b0d10" /></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-0CBB52?style=for-the-badge" /></a>
  <img alt="Electron" src="https://img.shields.io/badge/electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-159%20passing-0CBB52?style=for-the-badge" />
</p>

---

**Scrapeman** is an API client for every developer who wants Postman's paid features for free. It keeps everything on your machine, treats your filesystem + git as the source of truth, and ships first-class proxy support for the scraping use case.

## Why not just use Postman / Bruno / Insomnia?

| | Postman | Bruno | Insomnia | **Scrapeman** |
|---|---|---|---|---|
| Unlimited history | ❌ (paid) | ❌ | ❌ (cloud) | ✅ local JSONL |
| Unlimited env vars | ❌ (paid) | ✅ | ✅ | ✅ |
| Unlimited collection runs | ❌ (paid) | ✅ | ✅ (paid) | ✅ (load runner) |
| Native scrape-do proxy mode | ❌ | ❌ | ❌ | ✅ first-class |
| Local-first / no cloud sync | ❌ | ✅ | ❌ | ✅ |
| Git-friendly file format | ❌ | ✅ | ❌ | ✅ YAML, one file per req |
| HTTP/2 toggle | ✅ | ❌ | ❌ | ✅ (undici `allowH2`) |
| Single-request load testing | ❌ | ❌ | ❌ | ✅ with validator |
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

### Request building
- URL bar with `{{var}}` syntax highlighting (overlay technique)
- **Params** tab with two-way URL ↔ params sync
- **Headers** / **Auth** / **Body** / **Settings** / **Code** tabs
- Per-request settings: proxy, timeout, redirect, TLS, HTTP version, scrape-do native mode
- `{{var}}` autocomplete popover — env variables + built-in dynamics (`{{random}}`, `{{timestamp}}`, `{{isoDate}}`, `{{randomInt}}`)
- Right-click cell context menu: URL/Base64 encode-decode, copy, paste, clear

### Auth helpers
- None / Basic / Bearer / API Key (header or query)
- OAuth 2.0 client credentials (with token cache + auto-refresh)
- AWS Signature v4 (via `aws4`)
- OAuth 2.0 authorization code flow — planned

### Environment variables
- Per-workspace environments stored as `.env.yaml` files under `.scrapeman/environments/`
- Secret flag with masked display
- Active environment persisted in workspace state
- `{{var}}` resolution across URL, params, headers, body, auth, proxy, scrape-do fields
- Built-in dynamic variables fresh per send: `{{random}}`, `{{uuid}}`, `{{timestamp}}`, `{{timestampSec}}`, `{{isoDate}}`, `{{randomInt}}`

### Collections & file format
- Custom YAML format (`*.req.yaml`), one file per request, stable key order → clean git diffs
- Body sidecar: payloads >= 4KB auto-promoted to `files/<slug>.body.<ext>`
- Variable + collection tree lives in a user-chosen workspace folder — scrapeman never writes outside it
- Live file-watcher (chokidar) reloads external edits with self-write suppression

### Local history
- Every sent request captured to a per-workspace JSONL file under app data dir (never the workspace)
- **Template-preserving**: `{{token}}` stays as `{{token}}` on disk — no secrets baked in
- **gzipped**: body preview fields compressed on disk when >= 256 bytes (typical 5-10× smaller)
- Restore to new tab with one click, dedup if already restored
- Sidebar panel with clear/delete, method badges, status pills, relative time
- Cookies inspector (workspace × env scoped via `tough-cookie`)

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

### Import/export (in progress)
- curl command (paste or file) — done
- Postman Collection v2.1 — planned (M9)
- Bruno `.bru` folder trees — planned
- Insomnia v4 JSON — planned
- HAR import/export — planned

### UX essentials
- Tabs with method badges, dirty indicator, middle-click close
- Resizable + orientable split (horizontal ↔ vertical, persistent)
- Resizable sidebar + history panel
- Dark mode with CSS variable tokens, system preference fallback
- Cross-platform keyboard shortcuts: ⌘T new tab, ⌘W close, ⌘↵ send, ⌘S save (with draft save-as flow)
- Postman-light design system, Inter + JetBrains Mono fonts

## Install

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
  2. `composeScrapeDoRequest` — rewrite URL to api.scrape.do if native mode on
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

- **M0–M6** ✅ Scaffold, HTTP engine, collections, env vars, auth, proxy + scrape-do, cookie jar + HTTP/2
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
4. **scrape-do native.** Proxy-first mindset. `{{var}}` + per-request proxy + load runner are the things our users need daily.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 scrape-do.

The name "Scrapeman" and the scrape-do logo are trademarks of scrape-do and
are not covered by the license — see Section 6 of the Apache License.

## Contributing

Issues and PRs welcome. See [`.github/pull_request_template.md`](.github/pull_request_template.md) for the PR checklist. By submitting a contribution you agree to license it under Apache 2.0.

---

<p align="center">
  Made with ❤️, ☕ and a lot of <strong>vibe-coding</strong> by humans + AI<br/>
  <sub>at <a href="https://scrape.do">scrape.do</a> — the scraping infrastructure of the internet</sub>
</p>

<p align="center">
  <sub>
    <em>No tabs were harmed in the making of this app.<br/>
    {{token}} stays {{token}} on disk. We promise.</em>
  </sub>
</p>
