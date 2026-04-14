---
doc: postman-research
owner: product-manager
status: reference
updated: 2026-04-14
---

> **Data source:** Training knowledge, cutoff August 2025. Section 3 should be refreshed with live changelog data.

# Postman competitive research

Purpose: inform post-M4 sprint planning. Sections 1-3 are Postman intelligence; section 4 is the gap analysis against `planning/postman-parity.md`; section 5 is the prioritized backlog recommendation.

---

## 1. Features users love that Bruno and Insomnia lack

These are the reasons engineers reach for Postman even when they philosophically prefer local-first tools.

### 1.1 Response visualization

Postman's "Visualize" tab lets you write a Handlebars template in the test script and render a custom HTML view of any response — tables, charts, whatever. Bruno has no equivalent. Insomnia dropped it during the Kong rewrite. For scraping engineers this is relevant when you need a quick readable diff of two paginated responses or a rendered HTML preview of a scrape output — but the core value is table/chart rendering of JSON arrays. Low priority for Scrapeman v1 but worth watching.

### 1.2 Variable autocomplete and quick-look

Postman surfaces `{{` autocomplete in every text field, showing the resolved value inline. It also has an "eye icon" button that pops a resolved-value panel for the active environment. Bruno's autocomplete is functional but slow and incomplete. Insomnia's is comparable to Postman's but the cloud-first rebrand eroded trust. This is a quality-of-life feature engineers notice daily.

### 1.3 Code generation quality and breadth

Postman generates code for 20+ targets, includes auth headers correctly, handles multipart bodies, and formats output legibly. Bruno generates curl and a handful of others, but the generated code is often missing auth or has wrong content-type headers on multipart. Insomnia's codegen is similar quality to Postman's but limited to fewer targets post-Kong. For scraping engineers who need to paste a working Python `requests` snippet with proxy and bearer token in one shot, Postman wins.

### 1.4 History searchability and restore

Postman's paid history is unlimited and cloud-synced with search by URL, status, and date. Free tier caps at 25 requests. Bruno has no built-in history — you rely on git history of your collection files, which only captures saved requests, not every send. Insomnia (pre-Kong) had local history. This is the single biggest day-to-day pain point engineers mention when switching away from Postman — losing the "what did I send 20 minutes ago" capability.

### 1.5 Pre-request and test scripts (pm.* API)

Postman's sandbox lets you write JavaScript to set variables, parse tokens, chain requests, and run assertions. Bruno has a `script` block but the API surface is smaller and the sandbox is less stable (race conditions on variable writes have been reported in open issues). Insomnia has pre-request scripts in the new version but only behind a paid plan. This is the hardest feature to replicate and we have correctly excluded it from v1 scope.

### 1.6 OAuth2 browser-based flow UX

Postman pops a real browser window for authorization code flows, handles the redirect callback on a local port, and caches the token without leaving the app. Bruno's OAuth2 support is partial — client credentials work, auth code is fragile. Insomnia's is behind a paid tier. For scraping engineers hitting auth-protected APIs this is non-trivial friction.

### 1.7 Timings breakdown

Postman shows DNS lookup, TCP connect, TLS handshake, TTFB, and download time per request. Bruno shows total time only. This is directly relevant to scraping engineers diagnosing proxy overhead — the difference between 800ms TLS and 200ms TTFB is actionable; total 1s is not.

### 1.8 Collection-level auth inheritance

Postman lets you set auth at the collection or folder level, and child requests inherit or override. Bruno does this too (it's one of Bruno's strengths). Insomnia has it. This is table stakes — its absence would be a hard blocker.

---

## 2. What people hate about Postman — Scrapeman opportunities

These are documented pain points from Postman's own community forums, GitHub issues, Reddit (r/webdev, r/devops), and Hacker News threads up to August 2025.

### 2.1 Forced cloud sync and mandatory account (biggest complaint)

Postman made workspace sync cloud-only and requires an account to use the app at all as of v10. Local backups are gone. Engineers cannot use Postman offline reliably. On enterprise networks with strict egress, Postman is blocked. The GitHub issue tracker for the "offline mode" request has thousands of upvotes and Postman has not reversed the decision.

**Scrapeman opportunity:** This is our single biggest structural advantage. Local-first, no account, no sync service is a promise we must keep and communicate loudly.

### 2.2 UI bloat and slow startup

Postman loads a Chromium-based shell with cloud features, team dashboards, API design editors, and flow builders that most engineers never touch. Startup time on a MacBook Pro M2 is reported between 5-10 seconds; first request is often blocked by background sync. Engineers who just want to send a request resent paying that overhead daily.

**Scrapeman opportunity:** Fast startup, no cloud calls on launch. Benchmark this before M10 and make it a public claim.

### 2.3 Pricing cliff (Free → Team → Enterprise)

Postman's free tier became severely restricted after 2023: history capped at 25 requests, collection runner capped at 25 runs/month, no mock server hours, limited team members. The Team plan is $14/user/month. Many engineers on small teams were hit by this cold after years of free usage.

**Scrapeman opportunity:** "Free forever for everything we build" is the pitch. We need to be specific about what that means (unlimited history, unlimited collection runs, unlimited environments) and hold the line when monetization pressure comes.

### 2.4 Git story is painful

Postman collections are stored in the cloud. To get them into git you have to use the Postman API or manually export JSON. The JSON format includes metadata, timestamps, and generated IDs that produce noisy diffs. Collaboration via git is not a first-class workflow.

**Scrapeman opportunity:** Our file format (one request per YAML, no generated IDs, stable key order) is a direct answer to this. This resonates strongly with engineering teams that live in git.

### 2.5 Data privacy / telemetry concerns

Postman sends request bodies to Postman's servers for certain cloud features (collection sync, monitors). Engineers hitting internal APIs or APIs with credentials embedded in bodies have reported discomfort. On enterprise security reviews this is a blocker.

**Scrapeman opportunity:** Zero telemetry on request/response bodies. Make this explicit in the README and in the settings UI. For scraping engineers hitting authenticated internal APIs this matters.

### 2.6 Heavy resource consumption

Postman idle RAM usage is reported between 400-800MB. On machines running multiple dev tools this is significant. The Electron shell plus Chromium plus background sync adds up.

**Scrapeman opportunity:** Leaner Electron stack. We should instrument memory usage and aim for <200MB idle. Publish the benchmark.

### 2.7 Pre-request scripts cause version lock-in

Engineers who built workflows on Postman's `pm.*` script API are locked in because the API is proprietary. Migrating to Bruno means rewriting all scripts. This creates resentment toward Postman while also making engineers reluctant to migrate.

**Scrapeman opportunity:** We correctly skipped scripts in v1. When we add scripting in v2, we should not invent a proprietary API — use a standard like Web Fetch API + standard JS. Compatibility with Bruno's scripting model would be a bonus.

### 2.8 The Postman Flows product nobody asked for

Postman invested heavily in "Flows," a low-code API chaining builder. It occupied engineering bandwidth and UI real estate that engineers did not want. The community reaction was largely negative — engineers wanted offline mode and a better git story, not a visual workflow builder.

**Scrapeman opportunity:** Scope discipline. We are not building Flows. We are not building anything that competes with n8n or Zapier. Every time someone internally suggests "what if we added a visual flow builder" the answer is no.

---

## 3. Recent Postman investments (up to August 2025)

**Refresh signal:** This section has the highest staleness risk. Before post-M4 sprint planning, pull the Postman changelog at https://www.postman.com/release-notes/ and compare against these items.

### 3.1 AI-assisted request building ("Postbot")

Postman shipped "Postbot," an AI assistant embedded in the UI. It can generate test scripts from a request/response pair, suggest fixes for failing tests, generate documentation for a collection, and write pre-request scripts from natural language. As of mid-2025 it is available on paid plans only, with a limited free tier.

**Relevance for Scrapeman:** Postbot's test generation is its most-praised capability. We have excluded test scripts from v1 scope, so we cannot offer an equivalent. If we add scripting in v2, AI-assisted script generation becomes a differentiator we should plan for. The code generation use case (prompt → curl snippet) is lower value because we already have explicit code generation.

### 3.2 Enterprise and SSO push

Postman has been aggressively expanding enterprise features: SCIM provisioning, SSO/SAML, audit logs, private API network, role-based access control at the workspace level. This signals Postman is moving upmarket. The free/team tiers are increasingly loss leaders to get organizations on enterprise contracts.

**Relevance for Scrapeman:** Good news for us. Postman's upmarket move means the free tier gets worse and small-team engineers get squeezed harder. Our window for capturing that audience grows.

### 3.3 Secret detection / vault integration

Postman added automatic scanning of collection variables for secrets (tokens, passwords, API keys) and can optionally send them to a vault. They also added warnings when a secret is accidentally committed to a shared workspace.

**Relevance for Scrapeman:** We have secret variables with masked display and optional OS keychain. We do not scan for secrets in raw header values. This is a reasonable v1.5 addition — flag obvious patterns (Bearer tokens, AWS keys) in header values and suggest moving them to a secret variable.

### 3.4 OpenAPI 2-way sync

Postman added bidirectional sync between a collection and an OpenAPI 3.x spec. Changes to the spec update the collection and vice versa. This is primarily an API design workflow feature, not a testing workflow feature.

**Relevance for Scrapeman:** We have deferred OpenAPI import to v1.5 and we explicitly out-of-scope the API design editor. This Postman feature is not a gap we need to close — it serves a different workflow.

### 3.5 Improved mock server and monitoring

Postman has invested in making mock servers first-class: dynamic response logic, response examples per status code, built-in versioning. Monitors can now run on custom infrastructure (agent-based) rather than only Postman's cloud.

**Relevance for Scrapeman:** Both are explicitly out of scope and non-goals. No action needed.

---

## 4. Scrapeman gap analysis

Cross-referenced against `planning/postman-parity.md`. Gaps are features Postman does well that we currently lack or have deferred past v1.

Only gaps that matter for the primary user (scrape-do engineers debugging proxy/rendering flows) are listed. Cloud features, mock servers, and monitors are omitted — they are correct non-goals.

### Gap 4.1 — Timings breakdown [planned M8, scraping-critical]

Postman shows DNS / TCP connect / TLS / TTFB / download split per request. We plan this in M8. For scraping engineers, this is the most actionable latency signal — proxy overhead shows up in connect/TLS, rendering latency shows in TTFB, payload size shows in download. Deferring this to M8 means engineers using Scrapeman from M5 (proxy + scrape-do mode) onwards won't have this until late. Consider pulling it forward to M5 or making it a stretch goal of the proxy milestone — it is directly tied to validating scrape-do proxy performance.

### Gap 4.2 — HTML preview in response viewer [planned M8, scraping-critical]

Postman renders a live HTML preview of response bodies. For scraping engineers the primary output of a scraping request is HTML. Looking at raw HTML in a text editor to verify that a page was rendered correctly is painful. We have this planned in M8 but it is arguably more scraping-relevant than JSON tree (also M8). Sequencing within M8 should put HTML preview before JSON tree.

### Gap 4.3 — Variable autocomplete in text fields [deferred v1.5]

Postman completes `{{` in every text field showing variable names and resolved values. We have this deferred to v1.5. For engineers juggling 10+ scrape-do parameters (token, geoCode, render, waitUntil, super) across multiple environments, the absence of autocomplete creates friction. This is a daily-use polish gap, not a blocking gap. Keep it v1.5 but make it the first priority in that release.

### Gap 4.4 — Collection runner [deferred v1.5, scraping-relevant]

Postman's collection runner executes a sequence of requests with data-driven inputs (CSV/JSON), captures responses, and reports pass/fail. We have the load runner (one request, N times) in v1 and the collection runner deferred to v1.5. For scraping engineers validating a multi-step auth flow (login → get token → use token → verify scrape) the collection runner is the right tool. The load runner does not replace it. The deferral is correct — do not pull this forward — but do not let it slip past v1.5.

### Gap 4.5 — Response diff between two runs [deferred v1.5, scraping-relevant]

Postman does not have this natively either (it requires external tooling or test scripts). We have planned it for v1.5 as history entry diff. For scraping engineers validating that a proxy configuration change did or did not affect the scraped HTML, diff between two history entries is extremely high value. This is an area where we can leapfrog Postman. Keep it high priority within v1.5 — it is a differentiator, not a catch-up feature.

### Gap 4.6 — Pre-request scripts / request chaining [out of scope v1]

Postman's script sandbox enables dynamic token extraction, request chaining, and conditional logic. We excluded scripts correctly. The v1.5 request chaining feature (use response A as input to B via simple variable capture, no scripting) covers ~60% of the real use cases engineers hit — namely: hit a login endpoint, grab the token from response body, use it in subsequent requests. Make sure the v1.5 chaining design handles this pattern explicitly.

### Gap 4.7 — Postbot / AI-assisted script generation [not planned]

No equivalent in Scrapeman. Not a gap for v1 given we have no scripts. If scripting lands in v2, AI-assisted generation becomes worth revisiting. No action now.

### Gap 4.8 — Secret detection in header values [not planned]

Postman flags raw credentials in header values. We mask declared secret variables but do not scan for credentials in non-secret fields. This is a v1.5 quality-of-life addition. Low urgency but adds to the "privacy-first" narrative.

### Gap 4.9 — Console / debug log [deferred v1.5]

Postman has a console showing all request/response details including script output. For scraping engineers this matters when debugging why a request works in Postman but fails in code — the console shows the actual wire headers. We have this deferred. It is more important than it looks: the gap between "what Scrapeman sent" and "what curl says it sent" is real and the console is the answer.

### Gap 4.10 — Dark theme [planned M8]

Bruno has dark theme. Postman has dark theme. We have it planned for M8. Engineers who use dark mode everywhere notice this immediately. It does not block adoption but it signals polish. Do not defer past M8.

---

## 5. Top 5 recommended priorities for post-M4 backlog

Ranked by: (a) scraping engineer relevance, (b) how badly Postman handles / doesn't handle it, (c) implementation cost estimate.

---

### Priority 1 — Timings breakdown (pull forward from M8 to M5/M6)

**Scraping relevance:** 10/10. Every scraping engineer debugging proxy latency needs this.
**Postman gap:** Postman does it fine. This is parity, not differentiation — but the absence hurts badly.
**Implementation cost:** Low. The HTTP engine (undici) already surfaces timings in the response metadata. It is a UI-only addition: one timings row below the response status bar. Estimate 1 day.
**Recommendation:** Pull into M5 or M6 scope. The proxy milestone (M5) ships scrape-do native mode. Engineers will immediately want to see where the proxy is adding latency. Shipping M5 without timings is a missed opportunity.

---

### Priority 2 — HTML preview in response viewer (reprioritize within M8)

**Scraping relevance:** 9/10. The primary output of a scraping workflow is HTML. Reading raw HTML to verify rendering is painful.
**Postman gap:** Postman has a decent HTML preview using a sandboxed iframe. Bruno has a basic preview that doesn't execute scripts (correct security posture). We should match Bruno's approach — render in a sandboxed webview, no script execution.
**Implementation cost:** Medium. Electron gives us a webview element. The work is sandboxing it correctly and building the toggle between raw/pretty/preview. Estimate 2-3 days.
**Recommendation:** Within M8, schedule HTML preview before JSON tree. JSON tree is a nice-to-have for API engineers; HTML preview is table stakes for scraping engineers.

---

### Priority 3 — Response diff between two history entries (v1.5 first priority)

**Scraping relevance:** 9/10. "Did this proxy config change break the scraped content?" requires diff.
**Postman gap:** Postman does not have this natively. This is a leapfrog opportunity, not a catch-up.
**Implementation cost:** Medium. We will have history stored in SQLite by M3.7. Selecting two entries and running a text diff (using `diff-match-patch` or similar) on their response bodies is well-understood. The UI work (side-by-side or inline diff view) is the bulk of the effort. Estimate 3-4 days.
**Recommendation:** Make this the launch feature of v1.5. Lead with it in internal communications as "the thing Postman can't do."

---

### Priority 4 — Request chaining via variable capture (v1.5, design it now)

**Scraping relevance:** 8/10. Multi-step scraping flows (auth → token → scrape) require chaining.
**Postman gap:** Postman requires script sandbox for this (pm.environment.set in a test script). We can solve 80% of this use case without a script sandbox by adding a "capture" rule to a request: "from the response, extract JSON path $.token and set it as env variable SESSION_TOKEN." This is deterministic, no JS required.
**Implementation cost:** Medium-high. The capture rule UI is simple. The execution model (run request A, apply captures, then run request B with the new variable) requires a runner that respects ordering. Estimate 5-7 days.
**Recommendation:** Start the design spec now (pre-M5), even though implementation is v1.5. The design will constrain how we structure the request schema and runner — better to know the shape before we lock the file format in M9.

---

### Priority 5 — Variable autocomplete and quick-look (v1.5, high-frequency daily friction)

**Scraping relevance:** 7/10. Engineers with 10+ scrape-do parameters and multiple environments will hit this daily.
**Postman gap:** Postman's autocomplete is polished. Bruno's is functional but laggy. We have nothing in v1.
**Implementation cost:** Low-medium. We already parse `{{var}}` in all text fields (HighlightedInput exists). Adding a dropdown that appears after `{{` with filtered variable names and resolved values is a UI-only addition. The resolved-value panel ("eye icon") is additional but small. Estimate 2-3 days total.
**Recommendation:** First feature shipped in v1.5, immediately after response diff. It has the highest frequency-of-use of anything in the v1.5 backlog.

---

## Summary table

| Priority | Feature | Milestone | Effort | Scraping relevance | Leapfrog potential |
|---|---|---|---|---|---|
| 1 | Timings breakdown | Pull to M5/M6 | 1d | Critical | Parity |
| 2 | HTML preview in response | Reprioritize in M8 | 2-3d | Critical | Parity |
| 3 | Response diff (history) | v1.5 launch feature | 3-4d | High | Leapfrog |
| 4 | Request chaining (design now) | v1.5 | 5-7d | High | Better than Postman |
| 5 | Variable autocomplete + quick-look | v1.5 first | 2-3d | Medium | Parity |
