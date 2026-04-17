# Agent Batch Execution Plan -- 2026-04-17

## Status snapshot

**Shipped:** M0-M6, M3.7-M3.13, M4, M5, M11 (load runner MVP: T1100-T1103), M13 UX polish (T1300-T1303, T1307).
**Test count:** 226.
**Branch:** main (clean).

## Remaining work by milestone (priority order)

| Milestone | Remaining tasks | Est. hours |
|-----------|----------------|------------|
| M9 Import/export | T090, T091(?), T092, T093, T094, T095, T096 | ~48h |
| M10 Packaging | T100, T101, T102, T103, T104 | ~32h |
| M12 Competitive gaps | T1200, T1201, T1202, T1203 | ~41h |
| M11 remaining | T1104 (chart), T1105 (export) | ~16h |
| M13 remaining | T1304, T1305, T1306 | ~22h |
| M7 Full codegen | T070, T071, T072 | ~16h |
| M8 remaining | T081b (virtual scroll history), T086 (large response streaming) | ~18h |

**Note on curl import (T091):** This shipped as part of M3.8 (T381 references it as a dependency and the ImportCurlDialog.tsx component exists). T091 is likely done. The batch plan assumes it is shipped and excludes it.

---

## Batch 1: Import parsers (M9 -- HIGHEST PRIORITY)

**Goal:** All four import parsers land independently. Zero UI work -- pure file-format parsing in http-core.

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T090 Postman v2.1 importer | developer-core (agent A) | 10h | `packages/http-core/src/import/postman.ts` (new), `packages/http-core/src/import/index.ts` (new), tests |
| T094 Bruno .bru importer | developer-core (agent B) | 8h | `packages/http-core/src/import/bruno.ts` (new), tests |
| T095 Insomnia v4 importer | developer-core (agent C) | 8h | `packages/http-core/src/import/insomnia.ts` (new), tests |
| T092 HAR importer + exporter | developer-core (agent D) | 6h | `packages/http-core/src/import/har.ts` (new), `packages/http-core/src/export/har.ts` (new), tests |

**Parallelism:** ALL FOUR run simultaneously. Each creates new files in a distinct subdirectory. The only shared file is `packages/http-core/src/import/index.ts` (barrel export) -- resolve by having each agent create its own module file and having one final agent (or team-lead) wire the barrel.

**Merge conflict risk:** LOW. Each parser is a new file. The barrel `index.ts` is trivial to merge (append-only exports).

**Dependencies:** T020 (file format parser) -- SHIPPED.

**Estimated wall-clock:** 10h (longest single task, all run in parallel).

---

## Batch 2: Postman exporter + Import UI + Load runner polish

**Goal:** T093 needs T090 from Batch 1. T096 needs all importers. T1104/T1105 are independent of M9.

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T093 Postman v2.1 exporter | developer-core (agent A) | 5h | `packages/http-core/src/export/postman.ts` (new), tests |
| T096 "Import from..." menu UI | developer-ui (agent B) | 5h | `apps/desktop/src/renderer/src/components/ImportMenu.tsx` (new), `Sidebar.tsx` (menu trigger), `apps/desktop/src/main/index.ts` (IPC handlers for import), `apps/desktop/src/preload/index.ts` (bridge methods) |
| T1104 Live metrics panel + chart | developer-ui (agent C) | 12h | `apps/desktop/src/renderer/src/components/LoadMetricsPanel.tsx` (new), `apps/desktop/src/renderer/src/components/LoadTestDialog.tsx` (extend) |
| T1105 Export load run results | developer-core (agent D) | 4h | `packages/http-core/src/load/export.ts` (new), tests |

**Parallelism:** All four run simultaneously.
- Agent A and D both touch http-core but in different subdirectories (`export/` vs `load/`). No conflict.
- Agent B touches renderer components + IPC. Agent C touches different renderer components. No overlap -- `LoadTestDialog.tsx` is only touched by agent C; agent B creates a new `ImportMenu.tsx`.

**Merge conflict risk:** LOW. Agent B adds IPC handlers to `main/index.ts` and `preload/index.ts` -- these are append-only registrations. Agent C does not touch those files.

**Dependencies:** Batch 1 must be merged first (T093 depends on T090; T096 depends on T090, T094, T095).

**Estimated wall-clock:** 12h (T1104 is the longest).

---

## Batch 3: Request chaining + GraphQL editor

**Goal:** Start M12 competitive gaps. These are the two largest tasks and have no dependency on each other.

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T1200 Request chaining | developer-core (agent A) | 12h | `packages/http-core/src/variables/capture.ts` (new), `packages/shared-types/src/` (CaptureConfig type), `packages/http-core/src/format/parse.ts` + `serialize.ts` (capture field in .req.yaml), `apps/desktop/src/renderer/src/components/CaptureTab.tsx` (new), `apps/desktop/src/renderer/src/store.ts` (capture scope) |
| T1202 GraphQL body editor | developer-ui (agent B) | 14h | `apps/desktop/src/renderer/src/components/GraphQLEditor.tsx` (new), `apps/desktop/src/renderer/src/components/RequestBuilder.tsx` (add GraphQL body mode), `packages/shared-types/src/` (GraphQL body type) |

**Parallelism:** Both run simultaneously.
- Agent A touches `format/parse.ts` and `format/serialize.ts` -- agent B does NOT touch these.
- Agent A touches `store.ts` for capture scope; agent B touches `RequestBuilder.tsx` for body mode. Different files.
- Both touch `packages/shared-types/src/` but they add different types (CaptureConfig vs GraphQLBody). Merge is append-only.

**Merge conflict risk:** LOW-MEDIUM. The `shared-types` barrel export needs coordination. `RequestBuilder.tsx` is only touched by agent B.

**Dependencies:** T030 (variable resolver) and T034 (autocomplete) -- both SHIPPED. No dependency on Batch 1 or 2.

**Estimated wall-clock:** 14h (T1202 is the longest).

---

## Batch 4: Response diff + Type-aware autocomplete + Packaging kickoff

**Goal:** Remaining M12 tasks + start M10 packaging (which is mostly infra/CI).

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T1201 Response diff viewer | developer-ui (agent A) | 10h | `apps/desktop/src/renderer/src/components/DiffViewer.tsx` (extend existing), `apps/desktop/src/renderer/src/components/HistoryPanel.tsx` (add diff trigger) |
| T1203 Type-aware autocomplete | developer-ui (agent B) | 5h | `apps/desktop/src/renderer/src/components/VariablesPanel.tsx` (extend popup), `apps/desktop/src/renderer/src/store.ts` (resolve preview) |
| T100 electron-builder config | team-lead (agent C) | 6h | `apps/desktop/package.json` (build config), `electron-builder.yml` or equivalent |
| T1105 (if not done in B2) | -- | -- | -- |

**Parallelism:** All three (or four) run simultaneously.
- Agent A: `DiffViewer.tsx`, `HistoryPanel.tsx`.
- Agent B: `VariablesPanel.tsx`, `store.ts`.
- Agent C: `package.json` build config, CI files.
- No file overlap between any pair.

**Merge conflict risk:** LOW. Agent B touches `store.ts` -- but agent A does not. Agent C is entirely in infra files.

**Dependencies:**
- T1201 depends on T370 (history store, SHIPPED) and T1100 (load runner engine, SHIPPED).
- T1203 depends on T034 (SHIPPED).
- T100 depends on T002 (SHIPPED).
- Batch 3 does NOT need to be done first. This batch can run in parallel with Batch 3 if agent capacity allows.

**Estimated wall-clock:** 10h.

---

## Batch 5: Code signing + Auto-update + Docs scaffold

**Goal:** M10 packaging pipeline completion + M13 docs foundation.

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T101 Code signing + notarization | team-lead (agent A) | 8h | `.github/workflows/release.yml`, `apps/desktop/package.json` (signing config), CI secrets config |
| T102 Auto-update (electron-updater) | developer-core (agent B) | 6h | `apps/desktop/src/main/updater.ts` (extend existing), `apps/desktop/src/renderer/src/components/UpdateBanner.tsx` (extend existing), `apps/desktop/package.json` (publish config) |
| T1304 Scaffold Starlight docs | developer-ui (agent C) | 8h | `/docs/` (entirely new directory), `.github/workflows/build.yml` (add docs CI job) |

**Parallelism:** All three run simultaneously.
- Agent A: CI workflow files.
- Agent B: main process updater + renderer UpdateBanner. Does NOT touch CI workflows.
- Agent C: entirely new `/docs/` directory + a small CI addition.

**Merge conflict risk:** MEDIUM. Agent A and agent C both touch `.github/workflows/` but different files (`release.yml` vs `build.yml`). Agent A and B both touch `apps/desktop/package.json` -- agent A for signing config, agent B for publish/update config. **Mitigation:** Merge agent A first, then agent B rebases. Or: have agent B avoid `package.json` changes and leave them for a follow-up.

**Dependencies:** T101 depends on T100 (Batch 4). T102 depends on T101 -- but can start in parallel since the updater code is independent of the signing infra; the CI wiring is the only sequential part.

**Estimated wall-clock:** 8h.

---

## Batch 6: Docs content + M7 full codegen + M8 remaining

**Goal:** Fill out docs, extend codegen to postman-code-generators, handle large responses.

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T1305 Docs: env vars + auth | developer-ui (agent A) | 8h | `/docs/src/content/docs/` (new .mdx files) |
| T1306 Docs: collections + shortcuts | developer-ui (agent B) | 6h | `/docs/src/content/docs/` (new .mdx files, different pages) |
| T070 postman-code-generators integration | developer-core (agent C) | 5h | `packages/http-core/src/codegen/` (extend existing generators.ts or new adapter) |
| T086 Large response streaming | developer-core (agent D) | 8h | `packages/http-core/src/executor.ts` (stream-to-disk logic), `apps/desktop/src/main/index.ts` (IPC for chunked read), `apps/desktop/src/renderer/src/components/ResponseViewer.tsx` (lazy load UI) |

**Parallelism:** All four run simultaneously.
- Agents A and B both write to `/docs/` but different pages -- no conflict.
- Agent C touches `http-core/src/codegen/` only.
- Agent D touches `executor.ts`, `main/index.ts`, `ResponseViewer.tsx` -- none of which overlap with A, B, or C.

**Merge conflict risk:** LOW.

**Dependencies:**
- T1305, T1306 depend on T1304 (Batch 5).
- T070 depends on T011 (SHIPPED).
- T086 depends on T014 (SHIPPED).

**Estimated wall-clock:** 8h.

---

## Batch 7: Codegen polish + Virtual scroll history + Onboarding

**Goal:** Wrap up M7, M8 remaining, M10 onboarding.

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T071 Code panel UI (M7 full) | developer-ui (agent A) | 5h | `apps/desktop/src/renderer/src/components/CodePanel.tsx` (extend for new languages) |
| T072 Codegen auth+proxy coverage | developer-core (agent B) | 6h | `packages/http-core/src/codegen/` (test fixtures, adapter logic) |
| T081b Virtual scroll history panel | developer-ui (agent C) | 10h | `apps/desktop/src/renderer/src/components/HistoryPanel.tsx` (add virtual scroll + FTS search) |
| T103 Onboarding + empty states | developer-ui (agent D) | 6h | `apps/desktop/src/renderer/src/components/WelcomeScreen.tsx` (new), `Sidebar.tsx` (empty state) |

**Parallelism:** All four run simultaneously.
- Agent A: `CodePanel.tsx` only.
- Agent B: `http-core/codegen/` only.
- Agent C: `HistoryPanel.tsx` only.
- Agent D: new `WelcomeScreen.tsx` + `Sidebar.tsx`.
- No overlap.

**Merge conflict risk:** LOW.

**Dependencies:**
- T071 depends on T070 (Batch 6).
- T072 depends on T070 (Batch 6) + T053 (SHIPPED).
- T081b depends on T081 (M3.7, SHIPPED as T370).
- T103 depends on T025 (SHIPPED).

**Estimated wall-clock:** 10h.

---

## Batch 8: Internal rollout

| Task | Agent | Est. | Files touched |
|------|-------|------|---------------|
| T104 Internal rollout + feedback loop | product-manager | 6h | No code changes -- distribution + feedback collection |

**Dependencies:** T102 (auto-update, Batch 5) + T103 (onboarding, Batch 7).

---

## Summary: Critical path

```
Batch 1 (M9 parsers)      ----[10h]----+
                                        |
Batch 2 (M9 UI+export, M11 polish) ----[12h]----+
                                                  |
Batch 3 (M12 chaining+GraphQL) ----[14h]----+    |  (can run parallel with B4)
                                             |    |
Batch 4 (M12 diff+autocomplete, M10 start) -[10h]+  (can run parallel with B3)
                                                  |
Batch 5 (M10 signing+update, docs scaffold) [8h]-+
                                                  |
Batch 6 (docs content, M7, M8 streaming)  --[8h]-+
                                                  |
Batch 7 (M7 polish, M8 virtual, onboard) --[10h]-+
                                                  |
Batch 8 (rollout) -------------------------[6h]---+
```

**Critical path wall-clock:** Batches 1 -> 2 -> 5 -> 6 -> 7 -> 8 = ~54h.
Batches 3 and 4 can run in parallel with Batch 2 (they have no dependency on M9).

**With parallelism exploited:** ~46h wall-clock across all batches, assuming 2-4 concurrent agents.

**Maximum agent concurrency per batch:** 4 agents (Batches 1, 2, 6, 7).

---

## Agent assignment summary

| Agent role | Tasks across all batches |
|------------|--------------------------|
| developer-core | T090, T094, T095, T092, T093, T1105, T1200, T102, T070, T072, T086 |
| developer-ui | T096, T1104, T1202, T1201, T1203, T1304, T1305, T1306, T071, T081b, T103 |
| team-lead | T100, T101 |
| product-manager | T104 |

---

## New tasks to add to tasks.yaml

The following tasks are implied by the plan but do NOT yet exist in tasks.yaml:

None -- all referenced tasks already exist. However, the M9 tasks (T090-T096) may need updated acceptance criteria to reflect the split-parser approach described in this plan. Specifically:
- T090 acceptance should explicitly call out auth migration (Basic/Bearer/OAuth2/ApiKey) and environment variable mapping.
- T094 acceptance already covers folder hierarchy -- good.
- T092 acceptance should specify that HAR export covers load-runner results too (connect to T1105).

## Conflict avoidance rules for agents

1. Each agent works in an isolated worktree (per existing project convention).
2. No two agents in the same batch may modify the same file.
3. Barrel exports (`index.ts` files) are merged by team-lead after all agents in the batch complete.
4. `store.ts` is a high-contention file -- only ONE agent per batch may touch it.
5. `main/index.ts` (IPC registration) and `preload/index.ts` (bridge) are append-only -- safe for sequential merge but NOT parallel edit.
