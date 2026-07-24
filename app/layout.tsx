import type { Metadata } from "next";
import { SiteNav } from "@/components/chrome/SiteNav";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { SITE_URL, THEME_INIT_SCRIPT } from "@/lib/constants";
import { hanken, jetbrainsMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // `default` titles the home page; `template` suffixes each child segment's
  // own bare title (e.g. "Settings").
  title: {
    default: "UW Degree Planner",
    template: "%s · UW Degree Planner",
  },
  description:
    "Plan every term of your UWaterloo degree on one screen, with live requirement audit, prereq checks, and UWFlow ratings.",
  openGraph: {
    title: "UW Degree Planner",
    description:
      "Plan every term of your UWaterloo degree on one screen, with live requirement audit, prereq checks, and UWFlow ratings.",
    siteName: "UW Degree Planner",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${hanken.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted static
            anti-FOUC snippet; must run before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <SiteNav />
          <main className="flex-1 flex flex-col">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
