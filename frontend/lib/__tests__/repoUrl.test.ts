import { describe, it, expect } from "vitest";
import { normalizeRepoUrl } from "../repoUrl";

describe("normalizeRepoUrl", () => {
  it("leaves a full https URL alone", () => {
    expect(normalizeRepoUrl("https://github.com/vercel/next.js")).toBe(
      "https://github.com/vercel/next.js",
    );
  });

  it("adds a scheme to a bare supported host", () => {
    expect(normalizeRepoUrl("github.com/vercel/next.js")).toBe(
      "https://github.com/vercel/next.js",
    );
  });

  it("preserves gitlab and bitbucket rather than forcing github", () => {
    expect(normalizeRepoUrl("gitlab.com/foo/bar")).toBe(
      "https://gitlab.com/foo/bar",
    );
    expect(normalizeRepoUrl("bitbucket.org/foo/bar")).toBe(
      "https://bitbucket.org/foo/bar",
    );
  });

  it("assumes github for a bare owner/repo", () => {
    // The regression this file exists for: `owner/repo` has no hostname,
    // so the backend reported it as an unsupported *host*.
    expect(normalizeRepoUrl("vercel/next.js")).toBe(
      "https://github.com/vercel/next.js",
    );
  });

  it("rewrites an scp-style ssh remote to https", () => {
    expect(normalizeRepoUrl("git@github.com:vercel/next.js.git")).toBe(
      "https://github.com/vercel/next.js.git",
    );
  });

  it("strips www., which the backend matches as a different host", () => {
    expect(normalizeRepoUrl("https://www.github.com/foo/bar")).toBe(
      "https://github.com/foo/bar",
    );
    expect(normalizeRepoUrl("www.github.com/foo/bar")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("trims surrounding whitespace and a trailing slash", () => {
    expect(normalizeRepoUrl("  foo/bar/  ")).toBe("https://github.com/foo/bar");
  });

  it("passes unrecognised input through for the backend to reject", () => {
    // The backend owns validation; guessing here would only produce a
    // less accurate error message.
    expect(normalizeRepoUrl("https://example.com/foo/bar")).toBe(
      "https://example.com/foo/bar",
    );
  });

  it("returns empty input unchanged", () => {
    expect(normalizeRepoUrl("   ")).toBe("");
  });
});
