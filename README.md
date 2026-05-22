# UW Elective Finder

Browse and filter ~10,000 UWaterloo courses by usefulness, easiness, prerequisites, and available seats — sourced from UWFlow ratings.

Built with Next.js 16, React 19, and Tailwind v4.

## Getting started

Install dependencies and run the dev server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
pnpm dev              # start the dev server
pnpm build            # production build
pnpm start            # run the production build
pnpm lint             # eslint
pnpm test             # vitest (single run)
pnpm test:watch       # vitest in watch mode
pnpm fetch-courses    # refresh data/courses.*.json from UWFlow
pnpm scrape-programs  # refresh data/programs.json from the UW calendar
```

## Project layout

- `app/` — routes (`/`, `/browse`, `/course/[code]`)
- `components/` — UI components (`CourseBrowser`, `FilterPanel`, …)
- `lib/` — filter logic, prereq parsing, types, tests
- `scripts/fetch-uwflow.ts` — pulls course data from the UWFlow GraphQL API into `data/`
- `scripts/scrape-programs.ts` — pulls program term schedules from the UW academic calendar into `data/programs.json`
- `data/` — committed JSON snapshots (course data per term, plus the program directory)

## Data sources

**Courses**: ratings, metadata, and section/seat counts come from [UWFlow](https://uwflow.com) via their public GraphQL endpoint. Refresh with `pnpm fetch-courses`.

**Programs**: term-by-term schedules come from the UWaterloo academic calendar's Kuali backend (`uwaterloocm.kuali.co/api/v1/catalog/`). Refresh with `pnpm scrape-programs` — typically once per academic year when the calendar is republished, or whenever you notice the `asOf` dates in `data/programs.json` are stale.

If the calendar is republished with a new catalog id, the scraper will return 404s; find the new id by opening the calendar in a browser with devtools open, watching the request to `/api/v1/catalog/programs/{id}`, and updating `CATALOG_ID` in [scripts/scrape-programs.ts](scripts/scrape-programs.ts).

Only programs whose calendar entry defines a per-term required-course list (currently 16 — 14 Engineering majors plus Architectural Studies and Medical Sciences) are emitted to `data/programs.json`. Programs with a flexible / sub-plan curriculum (most of Math, Arts, Science, AHS, Environment) are dropped — the current parser can't extract their required courses, and a parser refactor is tracked in [issue #15](https://github.com/Mathieu-py/uw-elective-finder/issues/15). Until that lands, those students use the transcript-import flow instead of program seeding.

## Notes

This project targets Next.js 16, which has breaking changes vs. earlier versions. When in doubt, check `node_modules/next/dist/docs/` before relying on older patterns.
