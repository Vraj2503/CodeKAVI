import type { Metadata } from "next";
import { Martian_Mono, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { CommandPalette } from "@/components/CommandPalette";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";
import { cn } from "@/lib/utils";

/*
 * TELEMETRY type system — three faces, three jobs.
 *
 *   Martian Mono   display. Extremely wide, engineered, unmistakable. Used
 *                  ONLY at large sizes and for the wordmark; its width is
 *                  an asset in a 40px heading and a liability in a 12px
 *                  label, so it never appears in body contexts.
 *   IBM Plex Sans  chrome. Buttons, nav, prose. Designed for technical
 *                  documentation, so it stays legible at 11px in a dense
 *                  panel where a display grotesque would fall apart.
 *   IBM Plex Mono  data. Paths, identifiers, counts, telemetry readouts.
 *                  Metrically related to Plex Sans, so mono and sans can
 *                  sit on the same line without the baseline jumping.
 */
const display = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["400", "600", "700"],
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  // Was "CodeKavi — NotebookLM for GitHub", which explains this product by
  // naming a different one and leaves the reader to work out the mapping.
  title: "CodeKavi — read any codebase",
  description:
    "Every repository explained in plain language, cited line by line.",
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
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className={cn("font-sans antialiased")}>
        <ThemeProvider>
          <AuthProvider>
            <Toaster theme="system" position="bottom-right" />
            {/* Global ⌘K. Mounted once here so every route has it. */}
            <CommandPalette />
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

