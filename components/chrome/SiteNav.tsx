"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/auth/UserMenu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useAuthState } from "@/lib/auth/store";
import { Brand } from "./Brand";

interface NavLink {
  label: string;
  href: string;
  /** Pathname this link is "active" for (anchors don't get active state). */
  match?: string;
}

const BASE_LINKS: NavLink[] = [
  { label: "Course catalog", href: "/catalog", match: "/catalog" },
];

// Signed-out visitors are in demo mode (local plan), so surface a direct link
// to the demo planner.
const DEMO_LINK: NavLink = {
  label: "Demo planner",
  href: "/plan",
  match: "/plan",
};

/**
 * Sticky, blurred top navigation shared across marketing/catalog/settings.
 * Left: wordmark + section links (active state from the pathname). Right:
 * appearance toggle + the sign-in/account control. Visual styling (blur,
 * hairline, height) lives in the `.nav` class in globals.css.
 */
export function SiteNav() {
  const pathname = usePathname();
  const { isAuthed } = useAuthState();
  const links = isAuthed ? BASE_LINKS : [...BASE_LINKS, DEMO_LINK];
  return (
    <header className="nav sticky top-0 z-40">
      <div className="flex items-center gap-8">
        <Brand />
        <nav className="nav-links hidden md:flex">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className={`nav-link ${l.match && pathname === l.match ? "is-active" : ""}`.trim()}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="nav-right">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
