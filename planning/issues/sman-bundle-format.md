---
doc: format-spec
date: 2026-04-17
author: team-lead
status: draft
---

# `.sman` — Scrapeman collection bundle format

## Purpose

Individual requests stay as `.req.yaml` files in the workspace (git-friendly, editor-friendly, diffable). The `.sman` format is a **portable bundle** for sharing, importing, and exporting entire collections in one file.

Use cases:
- "Send me your collection" — email or Slack a single `.sman` file
- Import from Scrapeman to Scrapeman (different machine, different team)
- Export a snapshot of a workspace for backup
- OS file association: double-click `.sman` → Scrapeman opens and offers to import
- Future: publish `.sman` bundles to a public collection directory

## Format: ZIP archive with YAML contents

A `.sman` file is a standard ZIP archive (same approach as `.docx`, `.epub`, `.sketch`). Rename to `.zip` and any tool can inspect it.

### Internal structure

```
collection-name.sman (ZIP)
├── manifest.yaml
├── requests/
│   ├── get-users.req.yaml
│   ├── auth/
│   │   └── login.req.yaml
│   └── products/
│       ├── list.req.yaml
│       └── detail.req.yaml
├── environments/
│   ├── dev.env.yaml
│   └── production.env.yaml
├── files/                          # body sidecars (binary payloads)
│   └── list.body.json
└── settings.yaml                   # optional workspace-level settings
```

### manifest.yaml

```yaml
format: sman
version: 1
name: "My API Collection"
description: "Optional description"
created_at: "2026-04-17T10:00:00Z"
scrapeman_version: "0.2.1"
request_count: 4
environment_count: 2
```

### Rules

1. **requests/** contains the same `.req.yaml` files that live in the workspace — no transformation, byte-for-byte identical. Folder hierarchy preserved.
2. **environments/** contains `.env.yaml` files, same format as workspace environments. Secret values are EXCLUDED by default (replaced with empty string + a `# secret: redacted` comment). An `--include-secrets` flag on export overrides this.
3. **files/** contains body sidecars (payloads >= 4KB that were promoted to sidecar files in the workspace). Referenced by relative path from the `.req.yaml`.
4. **settings.yaml** is optional. Contains workspace-level config (default proxy, default timeout, scrape-do token placeholder) but NOT user-specific state (active tab, window position, etc.).
5. **manifest.yaml** is required. Scrapeman reads it first to validate the bundle before extracting.

### Import flow

1. User drags `.sman` file onto Scrapeman window, or uses "Import from..." menu, or double-clicks in OS
2. Scrapeman reads manifest.yaml from the ZIP without extracting everything
3. Shows a preview dialog: "Import 4 requests, 2 environments into workspace X?"
4. On confirm: extracts `.req.yaml` files into the workspace folder, `.env.yaml` into `.scrapeman/environments/`, body sidecars into `files/`
5. File watcher picks up the new files, sidebar updates

### Export flow

1. User right-clicks a folder in the sidebar → "Export as .sman"
2. Or: File menu → "Export collection..."
3. Scrapeman walks the selected folder (or entire workspace), collects all `.req.yaml` + sidecars + environments
4. Writes manifest.yaml with metadata
5. Creates ZIP, saves to user-chosen location with `.sman` extension
6. Secrets are stripped by default, user can opt in to include them

### Why ZIP, not a flat YAML/JSON file

- Binary body sidecars (images, PDFs, protobuf payloads) cannot live in YAML/JSON without base64 bloat
- Individual files inside the ZIP are still human-readable YAML — `unzip collection.sman && cat requests/login.req.yaml` works
- ZIP is universally supported (macOS Archive Utility, 7-Zip, Python zipfile, Node yazl/yauzl)
- Compression is free — typical collection bundles will be 60-80% smaller than the raw files
- File-level integrity via ZIP CRC32

### OS file association (future, M10 scope)

- macOS: `Info.plist` UTI declaration for `.sman` + document type handler
- Windows: NSIS installer registers `.sman` file extension → opens Scrapeman
- Linux: `.desktop` file with MimeType entry

### Relationship to other formats

| Format | Individual requests | Collection bundle |
|---|---|---|
| Scrapeman | `.req.yaml` (git-friendly) | **`.sman`** (ZIP, portable) |
| Postman | — | `.postman_collection.json` (flat JSON) |
| Bruno | `.bru` (custom INI) | folder (no single-file bundle) |
| Insomnia | — | `.insomnia` export (flat JSON) |
| HAR | — | `.har` (flat JSON, response-only) |

Scrapeman is the only tool that separates "git-friendly individual files" from "portable sharing bundle." This is a deliberate design decision.
