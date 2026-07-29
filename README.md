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
pnpm fetch-courses     # full rebuild of data/courses.*.json (UWFlow + Kuali + Open Data)
pnpm refresh-seats     # patch fresh Open Data seat counts into the existing snapshot
pnpm scrape-programs   # refresh data/programs.json from the UW calendar
```

## Routes

- `/` — landing page
- `/plan` — main planner (timeline, slot picker, audit panel, transcript import)
- `/catalog` — filterable course catalog
- `/course/[code]` — individual course detail
- `/p/[shareToken]` — read-only shared plan (link-only, noindex)
- `/settings` — account and plan management
- `/legal` — disclaimer, privacy, and data sources

## How it works

Three core modules carry most of the logic:

- **[lib/transcript/](lib/transcript/)** — `pdfText.ts` extracts text from a Quest PDF entirely in the browser using `pdfjs-dist` (no upload); `parse.ts` is a line-by-line state machine that splits the transcript into terms, classifies grades, and detects program / specialization / co-op stream.
- **[lib/plan/](lib/plan/)** — the in-memory plan model and its `localStorage` persistence. `sequence.ts` generates the empty-slot cadence per stream (regular / stream4 / stream8); `transcriptApply.ts` merges a parsed transcript onto that cadence; `storage.ts` validates every persisted field on load with explicit type guards.
- **[lib/audit/](lib/audit/)** — a requirement compiler. `compile.ts` walks a `RuleNode` AST (`courses` | `all` | `pick` | `subjectPool` | `excluded`) paired with the student's placed courses and emits an `AuditNode` tree decorated with status, satisfiers, and missing codes for the UI.

The planner UI lives in [components/planner/](components/planner/), rooted at `PlannerShell.tsx` (owns plan state and `localStorage` sync).

## Data sources

The `data/` snapshots refresh on three cadences, each with its own GitHub Actions workflow (each opens a guarded, auto-merging bot PR against `main` — never a direct push; `guard-snapshot` blocks the PR on anomalous diffs):

| Data | Script | Workflow | Cadence | Why |
| --- | --- | --- | --- | --- |
| Seating | `pnpm refresh-seats` | `refresh-seating.yml` | weekly | seat counts drift week to week |
| Courses | `pnpm fetch-courses` | `refresh-courses.yml` | per-term (~4 mo) | ratings/prose/requisites change slowly |
| Programs | `pnpm scrape-programs` | `refresh-programs.yml` | yearly | tracks the annual calendar republish |

**Courses**: `scripts/build-catalog.ts` combines three UW sources, joined by course code — [UWFlow](https://uwflow.com) (GraphQL: name, description, requirement prose, crowd-sourced ratings), Kuali (`uwaterloocm.kuali.co`: units, cross-listings, structured prerequisite/antirequisite data), and the [UW Open Data API](https://openapi.data.uwaterloo.ca) (live section seat counts; needs `UW_OPENDATA_KEY` in `.env.local`). `pnpm refresh-seats` re-fetches only the Open Data seating and patches `sections` into the existing snapshot — a cheap weekly update that skips the UWFlow/Kuali pulls.

**Programs**: term-by-term schedules come from the UWaterloo academic calendar's Kuali backend (`uwaterloocm.kuali.co/api/v1/catalog/`). Refresh with `pnpm scrape-programs` — once per academic year when the calendar is republished, or whenever the `asOf` dates in `data/programs.json` look stale.

If the calendar is republished with a new catalog id, the scraper will return 404s; find the new id by opening the calendar in a browser with devtools open, watching the request to `/api/v1/catalog/programs/{id}`, and updating `CATALOG_ID` in [scripts/scrape-programs.ts](scripts/scrape-programs.ts).

All 194 undergraduate programs are emitted to `data/programs.json`: the 16 Engineering majors keep a per-term schedule (`kind: "engineering"`), and the rest (Math, Arts, Science, AHS, Environment) carry a flat requirement tree (`kind: "flexible"`). Requirements the parser recognizes but can't structure into a rule (e.g. faculty-scoped unit pools with no enumerable subject list) are surfaced verbatim in each program's `unverifiedRequirements`, which holds the degree-audit headline below 100% until they're checked manually — the audit never reads complete while a real requirement was dropped. Re-run `pnpm tsx scripts/diagnostic/check-dropped.ts` after a scrape to spot-check that the saved sample programs lose nothing silently.

## Transcript import

On `/plan`, the **Upload transcript** button opens a modal that accepts a Quest unofficial-transcript PDF. The PDF is parsed entirely in the browser — bytes never leave the client. The parser auto-detects program, current term, and co-op stream, and prepopulates the timeline.

To export the PDF: Quest → Student Center → *Other Academic…* → *Transcript: View Unofficial* → save as PDF.

## Tests

Unit tests live in `test/` subfolders next to the code they cover (e.g. `lib/test/`, `lib/prereqs/test/`); Vitest default discovery finds anything matching `**/test/**/*.test.{ts,tsx}` with no extra config. E2E specs live in `e2e/` (Playwright).

## Deploying (Vercel)

Import the repo with the default Next.js preset — the `data/` snapshots are committed, so no custom build step is needed. Set these environment variables:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from the Supabase dashboard (Project Settings → API)
- `NEXT_PUBLIC_SITE_URL` — the canonical production origin (used by metadata, robots, sitemap)
- `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` — optional error reporting; everything no-ops without them

`UW_OPENDATA_KEY` is a GitHub Actions secret (not a Vercel var). It is **required** by the seating refresh workflow (a seats-only run has nothing to fetch without it) and **optional** for full course refreshes, which reuse seating from the committed snapshot when it is unset.

On the hosted Supabase project (dashboard, not code): set the Site URL and add `https://<domain>/auth/callback` to Redirect URLs; keep "Confirm email" **off** (sign-up assumes an immediate session); configure the Google provider's production credentials; and push migrations with `pnpm exec supabase db push`.

### Advancing the pinned term

The catalog is pinned to one term (`PINNED_TERM` in [lib/terms.ts](lib/terms.ts)). Once a term: bump the constant, run `pnpm fetch-courses` (with `UW_OPENDATA_KEY` set — a keyless first fetch of a new term has no seating to carry over), commit the new `data/courses.<term>.json` + `data/descriptions.<term>.json`, delete the old pair, and update the two tests that import the snapshot literally (`lib/audit/test/progress.crossprogram.test.ts`, `lib/courses/test/snapshot.invariants.test.ts`).

## Notes

This project targets Next.js 16, which has breaking changes vs. earlier versions. When in doubt, check `node_modules/next/dist/docs/` before relying on older patterns.

## License

The code is [MIT-licensed](LICENSE). The JSON snapshots under `data/` are derived from third-party sources (UWFlow, the UW Open Data API, and the UW Undergraduate Calendar), are **not** covered by the MIT license, and remain subject to their providers' terms.
