# Changelog

All notable changes land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.5.0] — 2026-04-26

Big-feature release. Eleven previously-open issues land in this cut.

### Added
- **WebSocket client** (#24). New `WebSocketPanel` mounted as a builder pane: URL bar, status dot, connect/disconnect, message timeline with ↓ / ↑ / ● / ○ row badges, JSON expand, send box, auto-scroll toggle, export timeline as JSON. Core wraps undici's WebSocket with reconnect, ping latency, per-connection proxy, and a shared timeline. Per-tab `Tab.websocket` state survives tab switches.
- **Collection runner** (#21). New `RunnerPanel` (Radix dialog, opened from sidebar folder context-menu "Run folder…"). Sequential or parallel modes with concurrency, per-request delay, optional iterations, CSV-driven iteration. Live pass/fail rows with expand-for-details, abort mid-run. Export the run as JSON, CSV, or HTML.
- **Cookie manager UI** (#23). Domain filter, manual add / inline edit, httpOnly value masking with reveal toggle, JSON + Netscape exports, paste-import that accepts both `document.cookie` strings and Netscape `cookies.txt` bodies. New `cookies:set` IPC backed by `WorkspaceCookieJar.setCookie`.
- **OpenAPI / Swagger import** (#27). Parse OpenAPI 3.0.x / 3.1.x and Swagger 2.0 from file or URL. Tags become folders, paths/methods become requests, security schemes become auth, server URLs go to `{{base_url}}`. Local `$ref` resolved one hop. New `ImportOpenApiDialog` and command-palette entry.
- **Pre-request / post-response scripts** (#20). Node `vm` sandbox with a `bru` API (`getVar` / `setVar` / `getEnvVar` / `setEnvVar` / `sendRequest` / built-in dynamics), `req` mutable proxy, `res` read-only proxy with auto-JSON body parse, captured `console.*`, minimal `test()` / `expect().toBe()`. New Scripts pane with two CodeMirror editors and a Scripts response tab that renders the console + assertion failures. Scripts round-trip through `.sman` as YAML literal blocks.
- **Multi-workspace Phase 1** (#61). `WorkspaceSwitcher` dropdown above the sidebar tab strip lists every open workspace with active check and per-row close. Switching snapshots the previous workspace's UI state (tabs, activeTabId, closedTabStack, activeEnvironment, responseSearch) and restores the destination's snapshot. `openWorkspaces` and `lastActiveWorkspace` persist to localStorage.
- **Dev Tools panel** (#28). New response tab next to Body / Headers: timing waterfall (DNS / TCP / TLS / TTFB / Download), the actual sent URL and headers (post variable resolve, scrape-do compose, auth), redirect chain with statuses + Location, TLS peer cert (subject CN, issuer CN, validFrom / validTo, fingerprint256), remote IP / port, HTTP version, compressed vs decoded size. Script console section reads `ExecutedResponse.scriptConsole`.
- **OAuth 2.0 + OpenID Connect** (#37). Authorization Code and Authorization Code + PKCE in addition to client_credentials. Refresh-token flow with proactive 30s-before-expiry refresh. Loopback callback listener via Electron's `net` module, `state` and PKCE `code_verifier` verified on callback. OIDC discovery via `.well-known/openid-configuration` auto-fills endpoints + scopes. `accessTokenPlacement` chooses between `Authorization` header, query param, or form body. JWT inspector decodes the access token and id_token header + payload (display only) with a live `exp` countdown.
- **Scraping-first features** (#31). Per-request `rateLimit` (fixed delay + optional jitter min/max) honoured by Collection Runner and Load Runner. UA preset picker (Scrapeman default, Chrome / Firefox / Safari / Mobile Safari / Googlebot / curl). Anti-bot signal detection (Cloudflare, 429, CAPTCHA, bot-block) populates `ExecutedResponse.antiBotSignal`; renderer shows a dismissable banner above the body. Rotating proxy: `ProxyConfig.rotate.{ urls, strategy }` with round-robin or random selection.
- **Scoped variables + folder-level auth inheritance** (#30). Resolution order Request > Folder > Collection > Environment > Global. New file format files: `.scrapeman/globals.yaml`, `.scrapeman/collection.yaml`, `_folder.yaml` per folder. Folder + collection settings dialogs (Variables / Auth tabs); `AuthTab` shows `Inherited from /<folder>` when a request inherits.
- **SSE Events mode** in response viewer (#25). Detects `text/event-stream` (or `sseEvents` populated) and adds an Events mode that renders one block per event with id / event / retry pills and the `data` field as JSON tree (when JSON) or monospace. Export as JSON.
- **Path-in-name save** (#69). The save dialog accepts `api/users/list`-style names; missing folders are auto-created under the workspace root. `..` and `.` segments are rejected; the final path goes through `resolveSafe`.
- **Response viewer polish**: HTML pretty mode now actually indents the output (new `formatHtml` tag-aware printer); default mode for JSON / HTML / XML / JS / CSS / image / pdf flips to the structured view (Tree / Pretty / Preview) when the user has not pinned a mode; raw stays one click away.

### Fixed
- **bash ANSI-C curl import**. `curl ... --data-raw $'[{"q":"\\u0021"}]'` (Chrome's "Copy as cURL (bash)") now expands `!` → `!`, `\n` → newline, `\t` → tab, `\xHH`, `\NNN` octal, `\\` `\'` `\"`. Previously the body landed with a stray `$` prefix and unresolved escapes, so GraphQL servers rejected it with a parse error. Two regression tests cover the GraphQL-style and mixed-escape cases.

### Tests
- 548 passing in `http-core`, 35 in `apps/desktop`. 7 skipped. Typecheck clean across all three packages.

## [0.4.1] — 2026-04-22

### Added
- **Syntax highlighting for every pretty-mode response kind.** JSON, XML, JavaScript and CSS responses now render through the same read-only CodeMirror viewer HTML has been using. `HtmlEditor` became the general `CodeMirrorViewer` behind the scenes; each kind pulls its `@codemirror/lang-*` pack and the `oneDark` theme in dark mode. Search navigation (Enter / Shift+Enter) scrolls and selects the active match inside the editor for all five kinds; the 500 KB large-body warning banner now fires for all of them too.
- **Command palette "Add URL parameter"** (cmd+k, View section). Switches the active request tab to the Params pane and focuses the first empty Key cell, appending a new row when every existing one is already filled.
- **Tab-to-create in the Params table.** When the table is empty and you tab into it, a new row is appended and the cursor lands in the Key cell. Matches Postman's behaviour. Existing Shift+Enter (insert below) and Tab-from-last-row (append) shortcuts unchanged.

### Fixed
- Regression coverage for the load runner. A new integration test file asserts that `{{random}}`, `{{uuid}}`, `{{timestamp}}` and `{{isoDate}}` resolve fresh every iteration (100 `{{random}}` iterations produce ≥ 95 distinct URLs), and that `normalizeUrl` runs per iteration so scheme-less, port-only and empty-host URLs reach the server the same way they do for a single-shot send.

### Tests
- 338 tests pass across `http-core` and `desktop`; 7 skipped. Typecheck clean in all three packages.

## [0.4.0] — 2026-04-22

### Added
- Screenshot capture button in the request header. Hides the sidebar, tab bar and action buttons, then opens a modal with the PNG and a copy-to-clipboard button that uses Electron's native `clipboard.writeImage`. A "Tested with Scrapeman" watermark sits in the bottom-right of the captured frame.
- Git pull now prompts on diverged branches instead of aborting. Dialog offers Rebase, Merge commit, or Cancel; the pick is passed through IPC to `git pull --rebase` or `git pull --no-rebase --no-ff`. Auth, network, and merge-conflict errors render as plain English banners. A three-second inline badge confirms the pull strategy that ran.
- Drag-to-reorder rows in Params and Headers. Hover-only grip handle on the left; a two-pixel accent line appears above or below the hovered row based on cursor position, and the drop lands at that edge.
- Bulk header edit. Pencil toggle at the top-right of the Headers table opens a textarea where each line is `Key: Value`; a `//` prefix disables that line. Round-trip between table and textarea is lossless, `{{var}}` placeholders preserved.
- JSON body beautify. Button shows up when body mode is `json`; Shift+Cmd+F (macOS) or Shift+Ctrl+F (Windows/Linux) runs the same format from inside the editor. Body containing unresolved `{{var}}` is skipped with a toast.
- Response body search runs over a `@tanstack/react-virtual` pipeline: 150ms debounce, line-indexed match table, and only the visible rows hit the DOM. A 5 MB body stays under 30 ms per keystroke. HTML responses now have a CodeMirror pretty view with one-dark in dark mode and a size warning above 500 KB.
- `normalizeUrl(raw)` in `http-core` handles scheme-less URLs (`localhost/api`), port-only (`:80/path`), and empty host (`:/path`) by prepending `http://` and defaulting the host to `0.0.0.0`. Runs after variable resolution so `{{host}}` still works.
- `.sman` is now the primary file extension. Legacy `.req.yaml` files are read as-is; the first save rewrites them to `.sman` and deletes the old path. Collisions resolve to `.sman`. Parser accepts `scrapeman: "1.0"` and `scrapeman: "2.0"`; the writer always emits `2.0`.
- Per-tab sub-pane memory. Each request tab remembers whether it was on Params, Headers, Body, Auth, Settings, Code or Load when you left it.
- Response body validator. Settings tab has an "Expected text" input; when set, the response status bar shows a green check or red cross chip reporting whether the decoded body contains the substring. `{{var}}` supported.
- Load runs land in history with a `LoadRunSummary` (sent, succeeded, failed, validationFailures, elapsedMs, rps, p50, p95, p99, min, max, statusHistogram, errorKinds).
- Load test shows the active validation rules while the run is live: `status = 2xx` and `body ⊃ "success"` chips appear next to the progress bar and on the initial spinner screen.
- Hover descriptions on every load-test metric: RPS, p50, p95, p99, min, max, Inflight, Success rate, Failed, Validation fail.

### Fixed
- Response body and execution state no longer leak between tabs when you switch tabs before the response lands. The store captures the target tab id at send time and writes back via a new `mutateById` helper instead of whichever tab happens to be active.
- Load test state is now per-tab. Config, run id, progress snapshot, and event log live on `Tab.loadTest` in the store; tab switches and sidebar toggles preserve them. Closing a tab aborts its running load run so the main process does not keep firing events at a dead tab id.
- Response viewer toolbars (status metrics bar, body/headers switcher) and the Headers panel column header are now opaque and sticky. Virtualized body text no longer bleeds into the chrome when restoring from history or retrying.
- Virtualized rows in raw and pretty no longer overlap. The inner `<pre>` used `whitespace-pre-wrap break-words` while the outer height was pinned to 18 px, so long lines wrapped visually and drew over the next row. Flattened to a single `whitespace-pre` div and widened the slab to `max-content`; long lines now scroll horizontally inside the `overflow-auto` parent.
- Active search match is centered both vertically and horizontally. Vertical scroll goes through the virtualizer; horizontal scroll is computed from the mark's `getBoundingClientRect()` and applied to `parent.scrollLeft`, which sidesteps the `contain: strict` + absolute-positioned slab combination that broke `scrollIntoView`.
- HTML pretty mode follows search navigation. Enter / Shift+Enter map the active match into a CodeMirror `SelectionRange` and dispatch `scrollIntoView(range, { y: 'center', x: 'center' })`; the read-only selection highlight doubles as the active-match cue.
- Executor and scrape.do composer stopped re-appending `request.params` onto URLs. The URL bar is now the single source of truth for the outgoing URL; `request.params` stays in the file format for round-tripping disabled rows but never reaches the wire. Fixes duplicated `token=` in the scrape.do envelope (`"Wrong query parameter. You are sending multiple value via same parameter('token')"`) and `{{var}}` going through unresolved.
- Disabled URL params survive tab switches, disk saves, and reloads. Added `disabledParams: string[]` to the file format; all params round-trip with their enabled flag.
- Params row order is preserved when toggling the enabled checkbox. Previously `[disabled..., enabled...]` regrouping reshuffled the list on reload.
- `HeadersEditor` no longer imports from `@scrapeman/http-core`. The top-level export dragged `undici` into the renderer bundle and the browser crashed with `process is not defined`. The bulk helpers moved to `apps/desktop/src/renderer/src/utils/header-bulk.ts`.
- `git pull --ff-only` no longer fatals on diverged branches (see Added).

### Changed
- Request execution contract: `request.url` is canonical. `request.params` is metadata for the file format only and is not appended to the URL by the executor or by `composeScrapeDoRequest`.

### Tests
- Test files: 22 passed in `http-core`, 2 in `apps/desktop`.
- Total: 332 tests pass, 7 skipped.
- `pnpm -r typecheck` clean in all three packages.

## [0.3.2] and earlier

See `git log --grep='release:'` for prior version notes.
