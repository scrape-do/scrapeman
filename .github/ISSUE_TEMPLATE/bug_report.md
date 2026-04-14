---
name: Bug report
about: Something is broken or behaves unexpectedly
title: '[bug] '
labels: ['bug']
assignees: ''
---

## Summary

<!-- One-line description of what went wrong. -->

## Steps to reproduce

1.
2.
3.

## Expected behavior

<!-- What should have happened. -->

## Actual behavior

<!-- What actually happened. Include any console / terminal output. -->

```
<!-- paste DevTools console output or pnpm dev terminal output here -->
```

## Environment

- **OS:** macOS / Windows / Linux (version)
- **Scrapeman version / commit:** <!-- git rev-parse --short HEAD -->
- **Node / pnpm:** <!-- node --version / pnpm --version -->
- **Workspace state:** (e.g. fresh / has existing .req.yaml / has env vars / etc.)

## Additional context

- Does it happen on fresh pnpm install + restart? yes / no
- Does it happen with a brand new workspace folder? yes / no
- Request type (GET/POST/etc.), auth type, proxy enabled?
- Screenshots / screen recording if the issue is UI-related

## Affected area

- [ ] HTTP engine
- [ ] File format / workspace
- [ ] Environment variables
- [ ] Auth (Basic / Bearer / OAuth2 / SigV4)
- [ ] Cookies
- [ ] Proxy / scrape-do native mode
- [ ] History
- [ ] Response viewer (JSON tree / HTML / image / PDF)
- [ ] Code export
- [ ] Load runner
- [ ] Import (curl / Postman / etc.)
- [ ] UI / keyboard / theme
- [ ] Build / dev server
