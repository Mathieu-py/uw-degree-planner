import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./tailwind.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UW Elective Finder",
  description:
    "Browse and filter UWaterloo elective courses by usefulness, easiness, and prerequisites.",
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
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight">
              UW Elective Finder
            </Link>
            <nav className="flex items-center gap-5 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/browse" className="hover:text-zinc-950 dark:hover:text-zinc-50">
                Browse
              </Link>
              <a
                href="https://github.com/Mathieu-py/uw-elective-finder"
                target="_blank"
                rel="noreferrer noopener"
                className="hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                GitHub
              </a>
            </nav>
          </div>
        </header>
        <main className="flex-1 flex flex-col">{children}</main>
        <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-12">
          <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-zinc-500 dark:text-zinc-400 flex flex-wrap gap-3 justify-between">
            <p>
              Data from <a className="underline hover:text-zinc-700 dark:hover:text-zinc-200" href="https://uwflow.com" target="_blank" rel="noreferrer noopener">UWFlow</a>. Not affiliated with the University of Waterloo.
            </p>
            <p>
              Open source on{" "}
              <a className="underline hover:text-zinc-700 dark:hover:text-zinc-200" href="https://github.com/Mathieu-py/uw-elective-finder" target="_blank" rel="noreferrer noopener">
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
