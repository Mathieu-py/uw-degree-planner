<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Tests

Tests live in `test/` subfolders next to the code they cover (e.g. `lib/test/filters.test.ts`, `lib/prereqs/test/parse.test.ts`). Vitest's default discovery picks them up; no extra config needed.
