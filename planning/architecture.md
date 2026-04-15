---
doc: architecture
owner: team-lead
status: draft
updated: 2026-04-14
---

# Architecture

## Stack decision

| Layer | Choice | Reason |
|---|---|---|
| Shell | **Electron** | Node runtime = direct access to `postman-runtime`, `undici`, `http2`, `tough-cookie`. Tauri considered but adds Rust learning curve without clear win for our workload. |
| Frontend | **React + TypeScript + Vite** | Familiar, fast HMR, large ecosystem for table/tree components. |
| State | **Zustand** | Simpler than Redux, enough for our scope. |
| Styling | **Tailwind + Radix primitives** | Consistent, accessible, unopinionated look — key to avoiding Bruno's clunky feel. |
| IPC | Electron contextBridge + typed channels | No unsafe nodeIntegration in renderer. |
| HTTP engine | `postman-runtime` (MIT) for v1, wrapped behind internal interface | Gets auth/cookie/redirect/variable resolution for free. Wrapping lets us swap to `undici` later if we outgrow it. |
| HTTP/2 | Node `http2` module, separate code path | `postman-runtime` is HTTP/1.x only. |
| Cookie jar | `tough-cookie` (already used by postman-runtime) | Persistent store via JSON file per environment. |
| Code generation | `postman-code-generators` (MIT) | 20+ targets out of the box. |
| File format | Custom text (YAML-like) one request per file | Optimized for git diffs. See `file-format.md` (TBD). |
| Secrets | OS keychain via `keytar` (optional), else encrypted file | User opts in per variable. |
| Packaging | `electron-builder` | mac (dmg), win (nsis), linux (AppImage + deb). |
| Testing | Vitest (unit) + Playwright (e2e on Electron) | |

## Layering

```
┌─────────────────────────────────────────────┐
│  Renderer (React)                           │
│  - UI components                            │
│  - Zustand stores                           │
│  - IPC client (typed)                       │
└──────────────┬──────────────────────────────┘
               │ contextBridge IPC
┌──────────────▼──────────────────────────────┐
│  Main process                               │
│  - IPC handlers                             │
│  - Collection FS layer (read/write/watch)   │
│  - Environment resolver                     │
│  - Request executor (facade)                │
│  - Secret store (keytar)                    │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│  HTTP core (internal package)               │
│  - RequestExecutor interface                │
│  - PostmanRuntimeAdapter (HTTP/1.x)         │
│  - Http2Adapter (HTTP/2)                    │
│  - ProxyResolver (incl. Scrape.do mode)     │
│  - AuthResolver                             │
│  - CookieStore                              │
│  - CodegenAdapter (postman-code-generators) │
└─────────────────────────────────────────────┘
```

## Key decisions

### D1: HTTP engine — undici first, borrow from Postman libs as needed
**Revised during M1 kickoff.** Original plan was to wrap `postman-runtime` as the default engine. After looking at the actual API, `postman-runtime` is designed as a Collection *runner* (callback-based, CJS, assumes a Collection model), not a single-request HTTP engine. For our architecture the single-request primitive is what we want.

Decision: use **`undici`** (Node's modern HTTP client) behind the `RequestExecutor` interface. It gives us all methods + custom methods, HTTP/1.1 + HTTP/2, redirect control, AbortSignal, streaming bodies, `ProxyAgent`, diagnostics timings — ESM-native and already vendored in Node.

We will still borrow from the Postman ecosystem **à la carte** when it saves work:
- `postman-code-generators` (M7) for codegen — still planned, still MIT.
- `postman-collection` SDK for Postman v2.1 import/export (M9) — structural types only.
- We may adopt `postman-runtime`'s auth helper modules later if reimplementing OAuth2/AWS SigV4 becomes painful — but NOT as the main engine.

Cost: we write our own auth and cookie resolution (M4, M6). Benefit: no CJS/ESM interop pain, smaller runtime surface, fewer abstraction layers between UI and the wire. The `RequestExecutor` seam still protects us if we ever swap engines.

Revisit if: we hit an auth flow where reimplementation cost > integration cost, in which case selectively import from `postman-runtime/lib/authorizer/*`.

### D2: File format
One request per file. YAML-like but with a header block for metadata and a body block for raw content, similar to Bruno `.bru` but cleaner. Example:

```
meta:
  name: Fetch product page via Scrape.do
  method: GET

url: https://api.scrape.do/?token={{token}}&url={{target}}&render=true

headers:
  Accept: text/html

auth:
  type: none

scrapeDo:
  enabled: true
  render: true
  geoCode: us
```

Rationale: stable key order → clean diffs. No JSON (Postman v2.1 has ordering issues with objects).

### D3: Scrape.do native mode
A first-class feature, not a plugin. When enabled on a request, the UI shows a Scrape.do parameter panel and the URL is composed at send-time. Token stored as a secret variable. This is our differentiator — must be polished.

### D4: No script sandbox in v1
Explicit non-goal. Reduces scope by ~30%. We lose pre-request dynamic behavior, but variable substitution + request chaining (v1.5) covers 80% of use cases in our context.

### D5: Git sync is user-owned
We do not embed git. User points scrapeman at a folder they already manage with git. Scrapeman watches the folder and reloads on external changes (chokidar). This avoids reinventing git and respects existing team workflows.

### D6: History is local-only, stored outside the workspace
History lives in a SQLite DB under the OS app-data dir, **never** under the user's workspace folder. Rationale:
1. Must be fast (SQLite + FTS gives sub-50ms search on 100k entries).
2. Must be private — history contains tokens, cookies, response bodies; must never accidentally end up in a git commit.
3. Must never sync — keeping it out of the workspace folder makes this architectural, not a checkbox.
Trade-off: history does not follow the user across machines. This is intentional and called out in vision.md as a pillar, not a bug.

### D7: Postman-grade polish is a first-class constraint
"Feels like Postman, not Bruno" is a release blocker, not a nice-to-have. Concretely:
- All interactions perceived <100ms (pre-computed states, optimistic UI).
- Layout is stable — no reflow on tab switch, no flash of unstyled content.
- Response viewer handles 10MB without jank (virtualized JSON tree, streaming body).
- Keyboard shortcuts cover 100% of common flows.
- Dark mode is not an afterthought; both themes ship day-one.
Reviewer enforces this in PR review for any UI task.

### D8: Monorepo layout — pnpm workspaces, http-core as publishable package
Layout:
```
scrapeman/
├── package.json              # workspace root, private
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── http-core/            # @scrapeman/http-core — publishable, MIT
│   │   ├── package.json
│   │   ├── src/
│   │   └── tests/
│   └── shared-types/         # @scrapeman/shared-types — publishable
│       ├── package.json
│       └── src/
├── apps/
│   └── desktop/              # @scrapeman/desktop — Electron app, private
│       ├── package.json
│       ├── electron.vite.config.ts
│       └── src/
│           ├── main/
│           ├── preload/
│           └── renderer/
├── .github/workflows/
└── planning/
```

Rationale:
- **pnpm workspaces, no turborepo yet.** pnpm's native workspace + filter commands are enough for our scope. Add turborepo only if build times hurt.
- **http-core is publishable from day one.** v1.5's "unlimited collection runs" implies a CLI runner; designing http-core as a proper package now avoids a refactor. Zero runtime cost — just means tighter API contracts and `@scrapeman/http-core` import paths instead of relative.
- **shared-types is its own package** so both main and renderer (and later CLI) can depend on it without circular imports.
- **Only apps/desktop is private.** http-core and shared-types are publishable (npm scope `@scrapeman`).

Revisit if: build times >30s, or we add a 4th package that'd benefit from turborepo caching.

## Open questions

- OQ1: Should environment files live alongside collection files or in a separate user dir? (Affects whether secrets end up in repos.)
- OQ2: Single-window multi-workspace or one window per workspace?
- OQ3: Do we need a Monaco editor for body or is a lighter CodeMirror enough?
- OQ4: How do we handle extremely large responses (>50MB) — stream to disk, offer preview on demand?
