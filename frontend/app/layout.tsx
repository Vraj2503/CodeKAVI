import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
      className={`${geistSans.variable} ${geistMono.variable}`}
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
