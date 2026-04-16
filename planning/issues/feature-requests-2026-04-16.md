---
doc: feature-requests
date: 2026-04-16
author: product-manager
status: draft
---

# Feature Requests — 2026-04-16

---

## Feature 1: Collection search

**Priority:** P1
**User story:** As a scrape-do engineer with 50+ saved requests, I want to search the collection sidebar by name, URL, or method so that I can open any request in under 3 seconds without scrolling.

**Why it matters:** Collections are the primary workspace artifact. Once a user has more than ~30 requests across folders, blind scrolling breaks the "faster than Postman" promise. This is table-stakes UX that Postman, Bruno, and Insomnia all provide.

**Acceptance criteria:**
- [ ] A search input appears at the top of the collection sidebar, above the folder tree.
- [ ] The keyboard shortcut `Cmd+F` (mac) / `Ctrl+F` (win/linux), when the sidebar has focus, moves focus directly to the collection search input.
- [ ] Typing filters the tree in real time (no submit required) with no perceptible lag (<100ms debounce).
- [ ] Filtering matches against: request name, full URL (including path), and HTTP method.
- [ ] Matching is case-insensitive and substring-based (e.g. "auth" matches "Get Auth Token").
- [ ] Folders that contain at least one match remain visible and expanded; folders with zero matches are hidden.
- [ ] The matched substring is highlighted in the request label in the filtered results.
- [ ] When the search input is cleared or `Escape` is pressed, the tree returns to its previous expanded/collapsed state.
- [ ] An empty-state message ("No requests match") is shown when no results are found.
- [ ] The search input is cleared when the user switches workspaces or collections.

**Scope boundaries (do NOT):**
- Do not search history from this input — that is a separate panel with its own search.
- Do not add fuzzy/semantic matching; substring is sufficient for v1.
- Do not persist the search term across sessions.
- Do not add search result count badges on folder nodes (defer to v1.5 if requested).

**Open questions:**
- Should `Cmd+F` globally trigger collection search, or only when the sidebar is focused? Postman scopes it globally. Recommend global — lower friction.

---

## Feature 2: Headers/Params table UX improvements

**Priority:** P1
**User story:** As a developer building requests with many headers or query parameters, I want keyboard-native row insertion so that I can fill in a full parameter table without touching the mouse.

**Why it matters:** Every round-trip from keyboard to mouse breaks flow. Postman and Insomnia both support these interactions. Without them, power users notice and it undercuts the "Postman-grade polish" positioning pillar.

**Acceptance criteria:**

### 2a — Shift+Enter inserts a new row below
- [ ] When focus is on any cell in the headers or params table, pressing `Shift+Enter` inserts a new empty row immediately below the current row.
- [ ] Focus moves to the Key cell of the newly inserted row.
- [ ] The new row is enabled (checkbox checked) by default.
- [ ] This behavior is consistent across both the Headers tab and the Params tab.

### 2b — Tab from last row auto-appends
- [ ] When focus is on the Value cell of the last row in the table, pressing `Tab` appends a new empty row at the end of the table.
- [ ] Focus moves to the Key cell of the newly appended row.
- [ ] Tabbing from the Key cell to the Value cell of a non-last row does NOT create a new row — it simply moves to Value.
- [ ] If the last row is the placeholder "empty" row (already blank), Tab should move focus into it rather than appending another row.
- [ ] This behavior is consistent across both the Headers tab and the Params tab.

**Scope boundaries (do NOT):**
- Do not add row reordering via keyboard (drag-to-reorder only, v1).
- Do not change `Enter` alone — it should not insert a row (conflicts with committing a cell value).
- Do not apply this to the Body form-urlencoded table unless the implementation is trivially shared; scope that separately if needed.

**Open questions:**
- None — behavior is well-defined by the two sub-issues. Mirrors Postman exactly.

---

## Feature 3: Cmd+N auto-focus URL bar

**Priority:** P1
**User story:** As a developer opening a new request tab, I want the URL input to receive focus automatically so that I can start typing immediately without clicking.

**Why it matters:** This is how every browser and API client behaves. The absence of it introduces a mandatory mouse click on every new request, which is friction that accumulates across a full workday. It directly conflicts with "Postman-grade polish."

**Acceptance criteria:**
- [ ] When a new tab is opened via `Cmd+N` (mac) / `Ctrl+N` (win/linux), the URL input receives focus and the cursor is placed inside it.
- [ ] When a new tab is opened by clicking the "+" button in the tab bar, the URL input receives focus in the same way.
- [ ] If a request is loaded into a tab (e.g. opened from the collection tree), the URL input does NOT steal focus — user may be reviewing the request without intending to edit.
- [ ] Focus is placed at the end of any pre-existing URL text in edge cases where a default URL is populated (e.g. from a template).
- [ ] The URL input is not just visually highlighted — it must be programmatically focused so that typing immediately enters text without any click.

**Scope boundaries (do NOT):**
- Do not auto-focus when switching between existing tabs — only on new tab creation.
- Do not auto-select the existing URL text on new tab (start with empty input; selection behavior on existing URLs is a separate UX question).

**Open questions:**
- None.

---

## Feature 4: Documentation site

**Priority:** P2
**User story:** As a scrape-do customer or new engineer onboarding to Scrapeman, I want "how to use" documentation so that I can get from install to first working request without asking a teammate.

**Why it matters:** Without docs, adoption beyond the core team stalls. The secondary user segment (scrape-do customers) cannot self-serve, and the tertiary segment (generic API developers) will not trust an undocumented tool.

**Acceptance criteria:**
- [ ] The following pages exist and are publicly accessible:
  - Getting started: install steps for mac/win/linux, send a first request, save to collection.
  - Environment variables: `{{var}}` syntax, scope precedence (global → collection → environment → per-request), built-in dynamics (`{{random}}`, `{{timestamp}}`, `{{isoDate}}`, `{{randomInt}}`), secret flag behavior.
  - Auth schemes: setup walkthrough for each of the 5 schemes (None, Basic, Bearer, API Key, OAuth2, AWS SigV4 — note: 6 schemes per scope.md).
  - Collections and file format: YAML structure with an annotated example, git workflow guide.
  - Load runner: configure N and C, read live metrics, stop a run, export results.
  - Keyboard shortcuts: complete reference table.
  - Proxy configuration: standard proxy setup, scrape-do native mode toggle and parameter UI.
- [ ] Every page has a "last updated" date visible to the reader.
- [ ] The docs are reachable from a link in the Scrapeman app (Help menu or "?" icon).
- [ ] The docs are reachable from the scrapeman.app landing page.
- [ ] Search across doc pages works (basic, not AI-powered).

**Platform recommendation: Starlight (Astro) as a `/docs` subdirectory of scrapeman-landing**

Rationale and tradeoffs:

The three viable options are:

1. **Docusaurus** — React-based, mature, excellent search (Algolia), but adds a heavy Node/React build pipeline separate from the existing Astro landing page. Two separate repos/frameworks to maintain.

2. **Mintlify** — Hosted, polished, zero ops overhead, but it is a third-party SaaS. History of pricing changes, and it means docs live outside the repo. Conflicts with local-first, self-controlled philosophy.

3. **Starlight (Astro)** — Built on Astro, which the landing page already uses (scrapeman-landing is Astro per the working directory). Adding a `/docs` route is a single `@astrojs/starlight` integration install. One repo, one deploy pipeline, built-in search (pagefind, client-side, no API key), MDX supported, sidebar navigation out of the box. The maintenance surface is minimal.

Recommendation: Starlight as `/docs` within the existing scrapeman-landing repo. It reuses the existing Astro build, keeps docs and marketing under one deployment, and avoids external SaaS dependency. The only tradeoff is that Starlight's theming is more opinionated than Docusaurus — acceptable given the time savings.

**Scope boundaries (do NOT):**
- Do not build API reference docs — Scrapeman is a desktop app, not a library.
- Do not add interactive "try it" widgets in docs.
- Do not add versioned docs for v1.0 — single version until a breaking change ships.
- Do not add a community forum or feedback widget (docs only).
- Do not set up Algolia DocSearch — pagefind (built into Starlight) is sufficient for this content volume.

**Open questions:**
- Is scrapeman-landing the correct repo for docs, or does it live in the main scrapeman repo under a `docs/` folder? Recommend landing repo to keep the desktop app repo focused on app code.
- Who owns writing the initial content — PM drafts, devs review? Needs an owner before this is scheduled.
