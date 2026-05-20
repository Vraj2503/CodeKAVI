import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CodeKavi — NotebookLM for GitHub",
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
    <html lang="en" suppressHydrationWarning className={geistMono.variable}>
      <body className={cn("font-sans antialiased", geistMono.className)}>
        <ThemeProvider>
          <Toaster theme="system" position="top-right" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
