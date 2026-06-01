import Link from "next/link";
import { REPO_URL } from "@/lib/constants";
import { Brand } from "./Brand";
import { FooterAuthLinks } from "./FooterAuthLinks";

/**
 * Site footer: wordmark + unaffiliated-tool tagline, plus a links row. Styling
 * (top hairline, surface, padding) lives in the `.foot` class in globals.css.
 */
export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="flex flex-col gap-1">
        <Brand />
        <span className="u-small mt-1.5">
          An unofficial planning tool for UWaterloo undergrads. Not affiliated
          with the University of Waterloo.
        </span>
      </div>
      <div className="foot-links">
        <FooterAuthLinks />
        <Link href="/catalog">Course catalog</Link>
        <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
          GitHub
        </a>
      </div>
    </footer>
  );
}
