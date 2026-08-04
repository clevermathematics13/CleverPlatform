import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { ThemeController } from "@/components/theme/ThemeController";
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

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "CleverPlatform",
  description: "IBDP Mathematics Learning Platform",
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
      data-theme="whiskey"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className={`${geistSans.className} min-h-full flex flex-col`}>
        {children}
        <ThemeController />
      </body>
    </html>
  );
}
