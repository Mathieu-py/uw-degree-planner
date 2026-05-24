# UW Degree Planner

Plan every term of a UWaterloo undergraduate degree on one screen: upload your Quest unofficial transcript to bootstrap a multi-term plan, pick courses for empty slots from a filterable catalog, and see a live requirement audit against the official Undergraduate Calendar.

Built with Next.js 16, React 19, Tailwind v4, and TypeScript (strict).

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
pnpm dev               # start the dev server
pnpm build             # production build
pnpm start             # serve the production build
pnpm lint              # Biome check
pnpm lint:fix          # Biome check --write
pnpm knip              # unused-export detection
pnpm test              # vitest (single run)
pnpm test:watch        # vitest in watch mode
pnpm test:e2e          # Playwright e2e
pnpm fetch-courses     # refresh data/courses.*.json from UWFlow
pnpm scrape-programs   # refresh data/programs.json from the UW calendar
```

## Routes

- `/` — landing page
- `/plan` — main planner (timeline, slot picker, audit panel, transcript import)
- `/course/[code]` — individual course detail

## How it works

Three core modules carry most of the logic:

- **[lib/transcript/](lib/transcript/)** — `pdfText.ts` extracts text from a Quest PDF entirely in the browser using `pdfjs-dist` (no upload); `parse.ts` is a line-by-line state machine that splits the transcript into terms, classifies grades, and detects program / specialization / co-op stream.
- **[lib/plan/](lib/plan/)** — the in-memory plan model and its `localStorage` persistence. `sequence.ts` generates the empty-slot cadence per stream (regular / stream4 / stream8); `transcriptApply.ts` merges a parsed transcript onto that cadence; `storage.ts` validates every persisted field on load with explicit type guards.
- **[lib/audit/](lib/audit/)** — a requirement compiler. `compile.ts` walks a `RuleNode` AST (`courses` | `all` | `pick` | `subjectPool` | `excluded`) paired with the student's placed courses and emits an `AuditNode` tree decorated with status, satisfiers, and missing codes for the UI.

The planner UI lives in [components/planner/](components/planner/), rooted at `PlannerShell.tsx` (owns plan state and `localStorage` sync).

## Data sources

**Courses**: ratings, metadata, and section/seat counts come from [UWFlow](https://uwflow.com) via their public GraphQL endpoint. Refresh with `pnpm fetch-courses`.

**Programs**: term-by-term schedules come from the UWaterloo academic calendar's Kuali backend (`uwaterloocm.kuali.co/api/v1/catalog/`). Refresh with `pnpm scrape-programs` — typically once per academic year when the calendar is republished, or whenever the `asOf` dates in `data/programs.json` look stale.

If the calendar is republished with a new catalog id, the scraper will return 404s; find the new id by opening the calendar in a browser with devtools open, watching the request to `/api/v1/catalog/programs/{id}`, and updating `CATALOG_ID` in [scripts/scrape-programs.ts](scripts/scrape-programs.ts).

Only programs whose calendar entry defines a per-term required-course list are emitted to `data/programs.json` (currently 16 — most Engineering majors plus Architectural Studies and Medical Sciences). Programs with a flexible / sub-plan curriculum (most of Math, Arts, Science, AHS, Environment) are dropped — the current parser can't extract their required courses. Until that lands, those students use the transcript-import flow.

## Transcript import

On `/plan`, the **Upload transcript** button opens a modal that accepts a Quest unofficial-transcript PDF. The PDF is parsed entirely in the browser — bytes never leave the client. The parser auto-detects program, current term, and co-op stream, and prepopulates the timeline.

To export the PDF: Quest → Student Center → *Other Academic…* → *Transcript: View Unofficial* → save as PDF.

## Tests

Unit tests live in `test/` subfolders next to the code they cover (e.g. `lib/test/`, `lib/prereqs/test/`); Vitest default discovery finds anything matching `**/test/**/*.test.{ts,tsx}` with no extra config. E2E specs live in `e2e/` (Playwright).

## Notes

This project targets Next.js 16, which has breaking changes vs. earlier versions. When in doubt, check `node_modules/next/dist/docs/` before relying on older patterns.
