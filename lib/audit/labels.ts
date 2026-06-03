/**
 * Concise, human-readable titles for unit buckets. The scraped `label` is the
 * verbatim requirement sentence ("Complete a total of 6.0 units of ANTH
 * courses."), which is preserved as the bucket's source text but reads poorly as
 * a section heading. `bucketTitle` derives a short title from the bucket's
 * *scope* — a structural signal, not a fragile match on the sentence text.
 */

import { MATH_SUBJECTS, type UnitBucket } from "@/lib/programs";

/** Where a bucket came from: the program's own plan, or the faculty degree page. */
export type BucketOrigin = "program" | "degree";

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((x) => bs.has(x));
}

/** A short, title-cased subject list, e.g. ["anth"] → "ANTH", ["cs","stat"] → "CS, STAT". */
function subjectsLabel(subjects: readonly string[]): string {
  return subjects.map((s) => s.toUpperCase()).join(", ");
}

/**
 * Distil an unscoped bucket's verbatim sentence into a readable heading by
 * lifting the noun phrase out of "… N units of «noun» …" and dropping trailing
 * qualifier clauses. This is presentation only — it never assigns a scope (the
 * bucket stays unscoped, "verify manually"); the full sentence is preserved as
 * the bucket's `sourceText`. Falls back to the whole label when there's no
 * "units of" anchor, so an unfamiliar phrasing degrades gracefully.
 */
function unscopedTitle(label: string): string {
  const m = label.match(/units?\s+of\s+(.+)/i);
  let noun = (m ? m[1] : label).trim();
  noun = noun.replace(/\s*[,(].*$/, ""); // drop ", including …" / "(see below)"
  noun = noun.replace(/\.\s*$/, ""); // drop trailing period
  noun = noun.replace(/^additional\s+/i, ""); // "additional Science…" → "Science…"
  noun = noun.trim();
  if (noun === "") return label;
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * A concise section title for a unit bucket. Breadth buckets (origin `"degree"`)
 * already carry clean labels and are passed through; program buckets get a title
 * derived from their scope. An `unscoped` bucket has no verifiable scope to name,
 * so its title is the noun phrase distilled from its verbatim sentence.
 */
export function bucketTitle(bucket: UnitBucket, origin: BucketOrigin): string {
  if (origin === "degree") return bucket.label;
  const scope = bucket.scope;
  switch (scope.kind) {
    case "required":
      return "Required courses";
    case "open":
      return "Free electives";
    case "list":
      return "Approved courses";
    case "subject": {
      const base = sameSet(scope.subjects, MATH_SUBJECTS)
        ? "Math courses"
        : `${subjectsLabel(scope.subjects)} courses`;
      return scope.minLevel != null
        ? `${base} (${scope.minLevel}-level+)`
        : base;
    }
    case "subjectExcept":
      return sameSet(scope.exclude, MATH_SUBJECTS)
        ? "Non-math courses"
        : "Other courses";
    case "unscoped":
      return unscopedTitle(bucket.label);
  }
}
