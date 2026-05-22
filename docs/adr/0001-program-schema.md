# ADR 0001 — `Program` schema for the elective selector

**Status:** Proposed (pending #29 review)
**Date:** 2026-05-22
**Issue:** [#29](https://github.com/Mathieu-py/uw-elective-finder/issues/29)
**Informed by:** [#28 diagnostic findings](../../scripts/diagnostic/findings.md)

## Amendment — 2026-05-22 (issue [#43](https://github.com/Mathieu-py/uw-elective-finder/issues/43))

`ChoiceGroup.selectCount` is replaced with explicit `selectMin?: number; selectMax?: number` bounds so the schema can express the three "pick K from a course list" rule shapes uniformly:

- `Complete N of {opts}` → `selectMin: N, selectMax: N`
- `Choose any of {opts}` → both omitted (any subset, including none)
- `Complete no more than N from {opts}` → `selectMax: N`, `selectMin` omitted

`ElectiveCategory` is narrowed to **unit-bound** electives only: bucket descriptions (`5.5 units of elective courses`) and unit-bound approved pools (Climate's `Approved Courses List`, `{ unitRequirement: 2.0, approvedCourses: [...] }`). Rule-derived approved-pools (`Choose any`, `Complete no more than N`) live in `choiceGroups` / `choiceGroupsByTerm` going forward — they were never unit-counted, so colocating them with unit electives created a fuzzy semantic boundary.

The inline schema below still shows the original `selectCount` for historical accuracy; the live type is in [`lib/programs.ts`](../../lib/programs.ts). `data/programs.json` was migrated in-place: `{ selectCount: N }` → `{ selectMin: N, selectMax: N }` across 803 entries.

Out of scope for #43 alone: capturing the **parent-quota constraint** that ties sibling rules together (e.g. Combinatorics' "Complete 3 courses from the following choices:" parent over one `Choose any` + five `Complete no more than 1` siblings). This was resolved by the rule-tree refactor amendment below, which represents the parent-quota as a `pick` node wrapping its sibling children.

## Amendment — 2026-05-22 (rule-tree refactor)

The flat fields `requiredCourses` / `choiceGroups` / `choiceGroupsByTerm` are replaced with a single recursive `RuleNode` AST per program (per-term for engineering). The AST captures the parent-quota constraints and the `Complete N additional <SUBJECT>` rules that flat fields cannot represent. The shape mirrors the `PrereqNode` AST in [`lib/prereqs/parse.ts`](../../lib/prereqs/parse.ts).

```ts
export type RuleNode =
  | { kind: "all"; description?: string; children: RuleNode[] }
  | { kind: "pick"; description?: string; selectMin?: number; selectMax?: number; children: RuleNode[] }
  | { kind: "subjectPool"; description: string; selectCount: number; subjectCodes: string[]; minLevel?: number; maxLevel?: number; exclusions?: string[] }
  | { kind: "courses"; courses: string[] }
  | { kind: "excluded"; description?: string; courses: string[] };
```

Kuali rule-shape mapping:

| Kuali rule | Node |
| --- | --- |
| Section root / `Complete all of the following` | `all` |
| `Complete N of the following` | `pick { selectMin: N, selectMax: N }` |
| `Choose any (of \| course from) the following` | `pick { /* both omitted */ }` |
| `Complete no more than N from the following` | `pick { selectMax: N }` |
| `Complete N courses from the following choices:` (meta-prose parent) | `pick { selectMin: N, selectMax: N }` over its subsequent same-level siblings |
| `Complete N additional <SUBJECT> courses at the X-level [from: …]` | `subjectPool` |
| `The following cannot be used towards this academic plan:` | `excluded` |
| Bare `<a>`-link list inside a parent | `courses` |

Program shapes become:

```ts
export interface EngineeringProgram {
  kind: "engineering";
  terms: Record<TermLetter, RuleNode>;  // was Record<TermLetter, string[]>
  // choiceGroupsByTerm removed — derivable
  ...
}
export interface FlexibleProgram {
  kind: "flexible";
  rules: RuleNode;                       // was requiredCourses + choiceGroups
  ...
}
```

`Specialization` gains the same `rules?: RuleNode` shape.

**Derived helpers** in [`lib/programs.ts`](../../lib/programs.ts) preserve the legacy API surface so callers don't break:
- `getRequiredCourses(program)` — walks the tree under `all`-only paths. Also promotes a `pick(N, N)` whose total course-leaf options equal `N` (single-option mandatory rules) to required, since Kuali emits some mandatory rules as `pick(1,1)` over one course instead of `all`.
- `getChoiceGroups` / `getChoiceGroupsByTerm` — flatten leaf-`pick` nodes back into the legacy `ChoiceGroup[]` shape for any consumer not yet tree-aware.
- `getSubjectPools` — list of `subjectPool` nodes for UI.
- `getExcludedCourses` — flat union of courses across `excluded` nodes; the seeder uses this to warn rather than auto-complete when a student claims a barred course.
- `walkRule`, `requiredCoursesIn`, `flattenChoiceGroups` — tree-level helpers.

**Correctness note (not a regression).** The old parser used `cheerio.find('a')` which recurses into descendant rules; for any `Complete all` rule that DOM-wrapped nested `Complete N of` rules, it incorrectly slurped the nested options into `requiredCourses`. The new hierarchical walker correctly classifies them as `pick` children. Effect: 32 programs see fewer "required" courses post-refactor (h-science, mathematical-finance, 4g-political-science, etc.) — those courses were over-seeded before and are now correctly recognized as choice options.

**New rules captured** that the previous parser dropped silently:
- 57 `subjectPool` nodes (e.g. Combinatorics "Complete 2 additional courses at the 300- or 400-level from: ACTSC, AMATH, …")
- 3 meta-parent `Complete N courses from the following choices` rollups (Combinatorics' parent-quota constraint)
- 18 `Choose any` picks + 13 `Complete no more than` picks (already captured by #43; now structurally nested where applicable)
- 12 `excluded` nodes (42 course-mentions) — programs like H-Chemistry, H-Computer-Science-BMath, and several Earth Sciences specializations that explicitly bar certain intro-level courses from counting toward the degree. Surfaced via a one-shot audit of `DEFERRED_PROSE_RE` rules with `<a>` links.

`ChoiceGroup` and `ElectiveCategory` types are retained for derived views; the live source of truth is the tree. The inline schema in the Decision block below is left intact for historical accuracy; the live types are in `lib/programs.ts`.

Dependency notes:
- #39 (variant-picker modal) should consume `RuleNode` directly. Render `pick` with bounds-aware controls, `subjectPool` with a subject-code filter UI, `all` by recursing, `courses` as a required-course list.
- #42 (FilterState `choiceGroupSelections`) keying will need path-based IDs once the tree is exposed to UI (e.g. `term=2A.children[3].children[1]`); the current flat-key scheme can't disambiguate nested picks.

## Context

The current `Program` shape ([`lib/programs.ts:16-21`](../../lib/programs.ts#L16-L21)) was designed against the engineering pattern of a fixed per-term schedule:

```ts
interface Program {
  name: string;
  asOf: string;
  source?: string;
  terms: Record<TermLetter, string[]>; // "1A".."4B" → course codes
}
```

The #28 spike confirmed this shape is structurally wrong for ~92% of UW majors. Of 197 majors, the scraper emits non-empty `terms` for only 16 (14 Engineering + Architectural Studies + Medical Sciences). The other 181 don't have a per-term schedule in Kuali — they expose a flat "Required Courses" list (in `requirements` or `courseRequirementsNoUnits`, depending on the program), often with embedded course-level variant choices (e.g. CS BCS: "Complete 1 of: CS115 / CS135 / CS145" repeated ~9 times).

Beyond fixing the parser, the goal is **the most complete representation of UW programs we can land incrementally** — rich enough that a student can eventually represent their entire passage through a program (which specialization they chose, which variant of each course they took, which co-op stream they're in). #29 itself stays ADR-only; the implementation lands in [#30](https://github.com/Mathieu-py/uw-elective-finder/issues/30) and follow-ups.

## Decision

**Adopt a `kind` discriminator on `Program`, with two shapes** (engineering keeps per-term placement; everything else is flat) **and declare the full extension surface as optional fields** so adding more data later is a field-fill, not a schema migration.

```ts
export type TermLetter = "1A"|"1B"|"2A"|"2B"|"3A"|"3B"|"4A"|"4B";

export interface ChoiceGroup {
  description?: string;       // human-readable label, e.g. "Intro CS variant"
  selectCount?: number;       // N in "Complete N of"; default 1
  options: string[];          // course codes (lowercase, canonical)
}

export interface ElectiveCategory {
  description: string;        // e.g. "5.5 units of elective courses"
  unitRequirement?: number;
  approvedCourses?: string[];
}

export interface Specialization {
  slug: string;
  name: string;
  pid: string;                // Kuali pid for the specialization page
  source?: string;
  requiredCourses?: string[];
  choiceGroups?: ChoiceGroup[];
  electives?: ElectiveCategory[];
}

export type Program = EngineeringProgram | FlexibleProgram;

export interface EngineeringProgram {
  kind: "engineering";
  name: string;
  asOf: string;
  source?: string;
  terms: Record<TermLetter, string[]>;
  choiceGroupsByTerm?: Record<TermLetter, ChoiceGroup[]>;
  electives?: ElectiveCategory[];
  specializations?: Specialization[];
}

export interface FlexibleProgram {
  kind: "flexible";
  name: string;
  asOf: string;
  source?: string;
  requiredCourses: string[];   // unconditionals only
  choiceGroups?: ChoiceGroup[];
  electives?: ElectiveCategory[];
  specializations?: Specialization[];
}
```

The discriminant is `kind`. Consumers narrow on it before reading shape-specific fields. The two shapes share `name`, `asOf`, `source`, `electives`, and `specializations` because those concepts apply equally to both. `data/programs.json` continues to be a flat `Record<string, Program>` keyed by slug.

### Why option (b) and not (a) or (c) from the issue body

The issue framed three options. Mapping each against #28's findings:

- **Option (a) — keep flat `terms` and recurse into sub-plans, emitting per-leaf slugs.** Rejected: doesn't fix the root cause. Non-engineering programs aren't broken because slugs collide — they're broken because the parser reads the wrong field and (for some) the data has no per-term structure to recurse into. Per-leaf slugs would still emit empty `terms` for History's three specializations.
- **Option (b) — `kind` discriminator.** Selected. Matches the data: engineering really does have a per-term schedule; the rest really do have a flat required list. No fabrication, no forced uniformity. Extension fields accommodate richer modeling without breaking the engineering happy-path.
- **Option (c) — engineering-only scoping; drop the 181 non-engineering entries permanently.** Rejected: punts on ~92% of programs. The data exists, is structurally regular, and would yield 11–63 required courses per non-engineering program.

## Schema details

### Required vs choice-driven courses

The schema separates "courses you must take regardless" (`requiredCourses` / `terms`) from "courses where you pick from alternatives" (`choiceGroups*`). This separation is load-bearing:

- The seeder auto-marks `requiredCourses` / `terms`-derived courses as completed when a student selects their program.
- For `ChoiceGroup`s, the student picks which variant they actually took via a future variant-picker modal (filed as a follow-up issue, not in #30). Until that modal exists, choice groups stay in the data but aren't auto-seeded.

**`ChoiceGroup` is named for "Complete N of" rules collectively, not just OR-groups.** Kuali emits both `"Complete 1 of the following"` (true OR, the common case) and `"Complete 2 of the following"` / `"Complete 3 of the following"` (genuine choose-N) — `selectCount` distinguishes them. Default is 1 when unspecified.

### Engineering vs flexible OR-group placement

Engineering's choice groups live **per-term** because the calendar data is per-section: a "Complete 1 of" inside the 4A section is semantically a 4A choice. `EngineeringProgram.choiceGroupsByTerm?: Record<TermLetter, ChoiceGroup[]>` keeps this. The variant-picker modal can present "Term 4A: pick one of X / Y" mirroring how the calendar shows it.

Flexible programs have no per-term placement, so their choice groups are flat: `FlexibleProgram.choiceGroups?: ChoiceGroup[]`.

### Specializations

Specializations are **nested on the parent program**, not stored as separate top-level entries. They have their own Kuali pids and rule trees, but conceptually they belong to one parent program (HIST-Global Interactions belongs to History). One JSON file remains; one `Program` lookup gets the parent and all its specializations together.

The calendar wording confirms specializations are **optional** in every diagnostic sample (History: "Students *may* choose to focus their elective choices…"; Climate, Kinesiology: same pattern). A student who doesn't pick a specialization still has a valid program seed. A student who picks one gets a union: parent's `requiredCourses` + the chosen specialization's `requiredCourses`.

`Specialization.pid` is kept so the future scraper can fetch each specialization's detail page (different pid format than program pids — needs verification during follow-up; see below).

### Electives

`ElectiveCategory` carries the human-readable elective requirement (`description`, e.g. "5.5 units of elective courses") plus optional structured fields. `unitRequirement` exists when the calendar specifies it. `approvedCourses` is populated when the calendar lists specific courses that count (e.g. Climate's "Approved Courses List", currently in the `courseListsNew` Kuali field — to be absorbed here).

Electives are NOT scraped or filled by #30. The field exists in v1 so the future elective-extraction issue (see below) is a field-fill, not a schema migration.

## What #30 fills vs deferred

**Filled by #30 (parser refactor):**

- `kind` for every program (engineering or flexible based on which Kuali field carries the data — see [#28 findings](../../scripts/diagnostic/findings.md#cross-program-field-presence-matrix)).
- `terms` for engineering (unchanged behavior) and `requiredCourses` for flexible (new).
- `choiceGroupsByTerm` for engineering and `choiceGroups` for flexible (new — recovers the data the current parser drops with a warning).
- `kind: "engineering"` added to the 16 existing entries in `data/programs.json`.

**Deferred to follow-up issues (all listed in the project tracker once #29 merges):**

- `specializations` — needs a separate scrape pass against specialization pids (different ID format; endpoint behavior unverified).
- `electives` — needs new parser logic for the "X units of …" prose and the `courseListsNew` field.
- Variant-picker modal UX — depends on `choiceGroups*` being populated by #30 first.
- `StudentPassage` extensions (`specializationId`, `choiceGroupSelections`, `systemOfStudy`) — depends on the schema fields being populated.

## Parser changes ([`scripts/scrape-programs.parser.ts`](../../scripts/scrape-programs.parser.ts)) — for #30

Three independently testable steps. The existing engineering path stays bit-identical for `terms` so `data/programs.json`'s 16 entries don't drift.

1. **Field selection.** Try `requiredCoursesTermByTerm` first → `kind: "engineering"`. If empty, try `requirements` and `courseRequirementsNoUnits` → `kind: "flexible"`. Programs with all three empty get dropped, same as today.
2. **Section-header relaxation for the flexible path.** Drop the `\b(\d[AB])\b` term-letter requirement. Single `<h2>Required Courses</h2>` section becomes one bucket. Existing `data-test="ruleView-A-result"` selector and rule-prefix matching unchanged.
3. **Nested rule recursion + choice-group capture.** Walk into nested `ruleView-*` blocks (CS uses `ruleView-A`/`-S`/`-J`/`-K`/… — not just `-A`). Recognize `"Complete all the following"` AND `"Complete all of the following"` (CS uses "of"; engineering doesn't). Recognize `"Complete N of the following"` as a choice group with `selectCount: N` instead of dropping with a warning.

`normalizeCourseCode` and `buildProgramSlug` need no changes.

## UI changes ([`components/FilterPanel.tsx`](../../components/FilterPanel.tsx)) — for #30 (minimal) + follow-up (modal)

`ProgramSeeder` ([`components/FilterPanel.tsx:238`](../../components/FilterPanel.tsx#L238)) currently shows two dropdowns: program + current-term. The current-term dropdown drives [`inferCompleted`](../../lib/programs.ts#L40-L53), which assumes a temporal schedule.

#30's minimal changes:
- **Engineering**: unchanged. Both dropdowns visible.
- **Flexible**: hide the current-term dropdown; `inferCompleted` returns all `requiredCourses` regardless of `currentTerm`. Show a subtitle so the user understands why the term picker disappeared.

Choice-group resolution does NOT ship in #30 — the seeder still ignores `choiceGroups*` data. A future follow-up issue adds the variant-picker modal that consumes that data.

## `inferCompleted` semantics

The function in [`lib/programs.ts:40-53`](../../lib/programs.ts#L40-L53) dispatches on `kind`:

- `kind: "engineering"`: existing behavior — union of `terms[t]` for `t < currentTerm`. `choiceGroupsByTerm` is NOT included (auto-seeding would be wrong without the modal).
- `kind: "flexible"`: return all of `requiredCourses`. The `currentTerm` argument is ignored. `choiceGroups` is NOT included.

`currentTerm` stays in the signature so call sites in [`lib/completedCourses.ts`](../../lib/completedCourses.ts) don't have to branch on `kind`.

## Data migration

- `data/programs.json`'s existing 16 entries need `kind: "engineering"` added. Performed by the scraper at the same time the parser refactor lands — no separate migration script.
- New flexible entries appear when the scraper reruns. Expect ~100+ entries post-refactor based on the [#28 coverage table](../../scripts/diagnostic/findings.md#coverage-table--visible-on-calendar-vs-current-parser).
- Transcript-import auto-detection ([`lib/transcript/parse.ts`](../../lib/transcript/parse.ts)) is unaffected — it matches on `name`, not on shape.
- Bundle size grows. See [#31](https://github.com/Mathieu-py/uw-elective-finder/issues/31).

## Consequences

**Positive.**

- Engineering happy path is bit-identical for the must-haves (`terms`). No regression risk for existing entries.
- Flexible programs get first-class support; no fabricated term assignments.
- The `kind` discriminator forces consumers to narrow before reading shape-specific fields — TypeScript catches misuse.
- Extension fields (`choiceGroups*`, `specializations`, `electives`) are all optional. Future feature PRs become field-fills rather than schema migrations.
- The "most complete representation" north-star is now expressible: every axis of a student's program passage (which program, which specialization, which variant of each choice, which co-op stream when added later) has a place in the schema.

**Negative / costs.**

- More code touched than option (c) would: type definitions, `inferCompleted`, parser, `ProgramSeeder`. Estimated ~5 files for #30.
- TypeScript narrowing needed wherever code reads shape-specific fields (`program.terms` vs `program.requiredCourses`). Mitigate via helpers like `getRequiredCourses(program)` and `getTermSchedule(program)` so consumers don't narrow inline.
- `data/programs.json` size grows ~10× as flexible programs land. Already tracked in [#31](https://github.com/Mathieu-py/uw-elective-finder/issues/31).

**Deferred and tracked separately.**

Each item below becomes a follow-up issue after #29 merges. They're not blockers for #30:

- **Variant-picker modal UX.** Students pick which variant they took for each ChoiceGroup. Triggered from ProgramSeeder; requires `choiceGroups*` data from #30 to render anything.
- **Specialization scraping.** Fetch specialization detail pages and fill `Specialization[]` on each parent program. Specialization pids use a 32-char hex format (e.g. `69b1aec70cdb8bf7a71689de`) vs program pids (`B1MVgkCRi2`) — endpoint shape needs verification before scope is final.
- **Elective category extraction.** Parse "X units of …" prose and `courseListsNew` into `ElectiveCategory[]`. Enables future elective-aware search.
- **`StudentPassage` extensions.** Add `specializationId`, `choiceGroupSelections`, `systemOfStudy` to `StudentPassage`. Persist to URL codec + localStorage. Composes with [#32](https://github.com/Mathieu-py/uw-elective-finder/issues/32) (double-degree multi-program tracking).

**Independent / not affected by this ADR.**

- **CS BCS/BMath disambiguation** ([#27](https://github.com/Mathieu-py/uw-elective-finder/issues/27)). Transcript-Plan-line matching is orthogonal — it picks which slug, not which shape.
- **Course equivalence** ([#21](https://github.com/Mathieu-py/uw-elective-finder/issues/21)). Per-course concern, not per-program.
- **UWFlow daily refresh** ([#13](https://github.com/Mathieu-py/uw-elective-finder/issues/13)). Different data file.
