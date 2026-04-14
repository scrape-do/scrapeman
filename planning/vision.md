---
doc: vision
owner: product-manager
status: draft
updated: 2026-04-14
---

# Vision

## One-liner
Postman-grade UI/UX, Postman's paid features for free, local-first with optional git sync for collections — purpose-built for scraping workflows.

## Positioning pillars
1. **Postman-grade polish.** UI/UX stability and feel must match Postman, not Bruno. This is non-negotiable — if it feels clunky, we failed.
2. **Paid features, free.** Everything Postman paywalls that fits our scope ships free and unlimited: history, collection runs, environments, advanced auth, request chaining, response diff.
3. **Local-first, no sync service.** History lives only on the local machine — fast, private, no accounts. Collections can optionally be committed to a git repo the user controls; sync is git, not us.

## Target users
1. **Primary:** scrape-do engineers debugging proxy/rendering flows, reproducing customer requests, validating new API parameters.
2. **Secondary:** scrape-do customers testing their own scraping requests against the scrape-do API before integrating.
3. **Tertiary:** generic API developers who want a lightweight Postman alternative.

## Why not just use X
- **Postman:** heavy, account-gated, poor git story, UI bloat, not proxy-aware.
- **Bruno:** right model (git, local files) but UI feels clunky and slow per user feedback; limited proxy UX.
- **Insomnia:** cloud-first since Kong acquisition, trust issues.
- **curl + scratch files:** no collaboration, no reusable environments, no response diffing.

## North-star user moments
1. Paste a curl command → get an editable request in <2s.
2. Toggle "through scrape-do" on any request → automatic proxy + token injection + parameter UI.
3. Commit a collection to git → teammate pulls → diffs are human-readable.
4. Hit "generate code" → copy-paste ready Go/Python/curl snippets.
5. Response renders in <100ms for typical HTML payloads, no UI jank on 10MB responses.

## Success metrics (6 months post-launch)
- Internal: ≥80% of scrape-do engineers use it weekly instead of Postman/Bruno.
- Dogfooding: ≥200 collections committed across scrape-do repos.
- External (if released): ≥1k GitHub stars, ≥50 active external users.

## Non-goals (explicit)
- **History sync across devices.** History is local-only, never uploaded, never synced. This is a feature, not a limitation — it keeps history instant and private.
- Cloud accounts, team workspaces, hosted sync service.
- Mock servers, monitors, API documentation hosting.
- Mobile client.
- WebSocket/gRPC/GraphQL dedicated UIs in v1 (HTTP only).

## "Free what Postman paywalls" — concrete list
These ship unlimited in v1 (or v1.5 where noted):
- **Unlimited local history** (Postman free: capped, paid: unlimited cloud history)
- **Unlimited collection runs** via bulk runner — v1.5 (Postman free: 25/month)
- **Unlimited environments + variables** (Postman free: limited)
- **Advanced auth (OAuth2 all flows, AWS SigV4)** without paywall
- **Request chaining** via variable capture — v1.5 (Postman: Flows, paid)
- **Response compare/diff** between runs — v1.5 (Postman: paid)
- **Code generation to all targets** (Postman: free but limited formatting)
- **Git-based sharing** (Postman: paid workspaces for team sharing)
