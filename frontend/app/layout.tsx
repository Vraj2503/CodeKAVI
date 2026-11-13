import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Geist,
  Geist_Mono,
  Hanken_Grotesk,
  JetBrains_Mono,
} from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/*
 * The landing page's three faces, declared here so the dashboard can use them
 * too. The marketing page is the product's fixed visual world — display type
 * in Bricolage Grotesque, prose in Hanken Grotesk, paths and numerals in
 * JetBrains Mono — and the dashboard is that world one click in.
 *
 * On `<html>` rather than in `app/page.tsx`, where they started: a variable on
 * the root is inherited by every route, so the two surfaces share one download
 * instead of shipping the same fonts twice.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
  axes: ["opsz"],
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Rune — read any codebase",
  description:
    "Understand any codebase through AI-powered chat grounded in source code.",
  keywords: ["code analysis", "GitHub", "AI", "codebase", "architecture"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} ${hanken.variable} ${jetbrains.variable}`}
    >
      <body className={cn("font-sans antialiased")}>
        <ThemeProvider>
          <AuthProvider>
            {/*
              Bottom-right, hairline-bordered, no shadow theatre — a toast is a
              status line here, not a card that lands on top of the work.
            */}
            <Toaster
              theme="system"
              position="bottom-right"
              offset={20}
              toastOptions={{
                classNames: {
                  toast:
                    "!rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-pop !font-sans",
                  description: "!text-muted-foreground",
                  actionButton: "!bg-foreground !text-background",
                },
              }}
            />
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
