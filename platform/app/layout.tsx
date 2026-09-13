import type { Metadata } from "next";
import { Audiowide, Caveat, Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

// Display face for headings (Tailwind `font-serif`). Instrument Serif ships a
// single weight; app/globals.css pins .font-serif to 400 so browsers do not
// synthesise a smeared faux-bold where headings ask for `font-bold`.
const display = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  preload: false,
});

// Brand wordmark only (components/brand/Logo.tsx). Its squared, rounded
// letterforms match the supplied CleverMathematics logotype; it is not a UI
// face and nothing else should set it.
const brand = Audiowide({
  variable: "--font-brand",
  weight: "400",
  subsets: ["latin"],
  preload: false,
});

// The hand that writes the answers on the student self-check view
// (app/dashboard/na-feedback). Caveat is a joined, pen-weight face whose
// digits stay distinct from one another, which matters more here than in any
// other use of a script font: these ARE the answers, and a 5 that could be
// read as a 6 is worse than no handwriting at all.
//
// It applies to the answer text only, never to maths. KaTeX positions every
// glyph from the measured widths of its own fonts, so overriding the family
// inside .katex moves superscripts and fraction bars off their characters --
// a rendered answer would be wrong rather than merely plain. The rule in
// app/globals.css scopes .font-hand accordingly.
const hand = Caveat({
  variable: "--font-hand",
  weight: ["400", "600"],
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "CleverPlatform",
  description: "Mathematics Learning Platform",
  verification: {
    // Two verification codes: the original for clever-platform.vercel.app,
    // and a second for the new custom domain (www.clevermathematics.com).
    // Next renders one <meta name="google-site-verification"> tag per entry.
    google: [
      "7Fr-yPK0g6wsK2aegQmlXm7cilLNEQGpQyYwoOiwRGM",
      "_wLFEOHwPpl6d0cJ03A-Fji3ihYDUZSdS5ycB4F4RQg",
    ],
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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${brand.variable} ${hand.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className={`${geistSans.className} min-h-full flex flex-col`}>
        {children}
      </body>
    </html>
  );
}
