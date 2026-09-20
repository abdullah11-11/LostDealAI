import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://lostdeal-ai.equal-dune-2306.chatgpt.site"),
  applicationName: "LostDeal AI",
  title: { default: "LostDeal AI — Recover the customers you almost had", template: "%s | LostDeal AI" },
  description: "Analyze lost sales, uncover why deals failed, and identify the opportunities most worth recovering.",
  openGraph: {
    title: "LostDeal AI",
    description: "Turn lost opportunities into clear recovery priorities.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "LostDeal AI — Turn lost opportunities into clear recovery priorities." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LostDeal AI",
    description: "Turn lost opportunities into clear recovery priorities.",
    images: ["/og.png"],
  },
  icons: {
    icon: [{ url: "/lostdeal-favicon-v2.ico", type: "image/x-icon" }],
    shortcut: "/lostdeal-favicon-v2.ico",
    apple: [{ url: "/lostdeal-apple-touch-icon-v2.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head><Script src="/theme-init.js" strategy="beforeInteractive" /></head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
