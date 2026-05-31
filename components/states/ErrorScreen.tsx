"use client";

import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Icon } from "@/components/ui/Icon";
import { REPO_URL } from "@/lib/constants";

const QUICK_LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "Home", href: "/" },
  { label: "Course catalog", href: "/catalog" },
  { label: "Sign in", href: "/login" },
  { label: "GitHub", href: REPO_URL, external: true },
];

interface Props {
  kind: "404" | "500";
  eyebrow: string;
  title: string;
  body: ReactNode;
  /** Primary CTA. Either a link target or a click handler (e.g. retry). */
  primary:
    | { label: string; href: string }
    | { label: string; onClick: () => void };
  /** Secondary CTA — always a link. */
  secondary: { label: string; href: string };
  /** Optional digest/reference shown under the body (server error). */
  reference?: string | null;
}

/**
 * Shared full-page error lockup for `not-found.tsx` (404) and `error.tsx` (500),
 * in the editorial black/gold system. The "digit · empty-slot · digit" motif
 * (`.er-*` in globals.css) reuses the planner's empty-slot language — a dashed
 * slot with a search glyph (404) or a bolt (500). The root layout already
 * provides SiteNav, so this renders the centered content + footer only.
 */
export function ErrorScreen({
  kind,
  eyebrow,
  title,
  body,
  primary,
  secondary,
  reference,
}: Props) {
  const digits = kind === "404" ? ["4", "4"] : ["5", "5"];
  return (
    <>
      <div className="flex-1 flex items-center justify-center px-7 py-10">
        <div className="er-wrap">
          <div className="er-lockup">
            <span className="er-digit">{digits[0]}</span>
            <span className="er-slot" aria-hidden="true">
              {kind === "404" ? (
                <span className="text-accent">
                  <Icon name="search" size="xl" aria-hidden="true" />
                </span>
              ) : (
                <span className="text-partial">
                  <Icon name="bolt" size="xl" aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="er-digit">{digits[1]}</span>
          </div>

          <span className="u-eyebrow mt-7">
            <span
              className="dot"
              aria-hidden="true"
              style={
                kind === "500"
                  ? {
                      background: "var(--partial)",
                      boxShadow: "0 0 0 3px var(--partial-soft)",
                    }
                  : undefined
              }
            />
            {eyebrow}
          </span>

          <h1 className="u-display mt-3.5 text-[clamp(34px,4.4vw,52px)]">
            {title}
          </h1>
          <p className="u-lede mt-3.5 max-w-[520px]">{body}</p>
          {reference ? (
            <p className="u-mono u-small mt-3">Reference: {reference}</p>
          ) : null}

          <div className="flex flex-wrap justify-center gap-3 mt-7">
            {"href" in primary ? (
              <Link href={primary.href} className={PRIMARY_CTA}>
                {primary.label}
                <Icon name="arrow" size="sm" aria-hidden="true" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={primary.onClick}
                className={PRIMARY_CTA}
              >
                {primary.label}
                <Icon name="arrow" size="sm" aria-hidden="true" />
              </button>
            )}
            <Link href={secondary.href} className={SECONDARY_CTA}>
              {secondary.label}
            </Link>
          </div>

          <div className="er-links mt-6">
            {QUICK_LINKS.map((link, i) => (
              <Fragment key={link.label}>
                {i > 0 ? (
                  <span className="er-dot" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noreferrer noopener">
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href}>{link.label}</Link>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}

const PRIMARY_CTA =
  "inline-flex items-center justify-center gap-2 h-[48px] px-6 text-[15px] " +
  "font-semibold rounded-[10px] bg-primary text-primary-ink hover:bg-primary-hover";

const SECONDARY_CTA =
  "inline-flex items-center justify-center gap-2 h-[48px] px-6 text-[15px] " +
  "font-semibold rounded-[10px] border border-line-2 bg-bg text-ink hover:bg-bg-2";
