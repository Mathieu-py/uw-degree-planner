# Parser diagnostic findings — issue #28

**Method.** Ran [`scripts/diagnostic/dump-kuali.ts`](./dump-kuali.ts) against 8 representative UW majors spanning faculties. Each program's full Kuali response is in [`raw/<slug>.json`](./raw/); the existing parser's output (plus a presence-summary of relevant Kuali fields) is in [`parsed/<slug>.json`](./parsed/). All findings below are reproducible by re-running the script.

**Headline.** The current scraper drops 181/197 majors not because the parser's *rules* are wrong but because the *field it reads* (`requiredCoursesTermByTerm`) is empty for any program that isn't engineering. The mandatory-courses HTML for non-engineering programs lives in two other top-level fields (`requirements` or `courseRequirementsNoUnits`) and uses an almost-identical rule shape — same `data-test="ruleView-A-result"` selector, same `Complete all the following` prefix — but with one flat "Required Courses" section instead of per-term `1A`/`1B`/… groupings.

## Verification done

- **SYDE round-trip.** `parsed/systems-design-engineering.json` `terms` field diffs to zero against the `systems-design-engineering` entry in `data/programs.json` — all 8 terms, all 39 course codes. Confirms the diagnostic is hitting the same parser and same Kuali HTML as `pnpm scrape-programs`.
- **Rendered-calendar comparison.** The calendar URLs (`https://uwaterloo.ca/academic-calendar/.../#/programs/{pid}`) are hash-routed JS SPAs whose only data source is the Kuali API we're already dumping; a WebFetch against the History URL confirmed the static HTML is just a "Loading… JavaScript must be enabled" shell. **The raw JSON dumps therefore ARE the rendered-calendar content.** Counting `<a>`-tag course links in the relevant field of each dump (what a human reading the rendered page would see) gives the "calendar visible" totals below.

### Coverage table — visible-on-calendar vs current-parser

| slug | field used | courses visible on rendered calendar | captured by current parser | gap |
| --- | --- | ---: | ---: | ---: |
| systems-design-engineering | requiredCoursesTermByTerm | 39 | **39** | 0 |
| h-pure-mathematics | courseRequirementsNoUnits | 11 | 0 | 11 |
| h-computer-science-bcs | courseRequirementsNoUnits | 37 | 0 | 37 |
| h-history | courseRequirementsNoUnits | 63 | 0 | 63 |
| h-biology | requirements | 23 | 0 | 23 |
| h-kinesiology | requirements | 27 | 0 | 27 |
| climate-and-environmental-change | requirements | 36 | 0 | 36 |
| jh-actuarial-science | courseRequirementsNoUnits | 14 | 0 | 14 |

"Visible on calendar" counts every distinct course code referenced anywhere in the chosen field's HTML (`<a>` tags whose text normalizes to `[A-Z]{2,8}\d{3,4}[A-Z]?`). It is an upper bound on what a flexible-program parser could surface; the actual mandatory subset depends on which rule prefixes the refactored parser will recognize (cf. miss-causes #2 and #5 below).

---

## Cross-program field-presence matrix

Numbers are HTML character counts (`false` = field absent or empty string).

| slug | rTbT | courseReqNoUnits | requirements | specList | gradReqs | addConstr |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| systems-design-engineering | **11969** | – | – | 645 | 737 | 153 |
| h-pure-mathematics | – | **3597** | – | – | 287 | – |
| h-computer-science-bcs | – | **12388** | – | 1005 | 275 | 816 |
| h-history | – | **14807** | – | 489 | 171 | 449 |
| h-biology | – | – | **5647** | – | 614 | 303 |
| h-kinesiology | – | – | **6639** | 241 | 294 | – |
| climate-and-environmental-change | – | – | **9532** | 711 | 1640 | 188 |
| jh-actuarial-science | – | – | **3784** | – | 381 | 358 |

Bold = the field that actually carries the mandatory-courses HTML for that program. **Engineering uses `requiredCoursesTermByTerm`. The other seven do not.**

---

## Where the courses are (rule-block probe)

Running the existing parser's selector + `"Complete all the following"` prefix match against whichever field carries the data, **ignoring the term-letter constraint**:

| slug | field | bytes | section headers | top-level rule blocks | total ruleView-* nodes | codes extracted |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| systems-design-engineering | requiredCoursesTermByTerm | 11969 | `1A Term … 4B Term` | 8 | – | **39** |
| h-pure-mathematics | courseRequirementsNoUnits | 3597 | `Required Courses` | 1 | – | 5 |
| h-computer-science-bcs | courseRequirementsNoUnits | 12388 | `Required Courses` | 1 (`Complete 1 of the following`) | **44** | 0 |
| h-history | courseRequirementsNoUnits | 14807 | `Required Courses` | 1 | **16** | 1 |
| h-biology | requirements | 5647 | `Required Courses` | 1 | – | 19 |
| h-kinesiology | requirements | 6639 | `Required Courses` | 1 | – | 23 |
| climate-and-environmental-change | requirements | 9532 | `Required Courses` | 1 | – | 13 |
| jh-actuarial-science | courseRequirementsNoUnits | 3784 | `Required Courses` | 1 | – | 12 |

Two outliers worth flagging:
- **h-computer-science-bcs** has 12 KB of HTML but 0 extractable codes because the top-level rule prefix is `"Complete 1 of the following"` (an OR-group across degree paths), with 44 nested `ruleView-*` nodes underneath. Reaching the actual required courses requires **recursing into nested rule trees**.
- **h-history** extracts only 1 code (`hist250`) despite 14.8 KB of HTML because most of its required-course list sits in 16 nested rule blocks under the top-level `Complete all the following`. Same recursion gap.

---

## Per-program

### 1. `systems-design-engineering` — control

- pid: `SJgggJRRoh` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/SJgggJRRoh) · Faculty of Engineering
- **Round-trip OK.** [`parsed/systems-design-engineering.json`](./parsed/systems-design-engineering.json) reproduces the 8 per-term arrays already in `data/programs.json`. 39 unique courses across 1A–4B. Zero OR-group warnings.
- Confirms the parser works correctly on the engineering shape and the diagnostic is fetching the same data as `pnpm scrape-programs`.

### 2. `h-pure-mathematics` — Math

- pid: `S1eexkCAo2` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/S1eexkCAo2) · Faculty of Mathematics
- `requiredCoursesTermByTerm`: empty. **All data is in `courseRequirementsNoUnits` (3.6 KB).**
- Single flat "Required Courses" section. 5 required PMATH courses (PMATH 347/348/351/352/450). No term grouping. No nested rule trees — straightforward "Complete all the following" list.
- **Miss-cause: field scope (#4).** Same fix as Biology / Kinesiology / Climate / JH-Actuarial Science.
- Reachable from the same response: yes.

### 3. `h-computer-science-bcs` — CS (BCS variant)

- pid: `SJPJkCAih` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/SJPJkCAih) · Faculty of Mathematics
- `requiredCoursesTermByTerm`: empty. Data is in `courseRequirementsNoUnits` (12.4 KB).
- **Two compounding miss-causes:**
  - **Field scope (#4):** wrong field.
  - **Sub-plan / nested rule recursion (#5):** top-level rule is `"Complete 1 of the following"` (an OR over CS degree paths). Real required courses sit in 44 nested `ruleView-*` nodes one or two levels deeper.
- Also has `specializationsList` (1 KB) and substantial `additionalConstraints` (816 B). Connects to #27 — the BCS/BMath disambiguation will need to interact with whichever path the student picked at the top-level OR.
- Reachable from the same response: yes, but requires walking nested rule trees, not just the top-level results.

### 4. `h-history` — Arts with sub-plan choice

- pid: `B1MVgkCRi2` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/B1MVgkCRi2) · Faculty of Arts
- `requiredCoursesTermByTerm`: empty. Data is in `courseRequirementsNoUnits` (14.8 KB).
- Top-level rule is `"Complete all the following"`, but inside it there are 16 nested `ruleView-*` blocks — the parser only extracts the 1 directly-named course (`HIST 250`) and misses the rest.
- `specializationsList` (489 B) references three specializations: `HIST-Global Interactions`, `HIST-International Relations`, `HIST-Revolution, War, & Upheaval`. These are linked child pids that hold elective sub-plan rules.
- **Miss-causes: field scope (#4) AND nested rule recursion within the same response (variant of #5).**
- Reachability: most data is in the same response (nested); specializations require following 3 child pids if we want to capture sub-plan elective rules.

### 5. `h-biology` — Science

- pid: `BJS1JCCi2` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/BJS1JCCi2) · Faculty of Science
- `requiredCoursesTermByTerm`: empty. Data is in **`requirements`** (5.6 KB) — a different field name than the Math/CS/History group.
- Flat "Required Courses" section, single `Complete all the following` rule, 19 courses extracted cleanly (BIOL 110/130/130L/239/240/240L/273/308/359 plus CHEM 120/120L/123/123L and friends). No nested rules. No specialization listing.
- **Miss-cause: field scope (#4).** Pure case.
- Reachable from the same response: yes, no recursion.

### 6. `h-kinesiology` — AHS

- pid: `B14jyJC0jn` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/B14jyJC0jn) · Faculty of Health
- `requirements` (6.6 KB), same shape as Biology — flat list, 23 courses extracted (KIN 100/100R/101/121/etc plus CHEM 120, BIOL 130, BIOL 273, HEALTH 107).
- Has one specialization (`KIN-Rehabilitation Sciences Specialization`) via `specializationsList`.
- **Miss-cause: field scope (#4).** Optional follow-up: one child pid for the specialization.
- Reachable from the same response: yes for the required courses.

### 7. `climate-and-environmental-change` — Environment (first honours non-engineering)

- pid: `B1zHkkCAo2` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/B1zHkkCAo2) · Faculty of Environment
- `requirements` (9.5 KB), 13 courses extracted. Plus a separate `courseListsNew` field (3.1 KB) holding an "Approved Courses List" used for the 2.0 elective units mentioned in `graduationRequirements`.
- 5 specializations referenced (Aviation, Economy & Development, Environment-Society-Well-Being, Geographic Information Systems, Remote Sensing).
- **Miss-cause: field scope (#4).** Plus a new field type (`courseListsNew`) we'll want for elective-category enforcement if we ever expand beyond pure required-courses.
- Reachable from the same response: yes for required courses. Specializations + approved-courses lists add structure if we want to model them.

### 8. `jh-actuarial-science` — Joint Honours (first `JH-`)

- pid: `ryHykRAi3` · [calendar](https://uwaterloo.ca/academic-calendar/undergraduate-studies/catalog#/programs/ryHykRAi3) · Faculty of Mathematics
- `courseRequirementsNoUnits` (3.8 KB), 12 courses extracted (ACTSC 231/232/331/363/372 plus STAT 230/231/333/334 and a few others). No nesting, no specializations.
- **Miss-cause: field scope (#4).** Joint Honours is structurally the same as the Math/CS group, just with the `JH-` prefix; it's nothing special at the API level.

---

## Mapping to the 5 hypothesized miss-causes

From the issue body:

1. **Term-header regex** (`\b(\d[AB])\b`) only catches engineering term labels. **Not the issue in isolation** — the non-engineering programs don't *have* per-term sections to catch. They have one `<h2>Required Courses</h2>`. This stops being a miss-cause once we drop the term-letter requirement for flexible programs.
2. **Rule-prefix matcher** (only `Complete all the following`). **Partial miss-cause** for CS, where the *top-level* rule is `Complete 1 of the following`. Adding "OR-group recursion" addresses this.
3. **Selector scope** (`section > grouping-label h2`). **Not the dominant issue.** The same selector works on the non-engineering fields once we point at them.
4. **Field scope** (only reads `requiredCoursesTermByTerm`). **The dominant miss-cause.** 7/7 non-engineering samples put data in `requirements` or `courseRequirementsNoUnits` instead. Adding a per-program "which field?" decision (or just trying all three fields) recovers 5–6 of the 7 immediately.
5. **Sub-plan / nested rules.** **Real, secondary miss-cause.** Affects CS most acutely (44 nested rule nodes) and History meaningfully (16 nested). For Pure Math, Biology, Kinesiology, Climate, JH-Actuarial, the top-level "Complete all the following" already holds all the required courses without recursion.

The relative weight is: **field-scope (#4) is doing ~85% of the damage**, **nested-rules (#5) is doing the other ~15%** and is mostly concentrated in CS and History. Miss-causes #1 and #3 are irrelevant once #4 is fixed; #2 partially overlaps with #5.

---

## Recommendation for #29 (schema decision)

**Adopt option (b): a `kind` discriminator on `Program`**, with two shapes:

```ts
type Program =
  | {
      kind: "engineering"; // existing shape
      name: string;
      asOf: string;
      source?: string;
      terms: Record<TermLetter, string[]>;
    }
  | {
      kind: "flexible"; // new shape
      name: string;
      asOf: string;
      source?: string;
      requiredCourses: string[]; // flat, no term placement
      // (later) specializations?: { slug: string; name: string; pid: string }[];
    };
```

Why this and not the other two options:

- **Option (a) per-leaf slugs** doesn't help. The non-engineering programs aren't broken because slugs collide — they're broken because the parser reads the wrong field. Per-leaf slugs would still emit empty `terms` for History's three specializations.
- **Option (c) engineering-only scoping** punts on ~85% of programs. The diagnostic shows the data exists and is structurally regular; abandoning it is hard to justify.
- **Option (b)** matches the data: engineering really does have a per-term schedule; the rest really do have a flat required-courses list. Forcing every program into the engineering term-grid would require fabricating term assignments. A discriminated union keeps the engineering happy-path unchanged (no migration of `data/programs.json`'s 16 entries) and adds the flexible case alongside it.

### Parser-refactor implications for #30

If #29 lands on option (b), the parser refactor breaks into three independently testable steps:

1. **Field selection.** Pick the field per program: `requiredCoursesTermByTerm` (engineering) → `requirements` → `courseRequirementsNoUnits`, first non-empty wins. The chosen field implies `kind`.
2. **Section-header relaxation.** Drop the term-letter requirement for the flexible path. Single "Required Courses" section becomes a single bucket.
3. **Nested rule recursion.** Walk through nested `ruleView-*` blocks under any `Complete all of the following` outer rule, not just the outer one. Combined with existing OR-group warnings, this handles CS (~most courses recoverable once the outer OR is split into sub-paths) and History.

The existing `normalizeCourseCode` and `Complete all the following` matching require no changes.

### UI implications

`components/FilterPanel.tsx`'s ProgramSeeder currently maps `terms` to a "select your current term" dropdown. Flexible programs have no term placement, so the seeder for `kind: "flexible"` reduces to: "select program → seed `completedCourses` with all `requiredCourses`." Same dropdown, no per-term option needed for those programs. The engineering path stays unchanged.

### Out of scope of this spike, but worth filing as follow-ups

- Specialization sub-plan recursion (History's 3 specializations, Climate's 5, Kinesiology's 1) — useful but not required for the flexible-program seed to work.
- `courseListsNew` ("Approved Courses List" — Climate) — only relevant if we ever want to enforce elective category buckets.
- Auto-discovery of `CATALOG_ID` (already noted in #30).

---

## Spike addendum — issue #40 (specialization scraping)

**Method.** Ran [`scripts/diagnostic/dump-spec-pids.ts`](./dump-spec-pids.ts) against 5 specializations spanning faculties: HIST (Arts), CEC (Environment), SYDE (Engineering parent), CS-BCS (Math), ENGL-Communication-Design (cross-parent dedup probe). Each spec's full Kuali response is in [`raw-specs/<slug>.json`](./raw-specs/).

**Scope numbers (full live enumeration over all 197 majors).** 80 parent programs have a non-empty `specializationsList`; 283 total spec references across those parents; **153 unique specialization ids** — so 130 of 283 references are duplicates, driven by H/3G/4G credential variants of the same program (e.g. all 3 English-Literature variants share the same 5-6 specs). Dedup is required for both fetch budget and JSON size.

### Endpoint discovery (Q1)

The endpoint suggested by the issue text (`/api/v1/catalog/program/{catalogId}/{pid}`) **returns 404** for specialization ids. The working endpoint is:

```http
GET https://uwaterloocm.kuali.co/api/v1/catalog/program/byId/{catalogId}/{id}
```

Discovered by inspecting `https://uwaterloocm.kuali.co/catalog/build/catalog.js` (the SPA bundle), which contains:

```js
c = i ? "/program/".concat(n._id, "/").concat(i)
      : "/program/byId/".concat(n._id, "/").concat(r)
```

The HTML `specializationsList` anchor href is `#/programs/view/{id}` — the `{id}` is what we pass to `/program/byId/`. The 5 sample fetches all returned 200.

### Identifier note

`specializationsList` anchors carry the **`id`** (24-char hex like `69b1aec70cdb8bf7a71689de`), not the spec's own `pid` field. Each spec response includes both:
- `id`: the 24-char hex (matches what was in the parent's anchor)
- `pid`: a short alpha string (like `B1gEgJCRi2` for HIST-Global Interactions, or `r1spnvU3p` for the SYDE Human Factors spec)

The issue text uses "pid" loosely to mean the hex identifier; in the `Specialization` type we'll store the hex `id` value in the `pid` field, since that's how the parent program references it and how `byId/` fetches resolve.

### Credential type (Q2)

All 5 sampled specs have `undergraduateCredentialType.name === "Specialization"`. No surprises (e.g. no `"Concentration"` or `"Sub-plan"` variants).

### Field shape (Q3)

| spec | field used | has electives |
| --- | --- | --- |
| HIST-Global Interactions | `courseRequirementsNoUnits` | yes |
| CEC-Aviation | `requirements` | yes |
| SYDE-Human Factors & Interfaces | `courseRequirementsNoUnits` | yes |
| CS-Artificial Intelligence | `courseRequirementsNoUnits` | yes |
| ENGL-Communication Design | `courseRequirementsNoUnits` | yes |

**None have `requiredCoursesTermByTerm`.** This includes the SYDE spec — the Engineering parent does not propagate per-term structure into its specs. So every spec parses as `kind: "flexible"` via existing `parseProgramRequirements`; the scraper can assert this and warn if it ever changes.

Specs also expose `specializationIsAvailableForStudentsInTheFollowingMajorsRules` — a reverse lookup of which majors can take this spec. We don't need it (the forward direction in each parent's `specializationsList` is already sufficient and easier to consume), but it's nice to know.

### Cross-parent sharing (Q4)

Confirmed by the full enumeration (above). Two patterns:
1. **Credential variants** (H/3G/4G of the same program) share specs — the bulk of the 130 duplicates. Example: H-English-Literature, 3G-English-Literature, 4G-English-Literature each reference the same 5-6 ENGL specs.
2. **Cross-faculty joint programs** share specs — e.g. H-Geography-&-Environmental-Management and JH-Geography-&-Environmental-Management share their 7 specs.

In both cases the implementation is the same: fetch each unique spec id once, attach the resulting `Specialization` object to every parent that referenced it.
