---
doc: session-state
owner: team-lead
status: active
updated: 2026-04-17
---

# Session handoff — scrapeman

Snapshot of where we left off so the next session can pick up cold.

## Quick resume

```bash
cd ~/Developer/scrapeman
claude --resume         # picks last Claude Code session
# or start fresh:
claude
```

After starting, paste this into the first prompt:

> Read `planning/session-state.md`, `planning/milestones.yaml`, and
> `planning/issues/sprint-plan-2026-04-17.md`. We are beginning Sprint 1
> (Import/export). Start with T090 (Postman v2.1 importer). Run `pnpm -r test`
> first to confirm all 226 tests are green, then proceed.

## Status as of 2026-04-17

### Completed milestones

- **M0** Scaffold + CI + planning docs
- **M1** Vertical slice (UndiciExecutor, IPC, minimal UI)
- **M2** Collections & file format (YAML, FS layer, watcher, sidebar tree)
- **M2.5** UI polish pass (Postman light, Inter font, design tokens, traffic light spacing, Radix primitives, ConfirmDialog/PromptDialog)
- **M2.6** Tabs + curl import (tab bar, empty-draft tab, curl tokenizer + parser, import dialog)
- **M3.1** Environment variables + resolver
- **M3.2** Cross-platform shortcuts
- **M3.3** Params tab with two-way URL↔params sync
- **M3.4** Resizable + orientable split
- **M3.5** HighlightedInput overlay (`{{var}}` as accent pill)
- **M3.6** Built-in dynamic variables (`{{random}}`, `{{timestamp}}`, `{{isoDate}}`, `{{randomInt}}`)
- **M3.7** History MVP (JSONL store, sidebar History panel, restore-to-tab)
- **M3.8** Per-request Settings tab (Proxy/Timeout/Redirect/TLS/Protocol/scrape-do) + curl `-x`/`--proxy` parser
- **M3.9** Right-click context menu on URL/headers/params cells (URL encode/decode, Base64, copy/paste/clear)
- **M3.10** Code export MVP (curl, JS fetch, Python requests, Go net/http + Code tab)
- **M3.11** In-app git integration (simple-git, source control panel, diff viewer)
- **M3.12** Bruno weak spots (SSE buffering, large-response truncation, cookie jar, OAuth2 token cache)
- **M3.13** Auto-headers + Accept-Encoding decompress (T3B0-T3B1; PR #12/#17)
- **M4** Auth helpers — all 5 schemes: Basic, Bearer, API Key, OAuth2 client credentials, OAuth2 auth code + PKCE, AWS SigV4
- **M5** Proxy + scrape-do native mode (HTTP/HTTPS proxy + scrape-do toggle + parameter UI)
- **M6** Cookie jar + HTTP/2 + advanced request options
- **M11 MVP** Load runner (concurrency loop, p50/p95/p99, validator, status histogram, error breakdown, stop mid-run) — T1100-T1104 shipped; chart (T1104 live latency chart) and export (T1105) pending
- **M13 UX polish** — T1300 (collection search), T1301 (Shift+Enter new row), T1302 (tab auto-append row), T1303 (Cmd+N focus URL), T1307 (dirty-tab close guard + "don't ask again") all shipped

### Test state

```
226 tests across ~18 files — all green
```

### Verify sweep (run after resume)

```bash
pnpm -r typecheck   # expect: all clean
pnpm -r test        # expect: 226 passed
pnpm -r build       # expect: main + preload + renderer green
```

### Current sprint — Sprint 1: "Get In the Door" (2026-04-17 to 2026-04-30)

Full sprint plan: `planning/issues/sprint-plan-2026-04-17.md`

| Task | Status | Notes |
|------|--------|-------|
| T090 Postman v2.1 importer | ready to build | Highest priority; covers most users |
| T094 Bruno (.bru) importer | ready to build | Spike first — no stable spec |
| T095 Insomnia v4 importer | ready to build | |
| T092 HAR importer + exporter | ready to build | |
| T093 Postman v2.1 exporter | ready to build | Depends on T090 types |
| T096 "Import from..." menu | ready to build | UI shell can start in parallel with T090 |

### Upcoming sprints

| Sprint | Dates | Goal |
|--------|-------|------|
| Sprint 2 | 2026-05-01 to 2026-05-14 | Signed + notarized installers, auto-update, internal rollout (≥5 engineers) |
| Sprint 3 | 2026-05-15 to 2026-05-28 | GraphQL editor (T1202) + load runner chart + export |
| Sprint 4 | 2026-05-29 to 2026-06-11 | Docs site (T1304-T1306) + large-response streaming + virtual scroll history |
| Sprint 5 | 2026-06-12 to 2026-06-25 | Full code gen (T070/T072) + remaining M12 gaps |

## Key decisions (architecture.md has the full log)

- **D1** undici over postman-runtime
- **History storage: JSONL** — JSONL to avoid native module ABI issues in Electron. Upgrade to better-sqlite3 + FTS5 in M8 if search becomes a pain point at scale.
- **History is template-preserving** — unresolved `{{var}}` written to disk; secrets never baked in.
- **Code export via IPC** — renderer never imports `@scrapeman/http-core` directly. `codegen:generate` IPC runs in main process.
- **Settings storage** — per-request settings live in `BuilderState.settings`, serialized into `.req.yaml` at save time.
- **Cross-platform shortcuts** — `combo: 'mod+t'` form; `mod` = `meta` on mac, `ctrl` elsewhere.

## Gotchas the next session must remember

1. **pnpm dev must be restarted** after any change to main process IPC handlers.
2. **shared-types dist can go stale** — run `pnpm --filter=@scrapeman/shared-types build` first, or `pnpm run build:packages`.
3. **`pnpm dev` is concurrent** — 3 watchers: `types` (cyan), `core` (magenta), `desktop` (green). Renderer HMR is instant; main/preload auto-restart.
4. **exactOptionalPropertyTypes is on** — `body: undefined` fails. Use conditional spread.
5. **Electron preload extension is `.mjs`** — main must reference `'../preload/index.mjs'`.
6. **HighlightedInput overlay** — `<input>` is text-transparent with caret visible; overlay div mirrors text with `{{var}}` spans. When wrapping for ContextMenu trigger, put a plain `<div>` between so Radix `asChild` can forward the event.

## Files worth opening first on resume

- `planning/session-state.md` — this file
- `planning/issues/sprint-plan-2026-04-17.md` — active sprint plan
- `planning/milestones.yaml` — full roadmap
- `planning/tasks.yaml` — all tasks by ID
- `planning/scope.md` — in/out of scope, non-goals
- `packages/http-core/src/index.ts` — what's exported
- `apps/desktop/src/renderer/src/store.ts` — app state shape
- `apps/desktop/src/main/index.ts` — IPC handlers registry
