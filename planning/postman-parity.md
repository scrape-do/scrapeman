---
doc: postman-parity
owner: product-manager
status: draft
updated: 2026-04-14
---

# Postman feature parity checklist

This doc enumerates Postman's feature surface and maps each item to
Scrapeman's status: **done**, **in-progress**, **planned** (with milestone
and task IDs), or **out-of-scope** (with reason).

Scrapeman's north star is **Postman's paid features for free** plus scrape-do
native proxying. We intentionally skip cloud-only features (sync, team
workspaces, mock servers, monitors, docs hosting) and non-API features
(API design, schema editor, Flows).

## Legend

- ✅ done
- 🟡 in-progress
- 🔵 planned (with milestone/task)
- ⚫ out-of-scope (v1)
- 🔶 deferred to v1.5 / v2

---

## 1. Workspaces & collections

| Feature | Status | Notes |
|---|---|---|
| Personal workspace (local) | ✅ | M2 — git folder as workspace |
| Team workspace (cloud sync) | ⚫ | Non-goal. Git handles sync. |
| Collection (folder of requests) | ✅ | M2 |
| Nested sub-folders | ✅ | M2 |
| Drag-drop reorder | 🔵 | M3.8 polish (IPC already in place) |
| Rename / duplicate / delete | ✅ | M2 (delete, rename), duplicate 🔵 T024 |
| Import Postman v2.1 | 🔵 | M9 T090 |
| Import Bruno | 🔵 | M9 T094 (NEW) |
| Import Insomnia v4 | 🔵 | M9 T095 (NEW) |
| Import HAR | 🔵 | M9 T092 |
| Import curl | ✅ | M2.6 T091 |
| Import OpenAPI / Swagger | 🔶 | v1.5 |
| Import GraphQL schema | 🔶 | v1.5 |
| Export Postman v2.1 | 🔵 | M9 T093 |
| Export HAR / curl | 🔵 | M9 T092 |
| Collection variables | 🔵 | M3 (variable scope precedence) |
| Collection-level auth | 🔵 | M4 (propagates to children) |
| Fork / merge requests | ⚫ | Cloud-only, non-goal |

## 2. Request building

| Feature | Status | Notes |
|---|---|---|
| HTTP methods (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) | ✅ | M1 |
| Custom methods (PROPFIND, QUERY, etc.) | ✅ | M1 (string-open type) |
| URL bar with `{{var}}` highlighting | ✅ | M3.5 (HighlightedInput) |
| Params tab with two-way URL sync | ✅ | M3.3 |
| Headers tab with enable/disable | ✅ | M1 |
| Headers autocomplete | 🔶 | v1.5 polish |
| Body: none / raw json / raw text | ✅ | M1 |
| Body: raw xml / html / js | 🔵 | M6 (already in type system, UI needs pickers) |
| Body: x-www-form-urlencoded | 🔵 | M4 |
| Body: multipart form-data (text + file) | 🔵 | M4/M6 |
| Body: binary file | 🔵 | M6 |
| Body: GraphQL dedicated editor | 🔶 | v1.5 |
| Body formatter (Beautify) | 🔵 | M8 polish |
| Settings tab (per-request overrides) | 🔵 | **M3.8 T380 (NEW)** |
| Pre-request script | ⚫ | Non-goal v1 (scope creep) |
| Tests script | ⚫ | Non-goal v1 |
| Assertions / contract tests | 🔶 | v1.5 via collection runner |

## 3. Response viewer

| Feature | Status | Notes |
|---|---|---|
| Status + duration + size | ✅ | M1 |
| Headers table | ✅ | M1 |
| Cookies tab | 🔵 | M6 T061 |
| Raw / Pretty body toggle | ✅ | M2.5 (JSON only, expand in M8) |
| Preview (HTML render) | 🔵 | M8 |
| Image / binary / hex view | 🔵 | M8 |
| JSON tree (collapsible, copy path) | 🔵 | M8 T082 |
| Search in response body | 🔵 | M8 T082 |
| Timings breakdown (DNS/Connect/TLS/TTFB/DL) | 🔵 | M8 T083 |
| Save response as example | 🔶 | v1.5 |
| Save response to file | 🔵 | M8 |
| Test results tab | ⚫ | Non-goal v1 |
| Visualize (templated HTML renderer) | ⚫ | Non-goal v1 |

## 4. Authorization

| Type | Status | Notes |
|---|---|---|
| No auth | ✅ | M1 |
| Inherit from parent | 🔵 | M4 (collection-level auth) |
| Basic | 🔵 | M4 T041 |
| Bearer | 🔵 | M4 T041 |
| API key (header or query) | 🔵 | M4 T041 |
| Digest | 🔶 | v1.5 |
| OAuth 1.0 | 🔶 | v1.5 |
| OAuth 2.0 (client credentials) | 🔵 | M4 T042 |
| OAuth 2.0 (authorization code + PKCE) | 🔵 | M4 T043 |
| OAuth 2.0 (implicit) | 🔶 | v1.5 (deprecated flow) |
| OAuth 2.0 (password grant) | 🔶 | v1.5 |
| AWS Signature v4 | 🔵 | M4 T044 |
| NTLM | ⚫ | Rarely used, non-goal v1 |
| Hawk | ⚫ | Niche, non-goal |
| Akamai EdgeGrid | ⚫ | Niche, non-goal |
| Token cache + refresh | 🔵 | M4 |

## 5. Variables & environments

| Feature | Status | Notes |
|---|---|---|
| Globals | 🔶 | v1.5 (one level below env) |
| Environment variables | ✅ | M3.1 |
| Collection variables | 🔵 | M3 (scope precedence) |
| Local variables (request-scoped) | 🔶 | v1.5 |
| Variable scope precedence | 🔵 | M3 T030 |
| `{{var}}` substitution in URL/headers/body/auth | ✅ | M3.1 |
| Secret variables (masked in UI) | 🟡 | M3.1 (masked); keytar 🔵 M3 T032 |
| Dynamic built-ins (`{{random}}` etc.) | ✅ | M3.6 |
| Quick look eye icon (peek resolved values) | 🔶 | v1.5 polish |
| Variable autocomplete `{{` popup | 🔵 | M3 T034 |
| Import/export environments | 🔵 | M9 |

## 6. Cookies

| Feature | Status | Notes |
|---|---|---|
| Persistent jar | 🔵 | M6 T060 |
| Per-domain inspector / editor | 🔵 | M6 T061 |
| Clear jar | 🔵 | M6 |
| Include/exclude domains | 🔶 | v1.5 |
| Interceptor (sync browser cookies) | ⚫ | Non-goal |

## 7. Proxy

| Feature | Status | Notes |
|---|---|---|
| Global proxy (app-level) | 🔵 | M5 + settings |
| Per-request proxy | 🔵 | **M3.8 T380 (NEW — Settings tab)** |
| HTTP/HTTPS proxy | 🔵 | M5 T050 |
| SOCKS5 proxy | 🔵 | M5 T050 |
| Proxy auth | 🔵 | M5 |
| Bypass list | 🔵 | M5 |
| scrape-do native mode (differentiator) | 🔵 | M5 T052 |
| Curl `-x` import → settings | 🔵 | **M3.8 T381 (NEW)** |
| Interceptor / system proxy detection | 🔶 | v1.5 |

## 8. Code generation

| Language | Status | Notes |
|---|---|---|
| curl | 🔵 | **M3.10 T3A0 (NEW MVP)**, M7 full |
| JavaScript fetch | 🔵 | **M3.10 T3A0 (NEW MVP)** |
| Python requests | 🔵 | **M3.10 T3A0 (NEW MVP)** |
| Go net/http | 🔵 | **M3.10 T3A0 (NEW MVP)** |
| libcurl (C) | 🔵 | M7 (via postman-code-generators) |
| JavaScript axios / jQuery / Node http | 🔵 | M7 |
| Python http.client / httpx | 🔵 | M7 |
| Java OkHttp / Unirest | 🔵 | M7 |
| Ruby Net::HTTP | 🔵 | M7 |
| PHP cURL / Guzzle | 🔵 | M7 |
| C# HttpClient / RestSharp | 🔵 | M7 |
| Swift URLSession | 🔵 | M7 |
| Kotlin OkHttp | 🔵 | M7 |
| Rust reqwest | 🔵 | M7 |
| Dart http | 🔵 | M7 |
| Respects auth + proxy + cookies | 🔵 | M7 T072 |
| Respects `{{var}}` (inline vs keep) | 🔵 | **M3.10 T3A0 (NEW)** |
| Syntax highlight preview | 🔵 | M7 T071 |

## 9. History

| Feature | Status | Notes |
|---|---|---|
| Capture every send automatically | 🔵 | **M3.7 T370 (NEW — pulled from M8)** |
| SQLite store, unlimited, local-only | 🔵 | **M3.7 T370 (NEW)** |
| Sidebar list | 🔵 | **M3.7 T372 (NEW)** |
| Search by URL / method / status / body | 🔵 | M8 T081b (advanced) |
| Filter by date range, workspace, env | 🔵 | M8 T081b |
| Virtual scroll for 100k+ entries | 🔵 | M8 T081b |
| Restore history entry to new tab | 🔵 | **M3.7 T372 (NEW)** |
| Save history entry to collection | 🔵 | **M3.7 T372 (NEW)** |
| Export as HAR / curl | 🔵 | M8 |
| Diff two history entries | 🔶 | v1.5 |
| Pin/star history entry | 🔶 | v1.5 |

## 10. Runner

| Feature | Status | Notes |
|---|---|---|
| Single-request load test (N × concurrency) | 🔵 | **M11 (NEW)** |
| Live latency + throughput + error metrics | 🔵 | **M11 T1104 (NEW)** |
| Status histogram + latency chart | 🔵 | **M11 T1104 (NEW)** |
| Export results (CSV/JSON/HAR) | 🔵 | **M11 T1105 (NEW)** |
| Per-iteration fresh `{{random}}` | 🔵 | **M11 T1100 (NEW)** |
| Collection runner (sequential requests) | 🔶 | v1.5 (Newman equivalent) |
| Iterations + data file (CSV/JSON) | 🔶 | v1.5 for collection runner, M11 data-driven as stretch |
| Assertions / test scripts in runner | ⚫ | Non-goal v1 (no script sandbox) |
| Scheduled runs / monitors | ⚫ | Cloud-only, non-goal |

## 11. UX essentials

| Feature | Status | Notes |
|---|---|---|
| Tabs (multi-request) | ✅ | M2.6 |
| Draft tab + curl import in empty tab | ✅ | M2.6 |
| Tabs: close, middle-click close, reorder | 🟡 | M2.6 done, reorder 🔵 |
| Resizable + orientable request/response split | ✅ | M3.4 |
| Sidebar + two panels + split handles | ✅ | M3.4 |
| Light / dark theme | 🟡 | Light M2.5 done; dark 🔵 M8 T084 |
| Keyboard shortcuts — core (Send/Save/New/Close) | ✅ | M3.2 (⌘T, ⌘W, ⌘↵, ⌘S) |
| Keyboard shortcuts — extended (⌘N, ⌘D, ⌘K, ⌘1..9) | 🔵 | **M3.2 follow-up (NEW)** |
| Right-click context menus on cells | 🔵 | **M3.9 T390 (NEW)** |
| Command palette (⌘K) | 🔵 | M3.2 follow-up |
| Quick switcher for tabs / requests (⌘P) | 🔵 | M8 polish |
| Global find/replace across collection | 🔶 | v1.5 |
| Onboarding / welcome | 🔵 | M10 T103 |
| Console (request/response debug log) | 🔶 | v1.5 |

## 12. Settings

| Area | Status | Notes |
|---|---|---|
| Per-request Settings tab | 🔵 | **M3.8 T380 (NEW)** |
| App-wide settings (theme, default timeouts, etc.) | 🔵 | M10 T103 |
| SSL cert verification toggle | 🔵 | M3.8 T380 |
| Max response size cap | 🔵 | M3.8 T380 |
| Auto-update channel | 🔵 | M10 T102 |
| Workspace settings (env isolation, default auth) | 🔶 | v1.5 |

## 13. Out-of-scope (v1)

Explicit non-goals. Each would be substantial work without clear value for
our scrape-do-focused audience.

| Feature | Reason |
|---|---|
| Cloud accounts / team sync | Git handles sharing; no backend to run |
| Mock servers | Distinct product; scrape-do customers don't need it |
| Monitors / scheduled runs | Cloud-only model |
| API documentation hosting | Different product |
| API design editor (schema) | Different product |
| Postman Flows | Low-code flows belong in v2 if at all |
| Pre/post scripts (JS sandbox) | 30% scope bloat; variable + chaining cover 80% |
| Browser extension / interceptor | Different trust model, separate project |
| Mobile client | Different platform, not our audience |
| WebSocket / gRPC / SSE dedicated UIs | v2 if demand |
| HTTP/3 (QUIC) | Node has no stable h3; revisit post-stable |
| NTLM / Hawk / Akamai auth | Niche, can be added if customers ask |
| Newman CLI equivalent in-app | Covered by collection runner v1.5 |

---

## Deltas from this session (2026-04-14)

### New milestones
- **M3.7** History MVP — 3 days, 3 tasks, 17h
- **M3.8** Settings tab — 3 days, 3 tasks, 11h
- **M3.9** Context menus — 1 day, 1 task, 4h
- **M3.10** Code export MVP — 2 days, 2 tasks, 10h
- **M11** Load runner — 8 days, 6 tasks, 45h

### Milestone expansions
- **M9** Import/Export expanded to cover Bruno, Insomnia, HAR in addition to Postman v2.1 (T094-T096 added, +21h, duration 4d → 6d)
- **M3.2** Keyboard shortcuts expanded: ⌘N, ⌘D, ⌘K, ⌘Shift+T, ⌘1..9 added to scope
- **M6** T063 (advanced options panel) subsumed by **M3.8** T380; M6 now focused on cookie jar + HTTP/2

### Scope.md changes
- "Per-request Settings" section added to in-scope
- "Load runner" section added (distinct from collection runner in v1.5)
- "Context menus" added
- History section details expanded
- Code generation targets expanded to 20+ via postman-code-generators
- Import sources explicitly include Bruno and Insomnia
