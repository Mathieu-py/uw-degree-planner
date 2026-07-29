import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /p/ share pages are link-only (also noindex via metadata); the planner
      // surfaces have no crawlable content.
      disallow: ["/p/", "/api/", "/plan", "/plans", "/settings", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
