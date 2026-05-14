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
pnpm fetch-courses    # refresh data/ from UWFlow
```

## Project layout

- `app/` — routes (`/`, `/browse`, `/course/[code]`)
- `components/` — UI components (`CourseBrowser`, `FilterPanel`, …)
- `lib/` — filter logic, prereq parsing, types, tests
- `scripts/fetch-uwflow.ts` — pulls course data from the UWFlow GraphQL API into `data/`
- `data/` — cached course JSON, keyed by UW term code

## Data source

Course ratings and metadata come from [UWFlow](https://uwflow.com) via their public GraphQL endpoint. Schedule/seat data falls back to the UW Open Data API.

## Notes

This project targets Next.js 16, which has breaking changes vs. earlier versions. When in doubt, check `node_modules/next/dist/docs/` before relying on older patterns.
