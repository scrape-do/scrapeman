# Changelog

All notable changes land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.4.0] — 2026-04-22

### Added
- Screenshot capture button in the request header. Hides the sidebar, tab bar and action buttons, then opens a modal with the PNG and a copy-to-clipboard button that uses Electron's native `clipboard.writeImage`. A "Tested with Scrapeman" watermark sits in the bottom-right of the captured frame.
- Git pull now prompts on diverged branches instead of aborting. Dialog offers Rebase, Merge commit, or Cancel; the pick is passed through IPC to `git pull --rebase` or `git pull --no-rebase --no-ff`. Auth, network, and merge-conflict errors render as plain English banners. A three-second inline badge confirms the pull strategy that ran.
- Drag-to-reorder rows in Params and Headers. Hover-only grip handle on the left; a two-pixel accent line appears above or below the hovered row based on cursor position, and the drop lands at that edge.
- Bulk header edit. Pencil toggle at the top-right of the Headers table opens a textarea where each line is `Key: Value`; a `//` prefix disables that line. Round-trip between table and textarea is lossless, `{{var}}` placeholders preserved.
- JSON body beautify. Button shows up when body mode is `json`; Shift+Cmd+F (macOS) or Shift+Ctrl+F (Windows/Linux) runs the same format from inside the editor. Body containing unresolved `{{var}}` is skipped with a toast.
- Response body search runs over a `@tanstack/react-virtual` pipeline: 150ms debounce, line-indexed match table, and only the visible rows hit the DOM. A 5 MB body stays under 30 ms per keystroke. HTML responses now have a CodeMirror pretty view with one-dark in dark mode and a size warning above 500 KB.
- `normalizeUrl(raw)` in `http-core` handles scheme-less URLs (`localhost/api`), port-only (`:80/path`), and empty host (`:/path`) by prepending `http://` and defaulting the host to `0.0.0.0`. Runs after variable resolution so `{{host}}` still works.
- `.sman` is now the primary file extension. Legacy `.req.yaml` files are read as-is; the first save rewrites them to `.sman` and deletes the old path. Collisions resolve to `.sman`. Parser accepts `scrapeman: "1.0"` and `scrapeman: "2.0"`; the writer always emits `2.0`.
- Per-tab sub-pane memory. Each request tab remembers whether it was on Params, Headers, Body, Auth, Settings, Code or Load when you left it.
- Response body validator. Settings tab has an "Expected text" input; when set, the response status bar shows a green check or red cross chip reporting whether the decoded body contains the substring. `{{var}}` supported.
- Load runs land in history with a `LoadRunSummary` (sent, succeeded, failed, validationFailures, elapsedMs, rps, p50, p95, p99, min, max, statusHistogram, errorKinds).
- Load test shows the active validation rules while the run is live: `status = 2xx` and `body ⊃ "success"` chips appear next to the progress bar and on the initial spinner screen.
- Hover descriptions on every load-test metric: RPS, p50, p95, p99, min, max, Inflight, Success rate, Failed, Validation fail.

### Fixed
- Response body and execution state no longer leak between tabs when you switch tabs before the response lands. The store captures the target tab id at send time and writes back via a new `mutateById` helper instead of whichever tab happens to be active.
- Load test state is now per-tab. Config, run id, progress snapshot, and event log live on `Tab.loadTest` in the store; tab switches and sidebar toggles preserve them. Closing a tab aborts its running load run so the main process does not keep firing events at a dead tab id.
- Response viewer toolbars (status metrics bar, body/headers switcher) and the Headers panel column header are now opaque and sticky. Virtualized body text no longer bleeds into the chrome when restoring from history or retrying.
- Virtualized rows in raw and pretty no longer overlap. The inner `<pre>` used `whitespace-pre-wrap break-words` while the outer height was pinned to 18 px, so long lines wrapped visually and drew over the next row. Flattened to a single `whitespace-pre` div and widened the slab to `max-content`; long lines now scroll horizontally inside the `overflow-auto` parent.
- Active search match is centered both vertically and horizontally. Vertical scroll goes through the virtualizer; horizontal scroll is computed from the mark's `getBoundingClientRect()` and applied to `parent.scrollLeft`, which sidesteps the `contain: strict` + absolute-positioned slab combination that broke `scrollIntoView`.
- HTML pretty mode follows search navigation. Enter / Shift+Enter map the active match into a CodeMirror `SelectionRange` and dispatch `scrollIntoView(range, { y: 'center', x: 'center' })`; the read-only selection highlight doubles as the active-match cue.
- Executor and scrape.do composer stopped re-appending `request.params` onto URLs. The URL bar is now the single source of truth for the outgoing URL; `request.params` stays in the file format for round-tripping disabled rows but never reaches the wire. Fixes duplicated `token=` in the scrape.do envelope (`"Wrong query parameter. You are sending multiple value via same parameter('token')"`) and `{{var}}` going through unresolved.
- Disabled URL params survive tab switches, disk saves, and reloads. Added `disabledParams: string[]` to the file format; all params round-trip with their enabled flag.
- Params row order is preserved when toggling the enabled checkbox. Previously `[disabled..., enabled...]` regrouping reshuffled the list on reload.
- `HeadersEditor` no longer imports from `@scrapeman/http-core`. The top-level export dragged `undici` into the renderer bundle and the browser crashed with `process is not defined`. The bulk helpers moved to `apps/desktop/src/renderer/src/utils/header-bulk.ts`.
- `git pull --ff-only` no longer fatals on diverged branches (see Added).

### Changed
- Request execution contract: `request.url` is canonical. `request.params` is metadata for the file format only and is not appended to the URL by the executor or by `composeScrapeDoRequest`.

### Tests
- Test files: 22 passed in `http-core`, 2 in `apps/desktop`.
- Total: 332 tests pass, 7 skipped.
- `pnpm -r typecheck` clean in all three packages.

## [0.3.2] and earlier

See `git log --grep='release:'` for prior version notes.
