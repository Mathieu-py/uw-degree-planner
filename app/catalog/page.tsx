import { CatalogView } from "@/components/catalog/CatalogView";
import { loadTerm } from "@/lib/courses/data";
import { PINNED_TERM } from "@/lib/terms";

export const metadata = {
  title: "Course catalog",
  description:
    "Browse the UWaterloo course calendar by level, subject, and UWFlow ratings, then add courses to your plan with per-term prerequisite checks.",
};

export default async function CatalogPage() {
  // Single pinned term today; expands to a term selector once multi-term
  // snapshots land. Descriptions live in a sibling file, so this stays lean.
  const catalog = await loadTerm(PINNED_TERM);
  return <CatalogView catalog={catalog} />;
}
