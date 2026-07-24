import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { SiteNav } from "@/components/chrome/SiteNav";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { SITE_URL, THEME_INIT_SCRIPT } from "@/lib/constants";
import "./globals.css";

// Hanken Grotesk = UI text; JetBrains Mono = course codes, term labels, counts.
// Both variable fonts, so one self-hosted face covers the full weight range.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

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
