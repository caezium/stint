import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Stint",
  description: "Kart data analysis platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <header className="border-b border-border/40 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <Link href="/sessions" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-red-500 flex items-center justify-center">
                <span className="text-white text-xs font-bold">S</span>
              </div>
              <span className="text-lg font-semibold tracking-tight">
                Stint
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-sm">
              <Link
                href="/sessions"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Sessions
                <kbd className="hidden sm:inline-block ml-1.5 text-[10px] text-muted-foreground/50 border border-border/50 rounded px-1 py-0.5">
                  S
                </kbd>
              </Link>
              <Link
                href="/upload"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Upload
                <kbd className="hidden sm:inline-block ml-1.5 text-[10px] text-muted-foreground/50 border border-border/50 rounded px-1 py-0.5">
                  U
                </kbd>
              </Link>
              <Link
                href="/tracks"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Tracks
              </Link>
              <Link
                href="/reports"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Reports
              </Link>
              <Link
                href="/settings"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
