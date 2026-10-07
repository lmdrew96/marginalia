import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GearIcon, PenNibIcon } from "@/components/icons";
import "./globals.css";

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('marginalia-theme')||'moss';var m=localStorage.getItem('marginalia-mode')||'dark';document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-mode',m);}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display serif for titles and margin notes.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Marginalia",
  description:
    "Read, highlight, and write in the margins — with Claude beside the page.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        data-theme="moss"
        data-mode="dark"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <Script
            id="theme-init"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
          />
          <Show when="signed-in">
            <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
              <Link
                href="/library"
                className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight"
              >
                <PenNibIcon className="h-5 w-5 text-accent" />
                Marginalia
              </Link>
              <div className="flex items-center gap-3">
                <Link
                  href="/settings"
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-secondary transition-colors hover:bg-surface hover:text-on-surface"
                >
                  <GearIcon className="h-4 w-4" />
                  <span className="hidden sm:inline">Settings</span>
                </Link>
                <ThemeToggle />
                <UserButton />
              </div>
            </header>
          </Show>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
