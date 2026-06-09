<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Academic rules: research before implementing

This app encodes University of Waterloo academic rules (prerequisites, antirequisites, corequisites, program/faculty restrictions, credit eligibility). Before changing any logic that interprets these — or "fixing" something that looks like a bug in how a requirement is read — **research the authoritative source first; do not infer the rule from the data or from intuition.**

- Consult the **UW Undergraduate Calendar** (`ucalendar.uwaterloo.ca`, e.g. course pages and the Glossary of Terms), the Registrar, or the relevant faculty/department site. Quote the exact wording you're relying on.
- The course data (`data/courses.1261.json`, a UWFlow snapshot) is often **asymmetric or terse by design** — e.g. an antireq is listed on only one of the two courses, a "service" course names the established ones but not vice versa. An asymmetry in the data is **not automatically a bug**: confirm what the rule actually requires before normalizing it. (Example: antireqs are directional for *enrolment* but symmetric for *degree credit* — "credit will not be granted for both the antirequisite course and a course naming it as such.")
- State the rule and cite the source in the PR/commit and in a code comment next to the logic, so the reasoning is reviewable.
- When the source is ambiguous or silent, surface that to the user rather than guessing.

## Tests

Tests live in `test/` subfolders next to the code they cover (e.g. `lib/test/filters.test.ts`, `lib/prereqs/test/parse.test.ts`). Vitest's default discovery picks them up; no extra config needed.
