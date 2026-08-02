import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { site } from "@/lib/site";

// Self-hosted so production builds never reach fonts.googleapis.com — that
// fetch fails in a network-restricted Docker build.
const sans = localFont({
  src: "./fonts/Inter-latin.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});

const serif = localFont({
  src: [
    { path: "./fonts/Fraunces-latin.woff2", weight: "400 600", style: "normal" },
    { path: "./fonts/Fraunces-latin-italic.woff2", weight: "400 600", style: "italic" },
  ],
  variable: "--font-serif",
  display: "swap",
});

// The whole app is behind a login and holds client tax data. Nothing here
// should ever be indexed, so the directive is set once, at the root, rather
// than repeated per page and eventually forgotten on one.
export const metadata: Metadata = {
  metadataBase: new URL(`https://${site.domain}`),
  title: { default: `${site.name} — CRM`, template: `%s — ${site.name}` },
  description: site.description,
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};

/**
 * Deliberately bare: no marketing header or footer. This app is an internal
 * tool, and its only chrome is the CRM's own section nav
 * (components/crm/CrmChrome, mounted once by app/crm/layout.tsx) plus the
 * sign-in pages, which carry their own wordmark.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen bg-paper-50 font-sans antialiased">
        <main>{children}</main>
      </body>
    </html>
  );
}
