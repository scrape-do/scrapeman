---
doc: glossary
owner: team-lead
status: draft
updated: 2026-04-14
---

# Glossary

- **Workspace** — A user-chosen directory on disk containing collections and environments. Git-managed by the user.
- **Collection** — A folder tree of requests + metadata inside a workspace.
- **Request** — A single HTTP call definition, stored as one file.
- **Environment** — Named set of variables (global/collection/environment/request scopes). Lives under `.scrapeman/environments/`.
- **Secret variable** — A variable marked secret, stored via keytar (OS keychain) or encrypted file, never written to the workspace file.
- **scrape-do native mode** — Per-request toggle that routes through the scrape-do proxy and exposes scrape-do parameters as a structured UI instead of manual URL composition.
- **Request executor** — Internal interface abstracting the HTTP engine. v1 has PostmanRuntimeAdapter and Http2Adapter implementations.
- **File format** — Custom YAML-like format, one request per file, optimized for git diffs. See `file-format.md` (TBD in M0/T004).
- **Runtime** — Shorthand for `postman-runtime`, the library handling auth, cookies, variables, redirects in v1.
- **Codegen** — Shorthand for `postman-code-generators`, used in M7 to produce curl/Go/Python/JS snippets.
