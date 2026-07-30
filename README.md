# UW Degree Planner

Plan every term of a University of Waterloo undergraduate degree on one screen. Upload your Quest unofficial transcript to bootstrap a multi-term plan, fill empty slots from a filterable course catalog, and watch a live requirement audit check your plan against the official Undergraduate Calendar.

Built with **Next.js 16, React 19, Tailwind v4, and TypeScript** (strict mode).

> **Live demo:** _add your deployment URL here_

<!-- Add a screenshot to make the repo land at a glance:
     ![The planner](docs/screenshot.png) -->

## What it does

- **Timeline planner** — every term of your degree laid out at once, with an empty-slot cadence generated for your co-op stream (regular / stream 4 / stream 8).
- **Transcript import** — drop in your Quest unofficial-transcript PDF; it's parsed **entirely in the browser** (bytes never leave your machine) to auto-detect your program, current term, and co-op stream, then prefill the timeline.
- **Course catalog** — filter ~10k courses by subject, level, prerequisites, ratings, and live seat counts.
- **Live degree audit** — a requirement engine evaluates your placed courses against the calendar's rules and shows what's met, partial, or still owed — down to individual missing courses.
- **Accounts & sharing** — optional Supabase-backed accounts sync plans across devices; read-only share links let you send a plan without exposing your account.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, RSC), React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Backend / auth | Supabase (Postgres, email + Google OAuth) |
| Validation | Zod + explicit type guards |
| Tooling | pnpm, Biome (lint/format), Vitest, Playwright, Knip |
| Ops | Sentry, GitHub Actions, Vercel |

## Getting started

**Prerequisites:** Node ≥ 22.13 and [pnpm](https://pnpm.io) 11 (`corepack enable` picks up the pinned version).

```bash
git clone <this-repo>
cd university-course-selection
pnpm install
cp .env.example .env.local   # then fill in the values below
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

The app reads Supabase credentials at startup and **fails loudly if they're missing**, so set these two in `.env.local` before `pnpm dev`:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from the Supabase dashboard (Project Settings → API), or `pnpm exec supabase status` for a local stack. The anon key is browser-safe.

Everything else in [.env.example](.env.example) is optional for local dev: `UW_OPENDATA_KEY` is only used by the data-refresh scripts, and `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` no-op when unset.

The committed `data/` snapshots mean the catalog works out of the box — you don't need to run any scrapers to develop.

### Try the transcript import

On `/plan`, click **Upload transcript** and choose a Quest unofficial-transcript PDF. To export one: Quest → Student Center → *Other Academic…* → *Transcript: View Unofficial* → save as PDF.

## Project structure

```text
app/          Next.js routes (App Router)
components/   UI — planner/ is the main surface, rooted at PlannerShell.tsx
lib/          Domain logic (see below)
data/         Committed JSON snapshots (courses, programs, seating)
scripts/      Data-pipeline scrapers and diagnostics
e2e/          Playwright specs
```

Three `lib/` modules carry most of the logic:

- **[lib/transcript/](lib/transcript/)** — client-side PDF text extraction + the transcript parser.
- **[lib/plan/](lib/plan/)** — the in-memory plan model and its persistence. `sequence.ts` generates the empty-slot cadence per stream, `transcriptApply.ts` merges a parsed transcript onto it, and `storage.ts` validates every persisted field on load with explicit type guards.
- **[lib/audit/](lib/audit/)** — the requirement compiler that turns a `RuleNode` tree into the audit shown in the planner.

### Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/plan` | Main planner (timeline, slot picker, audit panel, transcript import) |
| `/catalog` | Filterable course catalog |
| `/course/[code]` | Individual course detail |
| `/p/[shareToken]` | Read-only shared plan (link-only, noindex) |
| `/settings` | Account and plan management |
| `/legal` | Disclaimer, privacy, and data sources |

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

## Testing

Unit tests live in `test/` subfolders next to the code they cover (e.g. `lib/prereqs/test/`); Vitest's default discovery finds anything matching `**/test/**/*.test.{ts,tsx}` with no extra config. E2E specs live in `e2e/` (Playwright).

```bash
pnpm test        # unit
pnpm test:e2e    # end-to-end
```

## Data sources

The `data/` snapshots are committed and refresh on three cadences, each with its own GitHub Actions workflow. Every workflow opens a guarded, auto-merging bot PR against `main` — never a direct push — and `guard-snapshot` blocks the PR on an anomalous diff.

| Data | Script | Cadence | Why |
| --- | --- | --- | --- |
| Seating | `pnpm refresh-seats` | weekly | seat counts drift week to week |
| Courses | `pnpm fetch-courses` | per-term (~4 mo) | ratings/prose/requisites change slowly |
| Programs | `pnpm scrape-programs` | yearly | tracks the annual calendar republish |

**Courses** — `scripts/build-catalog.ts` joins three UW sources by course code: [UWFlow](https://uwflow.com) (GraphQL — name, description, requirement prose, crowd-sourced ratings), Kuali (`uwaterloocm.kuali.co` — units, cross-listings, structured prerequisites/antirequisites), and the [UW Open Data API](https://openapi.data.uwaterloo.ca) (live seat counts; needs `UW_OPENDATA_KEY`). `pnpm refresh-seats` re-fetches only seating and patches it into the existing snapshot.

**Programs** — term-by-term schedules come from the academic calendar's Kuali backend. All 194 undergraduate programs land in `data/programs.json`: the 16 Engineering majors keep a per-term schedule (`kind: "engineering"`); the rest carry a flat requirement tree (`kind: "flexible"`). Requirements the parser recognizes but can't structure into a rule are surfaced verbatim in each program's `unverifiedRequirements`, which holds the audit headline below 100% until checked manually — the audit never reads complete while a real requirement was dropped.

The data snapshots are derived from third-party sources and remain subject to their providers' terms (see [License](#license)).

## Deploying (Vercel)

Import the repo with the default Next.js preset — the `data/` snapshots are committed, so no custom build step is needed. Set:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project API credentials.
- `NEXT_PUBLIC_SITE_URL` — the canonical production origin (used by metadata, robots, sitemap).
- `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` — optional error reporting.

`UW_OPENDATA_KEY` is a GitHub Actions secret (not a Vercel var): required by the seating refresh workflow, optional for full course refreshes.

On the hosted Supabase project: set the Site URL and add `https://<domain>/auth/callback` to Redirect URLs; keep "Confirm email" **off** (sign-up assumes an immediate session); configure the Google provider's production credentials; and push migrations with `pnpm exec supabase db push`.

<details>
<summary>Advancing the pinned catalog term</summary>

The catalog is pinned to one term (`PINNED_TERM` in [lib/terms.ts](lib/terms.ts)). To advance it to the next term, update `PINNED_TERM` to that term, run `pnpm fetch-courses` (with `UW_OPENDATA_KEY` set), commit the new `data/courses.<term>.json` and `data/descriptions.<term>.json` snapshots, delete the old pair, and update the two tests that import the snapshot literally (`lib/audit/test/progress.crossprogram.test.ts`, `lib/courses/test/snapshot.invariants.test.ts`).
</details>

## Notes

This project targets Next.js 16, which has breaking changes vs. earlier versions. When in doubt, check `node_modules/next/dist/docs/` before relying on older patterns.

## License

The code is [MIT-licensed](LICENSE). The JSON snapshots under `data/` are derived from third-party sources (UWFlow, the UW Open Data API, and the UW Undergraduate Calendar), are **not** covered by the MIT license, and remain subject to their providers' terms.

## Disclaimer

This is an unofficial planning aid and is **not** affiliated with the University of Waterloo. Always confirm requirements with your academic advisor and the official Undergraduate Calendar.
