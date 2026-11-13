import { describe, expect, it } from "vitest";
import { getRichResponsibility, splitIntoSentences } from "./responsibilities";
import { ArchitectureNodeData } from "./types";

describe("architecture responsibilities", () => {
  it("splits multi-sentence text into individual sentences", () => {
    const text =
      "Acts as the primary entry gateway for inbound client traffic. Parses incoming request payloads. Normalizes response payloads into standardized JSON envelopes. Backed by 6 source files.";
    const sentences = splitIntoSentences(text);
    expect(sentences).toHaveLength(4);
    expect(sentences[0]).toContain("Acts as the primary entry gateway");
    expect(sentences[3]).toContain("Backed by 6 source files");
  });

  it("handles newlines in splitIntoSentences", () => {
    const text = "Point 1.\nPoint 2.\nPoint 3.";
    const sentences = splitIntoSentences(text);
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toBe("Point 1.");
  });

  it("replaces generic one-liner summaries with 3-4 brief non-generic explanations", () => {
    const legacyNode: ArchitectureNodeData = {
      id: "cap-api",
      label: "API & Request Entry",
      kind: "gateway",
      group_id: "entry",
      summary: "Provides api & request entry responsibilities.",
      confidence: 0.9,
      evidence: [
        { path: "backend/rune/routes/chat.py", reason: "Classified as entry" },
        { path: "backend/rune/routes/analyze.py", reason: "Classified as entry" },
      ],
    };

    const result = getRichResponsibility(legacyNode);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(5);

    // Verify project-specific content
    expect(result.some((s) => s.includes("Role in project:"))).toBe(true);
    expect(result.some((s) => s.includes("What it does in the project:"))).toBe(true);
    expect(result.some((s) => s.includes("chat.py"))).toBe(true);
    expect(result.every((s) => !s.startsWith("Provides "))).toBe(true);
  });

  it("provides non-generic project explanations for technology nodes", () => {
    const redisNode: ArchitectureNodeData = {
      id: "tech-redis",
      label: "Redis — Cache & Rate Limits",
      kind: "cache",
      group_id: "state",
      summary: "In-memory cache",
      confidence: 0.9,
      technologies: [
        {
          vendor: "Redis",
          product: "Cache & Rate Limits",
          confidence: 0.9,
          purpose: "In-memory cache",
        },
      ],
      evidence: [],
    };

    const result = getRichResponsibility(redisNode);
    expect(result.length).toBe(4);
    expect(result.some((s) => s.includes("Role in project:"))).toBe(true);
    expect(result.some((s) => s.includes("What it does in the project:"))).toBe(true);
    expect(result.some((s) => s.includes("rate limit"))).toBe(true);
  });

  it("preserves LLM-enriched summary containing Business problem solved", () => {
    const enrichedNode: ArchitectureNodeData = {
      id: "cap-api",
      label: "API & Request Entry",
      kind: "gateway",
      group_id: "entry",
      summary:
        "Role in project: Handles incoming HTTP and WebSocket requests for repository analysis and real-time visualization. Business problem solved: Eliminates developer confusion when exploring unfamiliar codebases by delivering structured architecture insights. Key project workflows: Dispatches requests to background workers and streams progress updates back to the client interface. Project implementation: Backed by 4 source files in this repository (including backend/rune/routes/visualize.py), consolidating these operations in a single layer.",
      confidence: 0.9,
      evidence: [],
    };

    const result = getRichResponsibility(enrichedNode);
    expect(result).toHaveLength(4);
    expect(result[0]).toContain("Role in project:");
    expect(result[1]).toContain("Business problem solved:");
    expect(result[2]).toContain("Key project workflows:");
    expect(result[3]).toContain("Project implementation:");
  });

  it("preserves already rich multi-sentence explanations from backend", () => {
    const richNode: ArchitectureNodeData = {
      id: "cap-custom",
      label: "Custom Analysis Service",
      kind: "service",
      group_id: "application",
      summary:
        "Role in project: Orchestrates specialized code analysis workflows across repository layers. What it does in the project: Validates syntax trees and computes complexity scores. Project safeguards: Streamlines background telemetry to keep clients updated. Project implementation: Backed by 3 source files in this repository.",
      confidence: 0.9,
      evidence: [],
    };

    const result = getRichResponsibility(richNode);
    expect(result).toHaveLength(4);
    expect(result[0]).toContain("Role in project:");
  });
});
