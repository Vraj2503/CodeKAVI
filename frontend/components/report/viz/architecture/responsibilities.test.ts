import { describe, expect, it } from "vitest";
import { getRichResponsibility, splitIntoSentences } from "./responsibilities";
import { ArchitectureNodeData } from "./types";

function node(overrides: Partial<ArchitectureNodeData>): ArchitectureNodeData {
  return {
    id: "cap-api",
    label: "API & Request Entry",
    kind: "gateway",
    group_id: "entry",
    summary: "",
    confidence: 0.9,
    technologies: [],
    evidence: [],
    ...overrides,
  };
}

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

  it("shows the backend's points from facts, one per line", () => {
    const summary = [
      "checkout.py: Takes payment for a cart.",
      "cart.py: Routes: POST /cart, DELETE /cart/{item}.",
      "Spans 2 source files, led by routes/checkout.py.",
    ];
    expect(getRichResponsibility(node({ summary: summary.join("\n") }))).toEqual(summary);
  });

  it("adds no fixed text to a short summary, for a component or a provider", () => {
    const generic = "Provides api & request entry responsibilities.";
    expect(getRichResponsibility(node({ summary: generic }))).toEqual([generic]);

    const redis = node({
      id: "tech-redis",
      label: "Redis — Cache & Rate Limits",
      kind: "datastore",
      group_id: "state",
      summary: "Used in this repository by backend/rune/cache.py.",
      technologies: [{ vendor: "Redis", product: "Cache & Rate Limits", confidence: 0.9, purpose: "In-memory cache" }],
    });
    expect(getRichResponsibility(redis)).toEqual(["Used in this repository by backend/rune/cache.py."]);
  });

  it("with no summary, states only the files the node rests on", () => {
    const evidence = [
      { path: "backend/rune/routes/chat.py", reason: "Classified as router" },
      { path: "backend/rune/routes/analyze.py", reason: "Classified as router" },
      { path: "backend/rune/routes/graph.py", reason: "Classified as router" },
    ];
    expect(getRichResponsibility(node({ evidence: evidence.slice(0, 2) }))).toEqual([
      "Implemented in `chat.py` and `analyze.py`.",
    ]);
    expect(getRichResponsibility(node({ evidence }))).toEqual([
      "Implemented in 3 source files, including `chat.py` and `analyze.py`.",
    ]);
    expect(getRichResponsibility(node({}))).toEqual([]);
  });

  it("keeps the AI mode's labelled points", () => {
    const summary = [
      "Role in project: Handles incoming HTTP requests for repository analysis.",
      "Business problem solved: Gives developers a map of an unfamiliar codebase.",
      "Key project workflows: Dispatches analysis jobs and streams progress to the client.",
      "Implemented in 4 source files, including `visualize.py` and `chat.py`.",
    ];
    expect(getRichResponsibility(node({ summary: summary.join("\n\n") }))).toEqual(summary);
  });
});
