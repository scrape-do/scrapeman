---
doc: sprint-plan
owner: product-manager
created: 2026-04-17
status: active
---

# Sprint plan — 2026-04-17

## Baseline

Everything through M6, M3.7-M3.13, M4 auth (all 5 schemes), M5 proxy+scrape-do,
M6 cookies+HTTP/2, M11 load runner MVP (T1100-T1104 core + UI), and M13 UX polish
(T1300-T1303, T1307) is shipped. 226 tests passing.

Remaining work spans M9, M10, M11 (chart + export), M7, M8 (partial), M12, and M13 docs.

---

## Sprint 1 — "Get In the Door"
**Duration:** 2026-04-17 to 2026-04-30 (2 weeks)
**Goal:** Users can import their existing Postman/Bruno/Insomnia collection and open Scrapeman for the first time without re-typing a single request.

### Tasks

| ID | Title | Owner | Est |
|----|-------|-------|-----|
| T090 | Postman Collection v2.1 importer | developer-core | 10h |
| T094 | Bruno (.bru) folder tree importer | developer-core | 8h |
| T095 | Insomnia v4 JSON importer | developer-core | 8h |
| T092 | HAR importer + exporter | developer-core | 6h |
| T093 | Postman v2.1 exporter | developer-core | 5h |
| T096 | "Import from..." menu in sidebar header | developer-ui | 5h |

**Total estimate:** 42h (developer-core 37h + developer-ui 5h)

### Priority justification

Import is the single largest adoption gate. An engineer with 200 Postman requests
won't manually recreate them — they will simply not switch. T090, T094, T095 are the
three formats that cover virtually every scrape-do engineer's current setup. T092
adds zero-friction browser capture (devtools HAR). T096 is the UI surface that ties
them together and must land in the same sprint or none of the importers are reachable.

T093 (Postman exporter) is included because trust goes both ways: users will not
import if they can't export back. It also unblocks M10 dogfood adoption since
engineers can stay on Postman as a fallback.

### Agent assignments (can run in parallel)

- **developer-core:** T090 → T094 → T095 → T092 → T093 (sequential, shared
  file-format primitives mean each importer can start after reviewing T090's
  ScrapemanRequest mapping)
- **developer-ui:** T096 starts after T090 ships (needs at least one importer to
  wire the menu to). Can work on T096 UI shell (dialog, file picker, progress state)
  in parallel from day 1 with mocked import result.

### Risk

Bruno's INI-like `.bru` format has no stable published spec — the parser must be
reverse-engineered from the Bruno source. Spike T094 first; if it blows past 12h,
ship Postman + Insomnia + HAR (covers 90% of users) and defer Bruno to Sprint 2.

---

## Sprint 2 — "Ship It"
**Duration:** 2026-05-01 to 2026-05-14 (2 weeks)
**Goal:** Signed, notarized installers land on GitHub Releases and at least 5 scrape-do engineers install and use Scrapeman as their primary client.

### Tasks

| ID | Title | Owner | Est |
|----|-------|-------|-----|
| T100 | electron-builder config for mac/win/linux | team-lead | 6h |
| T101 | Code signing + notarization (mac + win) | team-lead | 8h |
| T102 | Auto-update (electron-updater) on beta channel | team-lead | 6h |
| T103 | Onboarding + empty states + welcome screen | developer-ui | 6h |
| T104 | Internal rollout + feedback loop | product-manager | 6h |

**Total estimate:** 32h

### Priority justification

Signing and notarization are pure friction eliminators. The current "right-click →
Open → confirm" flow is a hard blocker for any non-technical observer at scrape-do
and an annoyance for engineers. Auto-update (T102) is required alongside T101 because
a signed build without update capability means every bug fix requires manual
reinstall — that kills adoption. T103 (onboarding) is the smallest possible surface
that ensures a cold-start user doesn't stare at an empty sidebar and give up.

T104 is a PM task, not an engineering task. The goal is ≥5 active installs with an
open feedback channel within the sprint. If we don't hit that threshold, M12/M13 work
stops until we understand why.

### Agent assignments

- **team-lead:** T100 → T101 → T102 (fully serial; signing depends on build config)
- **developer-ui:** T103 runs in parallel from sprint start (no dependency on T100-T102)
- **product-manager:** T104 starts once T101 + T103 are both done (cannot roll out
  an unsigned build without the workaround we're trying to eliminate)

### Risk

Apple notarization turnaround is unpredictable. Notarytool is usually minutes, but
first-time provisioning (Developer ID cert, app-specific password, entitlements) can
eat a full day. Windows EV cert acquisition can take 5-10 business days — start that
procurement on day 1 of the sprint, not day 5. If Windows cert is late, ship mac
notarized + Linux for the internal rollout and follow up with Windows separately.

---

## Sprint 3 — "GraphQL + Load Runner Complete"
**Duration:** 2026-05-15 to 2026-05-28 (2 weeks)
**Goal:** Ship the #1 competitive gap (GraphQL editor) and close out the load runner with live chart and export so the product matches all M11 exit criteria.

### Tasks

| ID | Title | Owner | Est |
|----|-------|-------|-----|
| T1202 | GraphQL body editor with schema introspection | developer-ui | 14h |
| T1104 (chart) | Live latency-over-time chart in load runner panel | developer-ui | ~6h |
| T1105 | Export load run results (CSV / JSON / HAR) | developer-core | 4h |

**Total estimate:** ~24h

### Priority justification

T1202 is the highest-value M12 item. Every serious API client ships a GraphQL editor.
Scrape-do customers hitting GraphQL endpoints today hand-author raw JSON bodies — that
is a daily friction point. GraphQL mode serializes to the existing HTTP engine; there
is no new transport to build. 14h is achievable in two weeks alongside the smaller
T1104/T1105 items.

T1104 (chart) and T1105 (export) complete M11 to its full exit criteria. The live
latency chart is the visual payoff of the load runner that makes screenshots
compelling for external positioning. T1105 unblocks customers who need to share or
process run results outside the app.

T1200 (request chaining), T1201 (response diff), T1203 (type-aware autocomplete) are
excluded from this sprint. They are competitive gaps but not blockers — users can
work without them. GraphQL is the one gap that causes daily workarounds.

### Agent assignments

- **developer-ui:** T1202 + T1104 (chart) can overlap — T1104 is additive to the
  existing load runner panel and does not conflict with GraphQL work
- **developer-core:** T1105 is self-contained and can run in parallel from day 1

### Risk

Schema introspection for T1202 requires sending a POST to the target endpoint's
`/__graphql` (or user-specified) URL. Introspection may be disabled on some endpoints.
The feature must degrade gracefully (manual mode without autocomplete) or the PR
blocks on a non-representative edge case. Set that expectation in the spec before
writing code.

---

## Sprint 4 — "Docs + Polish"
**Duration:** 2026-05-29 to 2026-06-11 (2 weeks)
**Goal:** External users can install Scrapeman, read the docs to get started, and hit no rough edges in the history or response viewer for large payloads.

### Tasks

| ID | Title | Owner | Est |
|----|-------|-------|-----|
| T1304 | Scaffold documentation site (Astro Starlight) | developer-ui | 8h |
| T1305 | Docs: environment variables + auth schemes | developer-ui | 8h |
| T1306 | Docs: collections + keyboard shortcuts | developer-ui | 6h |
| T086 | Large-response streaming (stream to temp, lazy preview) | developer-core | 8h |
| T081b | History panel virtual scroll (100k entries, instant search) | developer-ui | 10h |

**Total estimate:** 40h

### Priority justification

By Sprint 4 we have a signed installer, importers, and GraphQL. The next adoption
blocker is discoverability. A new user hitting a raw binary response or waiting 3
seconds for a 50MB JSON to render will abandon the tool. T086 fixes the worst-case
performance cliff. T081b fixes the history panel for power users who will
accumulate thousands of entries within weeks of real use.

Docs (T1304-T1306) are prioritized here, not earlier, because they are useless
without a signed installer and importers — no external user is reading docs for a
tool they can't easily install or can't import their collections into.

T1307 (dirty-tab close guard) is already shipped. T1304 is the scaffold; T1305 and
T1306 are content layers that can run in parallel on the same developer-ui slot.

### Agent assignments

- **developer-ui:** T1304 first (2-3 days), then T1305 and T1306 in parallel if
  capacity allows, otherwise sequentially. T081b runs in parallel on any second
  developer-ui capacity.
- **developer-core:** T086 is independent and runs in parallel from sprint start.

### Risk

Astro Starlight (T1304) is a new dependency not currently in the monorepo. Validate
that pnpm workspace setup supports it without conflicts before treating the 8h estimate
as firm. Virtual scroll (T081b) requires switching the history list to
`@tanstack/virtual` — measure render performance against a 100k-entry fixture before
merging; do not ship if p99 scroll frame time exceeds 16ms.

---

## Sprint 5 — "Full Code Gen + Remaining Competitive Gaps"
**Duration:** 2026-06-12 to 2026-06-25 (2 weeks)
**Goal:** Code generation expands to 20+ languages via postman-code-generators; remaining high-value M12 gaps (request chaining, response diff, autocomplete) ship where capacity allows.

### Tasks

| ID | Title | Owner | Est |
|----|-------|-------|-----|
| T070 | Integrate postman-code-generators | developer-core | 5h |
| T072 | Codegen: auth + proxy + scrape-do correctness | developer-core | 6h |
| T1203 | Type-aware variable autocomplete with value preview | developer-ui | 5h |
| T1200 | Request chaining via response variable capture | developer-core | 12h |
| T1201 | Response diff viewer | developer-ui | 10h |

**Total estimate:** 38h

### Priority justification

M7 full code gen (T070 + T072) is low friction to ship — the Code tab already exists,
the hand-written generators already work, and postman-code-generators is a drop-in
adapter. The delta is an IPC mapping layer plus extended language list. It is placed
in Sprint 5 because it does not unblock adoption; it is a quality-of-life addition
for users already in the app.

T1203 (type-aware autocomplete) is a small 5h improvement over the current `{{var}}`
popover that will land in any gap between larger tasks.

T1200 (request chaining) and T1201 (response diff) are the remaining M12 items.
Request chaining unlocks multi-step scraping flows (login → authenticated call) that
currently require copy-pasting tokens between tabs. Response diff is valuable for
users who run load tests and want to compare outputs. Both are included here as
best-effort; if T1200 runs long, T1201 slips to backlog without affecting release
readiness.

### Agent assignments

- **developer-core:** T070 → T072 → T1200 (sequential; chaining depends on core request pipeline)
- **developer-ui:** T1203 → T1201 (parallel with developer-core from sprint start)

### Risk

`postman-code-generators` has significant transitive dependency weight. Audit the
bundle size impact before merging — the renderer must not import it directly. All
codegen must stay in the main process via IPC (established pattern from M3.10).
T1200 is the most underspecified task in this sprint; request chaining scope can
easily inflate. Cap the MVP at JSONPath capture + `{{capture.name}}` substitution —
no UI for conditional logic, no collection-level persistence beyond the session.

---

## Deferred (no sprint assigned)

These items are not scheduled because they do not move the needle on the adoption
or dogfooding metrics that matter right now.

| Item | Reason deferred |
|------|----------------|
| T081 SQLite history upgrade (FTS5 full upgrade) | JSONL store is fast enough for current load; upgrade when engineers report search lag |
| T083 Timings breakdown bar chart | Timings data is already surfaced as numbers; chart is polish with no functional gap |
| M3.11 In-app git integration | Git panel is a differentiator but engineers can use their existing git client; re-evaluate at Sprint 4 dogfood review |
| Collection runner (v1.5) | Out of scope for v1.0 per scope.md |
| OpenAPI/Swagger import | Deferred per scope.md; no engineer has filed this as a blocker |

---

## Success gate before Sprint 3 begins

After Sprint 2 internal rollout (T104):
- **≥5 scrape-do engineers** have Scrapeman installed and used it for at least one
  real request in the week following rollout.
- **Zero P0 bugs** open against import or packaging.

If the adoption threshold is not met, stop Sprint 3 feature work and run a 1-week
diagnostic: interview the engineers who tried it, find the friction point, fix it.
Do not add GraphQL to an app people aren't opening.
