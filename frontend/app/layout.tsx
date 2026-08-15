import type { Metadata } from "next";
import { Newsreader, Archivo, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";
import { cn } from "@/lib/utils";

/*
 * Three faces, three jobs — see globals.src.css.
 *
 *   Newsreader  narrative. Headings and the long-form walkthrough prose the
 *               report pages are made of. Optical sizing is why it holds up
 *               at both 13px captions and 60px display.
 *   Archivo     chrome. Buttons, labels, nav — anything that is interface
 *               rather than content.
 *   JetBrains   code. Paths, identifiers, counts. Monospace is a *signal*
 *               here, so it must never be the default (it used to be).
 */
const serif = Newsreader({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  axes: ["opsz"],
});

const sans = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
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
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className={cn("font-sans antialiased")}>
        <ThemeProvider>
          <AuthProvider>
            <Toaster theme="system" position="top-right" />
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

