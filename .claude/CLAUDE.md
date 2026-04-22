# Scrapeman — Claude instructions

## Project
Scrapeman is a Postman/Bruno-class API client built for scraping engineers.
Electron + React + TypeScript, pnpm monorepo. Sibling repo is
`/Users/mert/Developer/scrapeman-landing` (the marketing site).

## User-facing writing rules

Apply every time you write prose a human will read: README updates, DOCS
sections, commit messages, PR descriptions, release notes, CHANGELOG
entries, in-app toasts and error copy. This list comes from two open
skills the user follows — `blader/humanizer` and `hardikpandya/stop-slop` —
plus the anti-slop notes in memory. State facts and numbers; skip the vibes.

**Write in English.** Code comments, commit messages, PR descriptions,
release notes, and CHANGELOG entries are always in English, even when the
chat is in Turkish.

### Cut on sight
- Significance inflation: "pivotal", "transformative", "testament to",
  "marking a new era", "at its core"
- Promotional adjectives: "seamless", "vibrant", "empowering",
  "game-changing", "cutting-edge", "revolutionary"
- AI tells: "leverage", "unlock", "showcase", "landscape", "actually",
  "additionally", "while details are limited"
- Vague attributions: "experts say", "industry observers", "some argue"
- Formulaic challenges: "Despite the challenges, X continues to thrive"
- Chatbot artifacts: "Great question!", "I hope this helps", sycophancy
- Generic conclusions: "The future looks bright", "The possibilities are
  endless"
- Signposting: "Let's dive in", "Here's what you need to know"
- Negative parallelisms: "Not just X, but Y", "Everything you need,
  nothing you don't"
- Rule-of-three arranged for rhetoric ("innovation, inspiration, insights")

### Prefer
- "is" and "has" over "serves as", "features", "boasts"
- "To" over "In order to"; "Because" over "Due to the fact that"
- Short sentences. Mix lengths only when rhythm demands.
- Concrete numbers (tests, file counts, bug IDs, commit hashes, version
  tags) instead of adjectives
- Commas or periods over em-dashes for breathing
- Sentence-case headings (not Title Case)
- No emojis, no curly quotes, no inline-header bold lists like
  "**Performance:** ..."

### Before shipping prose
Score it 1–10 on directness, rhythm, trust, authenticity, density. Rewrite
if the total is under 35 / 50. Rewriting the first line usually fixes the
rest.

## Brand capitalisation
- User-facing prose: `Scrape.do` (capital S), `Scrapeman` (capital S).
- Lowercase `scrape.do` is fine only inside URLs, code blocks, env vars,
  and literal terminal output.

## Agent workflow
- Worktree isolation: every code-writing agent gets `isolation: "worktree"`.
- Reviews: ninja-fullstack / ninja-scraping hand their work to
  developer-core for review (APPROVED / CHANGES REQUESTED / BLOCKED).
- Commits ship without `Co-Authored-By` unless the user asks for it.
- Pushes always need explicit approval. `git add` + `git commit` are fine
  any time; `git push` waits.
- Every feature ships with README.md + DOCS.md updates in the same commit.

## Key project context
- HTTP: `undici` (not axios, not fetch).
- UI: React 18, Zustand, Tailwind, Radix, Lucide, Inter + Geist Mono.
- IPC seam: renderer talks to main only through `contextBridge`. Renderer
  must never import `@scrapeman/http-core` top-level — it drags `undici`
  into the browser bundle.
- File format: `.sman` (primary) and `.req.yaml` (legacy, read-only,
  migrated on first save).
- `exactOptionalPropertyTypes` is on — use conditional spread, not
  `field: undefined`.
