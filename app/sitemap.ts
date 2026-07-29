import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";
import { loadTerm } from "@/lib/courses/data";
import { PINNED_TERM } from "@/lib/terms";

// Course pages are the whole public content surface; ~10k URLs is well under
// the 50k sitemap limit and loadTerm is a cached local-JSON read.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const courses = await loadTerm(PINNED_TERM);
  return [
    { url: SITE_URL, priority: 1 },
    { url: `${SITE_URL}/catalog`, priority: 0.8 },
    { url: `${SITE_URL}/legal`, priority: 0.2 },
    ...courses.map((c) => ({
      url: `${SITE_URL}/course/${c.code}`,
      priority: 0.5,
    })),
  ];
}
