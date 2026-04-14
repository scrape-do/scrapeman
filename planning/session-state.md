---
doc: session-state
owner: team-lead
status: active
updated: 2026-04-14
---

# Session handoff — scrapeman

Snapshot of where we left off so the next session can pick up cold.

## Quick resume

```bash
cd /Users/mert/Developer/scrapeman
claude --resume         # picks last Claude Code session
# or start fresh:
claude
```

After starting, paste this into the first prompt:

> Read `planning/session-state.md`, `planning/milestones.yaml`, and the last
> few TaskList entries. We finished **M3.10 (code export MVP)**. Next up is
> **M4 — Auth helpers** unless I say otherwise. Run `pnpm -r test` to confirm
> 93/93 still green, then proceed.

## Status as of 2026-04-14 (session close)

### Completed milestones
- **M0** Scaffold + CI + planning docs
- **M1** Vertical slice (UndiciExecutor, IPC, minimal UI)
- **M2** Collections & file format (YAML, FS layer, watcher, sidebar tree)
- **M2.5** UI polish pass (Postman light, Inter font, design tokens, traffic light spacing, Radix primitives, ConfirmDialog/PromptDialog)
- **M2.6** Tabs + curl import (tab bar, empty-draft tab, curl tokenizer + parser, import dialog)
- **M3.1** Environment variables + resolver (env file format, IPC, EnvironmentMenu, VariablesPanel, `{{var}}` substitution across URL/params/headers/body/auth/proxy/scrapeDo)
- **M3.2** Cross-platform shortcuts (`useShortcuts` hook, `mod` = ⌘ on mac / Ctrl elsewhere, shortcutLabel helper)
- **M3.3** Params tab with two-way URL↔params sync
- **M3.4** Resizable + orientable split (SplitPane, horizontal↔vertical toggle, localStorage persistence)
- **M3.5** HighlightedInput overlay technique (URL bar + headers value + params value, `{{var}}` as accent pill)
- **M3.6** Built-in dynamic variables (`{{random}}`, `{{timestamp}}`, `{{isoDate}}`, `{{randomInt}}`, user vars shadow)
- **M3.7** History MVP (JSONL store per workspace, auto-capture on every send, sidebar History panel, restore-to-tab)
- **M3.8** Per-request Settings tab (Proxy/Timeout/Redirect/TLS/Protocol/scrape-do) + curl `-x`/`--proxy` parser
- **M3.9** Right-click context menu on URL/headers/params cells (URL encode/decode, Base64, copy/paste/clear)
- **M3.10** Code export MVP (curl, JS fetch, Python requests, Go net/http generators + Code tab in builder)

### Test state
```
93 tests across 8 files — all green
  20 curl parser
  19 variable resolver (incl. 8 built-ins)
  10 history store
  10 executor integration
   9 codegen
   9 format serialize/parse
   9 workspace FS
   7 environment FS
```

### Verify sweep (run after resume)
```bash
pnpm -r typecheck   # expect: all clean
pnpm -r test        # expect: 93 passed
pnpm -r build       # expect: main + preload + renderer green
```

### Next milestone — M4 Auth helpers (planned)

Plan lives in `planning/tasks.yaml` T040–T045. Order:

1. **T040** Auth type enum + UI switcher (None/Basic/Bearer/ApiKey/OAuth2/AwsSigV4)
2. **T041** Basic + Bearer + API Key forms + backend wiring
3. **T042** OAuth2 client credentials (token endpoint, cache, refresh)
4. **T043** OAuth2 authorization code flow (local callback server, PKCE)
5. **T044** AWS SigV4 signer (aws4 lib, S3 integration test)
6. **T045** Auth UI polish — token preview, expiry countdown, force refresh

Note: the `AuthConfig` type is already in `@scrapeman/shared-types`,
`resolveRequest` already substitutes `{{var}}` in auth fields, and the
format serializer/parser already round-trips all auth types. Most of M4
is UI + token flow, not new type work.

## Key decisions made mid-session (not in architecture.md yet)

- **D1 revised** — undici over postman-runtime. Already in architecture.md.
- **History storage: JSONL not SQLite** — M3.7 chose JSONL to avoid native
  module ABI issues with Electron. Upgrade to better-sqlite3 + FTS5 in M8
  when we need advanced search / 100k+ entries. History file is in
  `app.getPath('userData')/history/<sha1 of workspace path>.jsonl`.
- **Code export via IPC** — renderer does not import `@scrapeman/http-core`
  directly. `codegen:generate` IPC runs in main process so it has access to
  workspace env vars for `inlineVariables`.
- **Settings storage** — per-request settings (proxy, timeout, redirect,
  tls, httpVersion, scrapeDo) live in `BuilderState.settings` in the
  renderer and are serialized into `request.options` / `request.proxy` /
  `request.scrapeDo` at send time. They round-trip through `.req.yaml`.
- **Cross-platform shortcuts** — use `combo: 'mod+t'` form; `mod` expands to
  `meta` on mac, `ctrl` elsewhere. Don't hardcode `⌘` in labels.

## Gotchas the next session must remember

1. **pnpm dev must be restarted** after any change to main process IPC
   handlers — electron-vite auto-restarts main, but if the dev was started
   before new handlers were added, old main is running. Kill and restart.
2. **shared-types dist can go stale** — if you add a type to shared-types
   and don't rebuild, http-core typecheck fails with `no exported member`.
   Run `pnpm --filter=@scrapeman/shared-types build` first, or just use
   `pnpm run build:packages`.
3. **`pnpm dev` is concurrent** — 3 watchers run in parallel:
   - `types` (cyan) — shared-types tsc watch
   - `core` (magenta) — http-core tsc watch
   - `desktop` (green) — electron-vite dev
   Renderer HMR is instant. Main/preload auto-restart. http-core/shared-types
   changes take ~2s (tsc emit → electron-vite pickup).
4. **exactOptionalPropertyTypes is on** — `body: undefined` fails. Use
   conditional spread: `...(body !== undefined ? { body } : {})`.
5. **Electron preload extension is `.mjs`** — main must reference
   `'../preload/index.mjs'`, not `.js`. Already fixed, don't regress.
6. **HighlightedInput overlay** — the `<input>` is text-transparent with
   caret visible; overlay div mirrors text with `{{var}}` spans. When
   wrapping for ContextMenu trigger, put a plain `<div>` between so Radix
   `asChild` can forward the event. Same applies to new cells.

## Files worth opening first on resume

- `planning/session-state.md` — this file
- `planning/milestones.yaml` — full roadmap
- `planning/postman-parity.md` — feature parity checklist
- `planning/tasks.yaml` — all tasks, find T040 for next work
- `planning/architecture.md` — D1–D8 decisions
- `packages/http-core/src/index.ts` — what's exported
- `apps/desktop/src/renderer/src/store.ts` — app state shape
- `apps/desktop/src/main/index.ts` — IPC handlers registry
