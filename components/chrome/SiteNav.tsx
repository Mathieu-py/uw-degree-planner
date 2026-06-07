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

// Signed-out visitors go to the planner, which shows the create flow when
// there's no local plan yet. Signed-in visitors get their plans dashboard.
const DEMO_LINK: NavLink = {
  label: "Demo planner",
  href: "/plan",
  match: "/plan",
};
const MY_PLANS_LINK: NavLink = {
  label: "My plans",
  href: "/plans",
  match: "/plans",
};

/**
 * Sticky, blurred top nav. Left: wordmark + section links (active from the
 * pathname). Right: theme toggle + sign-in/account control. Styling lives in
 * the `.nav` class. The wordmark links "home": plans dashboard when signed in,
 * marketing landing when signed out.
 */
export function SiteNav() {
  const pathname = usePathname();
  const { isAuthed } = useAuthState();
  const links = isAuthed
    ? [...BASE_LINKS, MY_PLANS_LINK]
    : [...BASE_LINKS, DEMO_LINK];
  return (
    <header className="nav sticky top-0 z-40">
      <div className="flex items-center gap-8">
        <Brand href={isAuthed ? "/plans" : "/"} />
        <nav className="nav-links hidden md:flex">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className={`nav-link ${l.match && (pathname === l.match || pathname.startsWith(`${l.match}/`)) ? "is-active" : ""}`.trim()}
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
