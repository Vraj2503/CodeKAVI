import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Hanken_Grotesk,
  JetBrains_Mono,
} from "next/font/google";
import LandingPage from "@/components/landing/LandingPage";

/*
 * The landing page's three faces. Self-hosted through next/font so the first
 * paint already has the real display face — the page is mostly type, and a
 * swap-in would move the hero headline.
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
  title: "CodeKAVI: codebase intelligence for inherited repositories",
  description:
    "Understand any public repository in seconds. CodeKAVI maps the code, explains what each file is for, and answers your questions with the exact files and lines behind every answer.",
  openGraph: {
    title: "CodeKAVI: codebase intelligence for inherited repositories",
    description:
      "Understand any repository fast. Every answer points to the exact file and lines it came from.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C1519",
  colorScheme: "dark",
};

export default function HomePage() {
  return (
    <div
      className={`${bricolage.variable} ${hanken.variable} ${jetbrains.variable}`}
    >
      <LandingPage />
    </div>
  );
}
