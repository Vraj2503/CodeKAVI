import type { Metadata, Viewport } from "next";
import LandingPage from "@/components/landing/LandingPage";

/*
 * The landing page's three faces — Bricolage Grotesque, Hanken Grotesk and
 * JetBrains Mono — are loaded once in `app/layout.tsx` and inherited from
 * `<html>`. They used to be declared here, which meant the dashboard had to
 * ship them a second time to look like the page it sits behind.
 */

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
  return <LandingPage />;
}
