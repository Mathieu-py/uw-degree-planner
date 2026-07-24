import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

// Hanken Grotesk = UI text; JetBrains Mono = course codes, term labels, counts.
// Both variable fonts, so one self-hosted face covers the full weight range.
// Shared so global-error (which renders its own <html>) applies the same faces.
export const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});
