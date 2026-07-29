<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Academic rules: research before implementing

This app encodes University of Waterloo academic rules (prerequisites, antirequisites, corequisites, program/faculty restrictions, credit eligibility). Before changing any logic that interprets these — or "fixing" something that looks like a bug in how a requirement is read — **research the authoritative source first; do not infer the rule from the data or from intuition.**

- Consult the **UW Undergraduate Calendar** (`ucalendar.uwaterloo.ca`, e.g. course pages and the Glossary of Terms), the Registrar, or the relevant faculty/department site. Quote the exact wording you're relying on.
- The course data (`data/courses.1269.json`, a UWFlow snapshot) is often **asymmetric or terse by design** — e.g. an antireq is listed on only one of the two courses, a "service" course names the established ones but not vice versa. An asymmetry in the data is **not automatically a bug**: confirm what the rule actually requires before normalizing it. (Example — the [UW Undergraduate Calendar Glossary of Terms](https://academic-calendar-archive.uwaterloo.ca/undergraduate-studies/2020-2021/page/uWaterloo-Undergraduate-Calendar-Glossary-of-Terms.html) defines an antirequisite as "a condition preventing enrolment in a course" for which "[d]egree credit will not be granted for both the antirequisite course and a course naming it as such": the enrolment block is keyed to the course that *names* the antireq — hence the one-sided data — while degree credit is denied symmetrically.)
- State the rule and cite the source in the PR/commit and in a code comment next to the logic, so the reasoning is reviewable.
- When the source is ambiguous or silent, surface that to the user rather than guessing.

## Comments: concise, explain *why*

Keep comments short — one line where possible, a few at most. Explain the non-obvious reason, trade-off, or gotcha; don't narrate what the code plainly says or restate the identifier. Cut hedging and ceremony. (The academic-rule citations above are the deliberate exception — keep those, just tighten the prose.)

**No issue or PR numbers in code comments** (`#31`, `#123`, etc.). They rot and mean nothing to a future reader without the tracker open — state the actual reason or behavior instead. Put the issue reference in the commit/PR, not the source. (Test `describe`/`it` titles are exempt — naming a test after its issue is fine.)

## Tests

Tests live in `test/` subfolders next to the code they cover (e.g. `lib/test/filters.test.ts`, `lib/prereqs/test/parse.test.ts`). Vitest's default discovery picks them up; no extra config needed.
