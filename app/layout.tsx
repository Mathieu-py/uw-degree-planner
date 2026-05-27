import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { UserMenu } from "@/components/auth/UserMenu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UW Degree Planner",
  description:
    "Plan every term of your UWaterloo degree on one screen, with live requirement audit, prereq checks, and UWFlow ratings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="bg-black text-zinc-100 border-b border-zinc-800">
          <div className="px-6 sm:px-8 lg:px-12 py-5 flex items-center justify-between">
            <Link
              href="/"
              className="font-semibold tracking-tight text-zinc-50"
            >
              UW Degree Planner
            </Link>
            <nav className="flex items-center gap-5 text-sm text-zinc-400">
              <Link href="/plan" className="hover:text-zinc-50">
                Plan
              </Link>
              <a
                href="https://github.com/Mathieu-py/uw-elective-finder"
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-zinc-50"
              >
                GitHub
              </a>
              <span aria-hidden="true" className="h-5 w-px bg-zinc-700" />
              <UserMenu />
            </nav>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
        <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-12">
          <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap gap-3 justify-between">
            <p>
              Data from{" "}
              <a
                className="underline hover:text-zinc-700 dark:hover:text-zinc-200"
                href="https://uwflow.com"
                target="_blank"
                rel="noreferrer noopener"
              >
                UWFlow
              </a>
              . Not affiliated with the University of Waterloo.
            </p>
            <p>
              Open source on{" "}
              <a
                className="underline hover:text-zinc-700 dark:hover:text-zinc-200"
                href="https://github.com/Mathieu-py/uw-elective-finder"
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
