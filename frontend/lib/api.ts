/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "./supabase";

const API_BASE = "/api";
import {
  mockChatResponse,
  mockVizResponse,
  mockExplanationResponse,
} from "./mockData";

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      return {
        Authorization: `Bearer ${session.access_token}`,
      };
    }
  } catch (e) {
    console.error("Error getting auth session token:", e);
  }
  return {};
}

export interface AnalyzeResponse {
  success: boolean;
  repo_id: string;
  repo_name: string;
  owner: string;
  github_url: string;
  total_files: number;
  total_size: number;
  total_size_formatted: string;
  languages: Record<string, number>;
  tree: FileNode[];
  files: FileInfo[];
  file_profiles: FileProfile[];
  role_summary: RoleSummary;
  graph: GraphData;
  module_graph: ModuleGraphData;
  cycles: CycleData;
  mermaid: MermaidData;
  nn_models?: NNModel[];
}

export interface FileNode {
  name: string;
  type: "file" | "dir";
  path: string;
  size?: number;
  size_formatted?: string;
  language?: string;
  children?: FileNode[];
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  language: string;
  size: number;
  size_formatted: string;
  depth: number;
}

export interface FileProfile {
  path: string;
  name: string;
  language: string;
  size: number;
  size_formatted: string;
  role: string;
  role_label: string;
  role_confidence: number;
  depends_on: string[];
  used_by: string[];
  in_degree: number;
  out_degree: number;
  importance_score: number;
  tags: string[];
}

export interface RoleSummary {
  total_files: number;
  role_counts: Record<string, number>;
  role_distribution: Record<string, number>;
  top_files: { file: string; role: string; importance: number }[];
  dependency_hubs: {
    file: string;
    role: string;
    in_degree: number;
    out_degree: number;
    total_connections: number;
  }[];
}

export interface GraphNode {
  id: string;
  label: string;
  group: string;
  full_path: string;
  in_degree: number;
  out_degree: number;
  role: string;
  role_label: string;
  importance: number;
  language: string;
  is_entry_point: boolean;
  size: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  raw: string;
  line: number;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    total_nodes: number;
    total_edges: number;
    connected_nodes: number;
    groups: string[];
  };
}

export interface ModuleGraphData {
  modules: any[];
  connections: any[];
  graph_json: { nodes: any[]; edges: any[] };
  mermaid: string;
}

export interface CycleData {
  has_cycles: boolean;
  cycle_count: number;
  cycles: string[][];
  summary: string;
}

export interface MermaidData {
  file_level: string;
  module_level: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  timestamp: number;
}

export interface ChatSource {
  file_path: string;
  score: number;
}

export interface ChatResponse {
  success: boolean;
  repo_id: string;
  answer: string;
  sources: ChatSource[];
  error?: string;
}

// ── Visualization Types (NEW) ──

export type VizType =
  | "dependencies"
  | "complexity"
  | "architecture"
  | "dataflow"
  | "mindmap"
  | "neural_network";

export interface VizResponse {
  type: string;
  data: unknown;
}

// ── Neural Network Model Types ──

export interface NNBlockDims {
  height: number;
  depth: number;
  width: number;
}

export interface NNLayer {
  id: string;
  type: string;
  category: string;
  params: Record<string, any>;
  output_shape?: number[];
  param_count?: number;
  activation?: string;
  block_dims?: NNBlockDims;
}

export interface NNConnection {
  from_id: string;
  to_id: string;
  type: "sequential" | "skip" | "concat" | "add";
  label?: string;
}

export interface NNBlock {
  name: string;
  layers: string[];
  has_skip: boolean;
}

export interface NNModel {
  name: string;
  file: string;
  line: number;
  framework: string;
  type: "class" | "sequential" | "functional";
  total_params?: number;
  input_shape?: number[];
  output_shape?: number[];
  layers: NNLayer[];
  connections: NNConnection[];
  blocks?: NNBlock[];
}

export interface ExplanationResponse {
  explanation: string;
  tokens_used: number;
  model: string;
}

// ── Semantic Graph Types (Phase 1) ──

export interface RepoGraphLayer {
  id: string;
  name: string;
  label: string;
  file_count: number;
  tier: number;
}

export interface RepoGraphContainer {
  id: string;
  layer_id: string;
  name: string;
  strategy: "folder" | "community";
  file_ids: string[];
}

export interface RepoGraphFile {
  id: string;
  path: string;
  name: string;
  container_id: string | null;
  layer_id: string | null;
  role: string | null;
  role_label: string | null;
  importance: number;
  in_degree: number;
  out_degree: number;
  language: string | null;
  size: number;
  kind: "file";
  parent: null;
  flags: string[];
}

export interface RepoGraphEdge {
  source: string;
  target: string;
  level: "file" | "container" | "layer";
  count: number;
}

export interface RepoGraphPortal {
  from_layer: string;
  to_layer: string;
  connection_count: number;
}

export interface RepoGraphInsights {
  cycles: string[][];
  orphans: string[];
  central: string[];
  entry_points: string[];
}

export interface RepoGraphPayload {
  fingerprint: string;
  layers: RepoGraphLayer[];
  containers: RepoGraphContainer[];
  files: RepoGraphFile[];
  edges: RepoGraphEdge[];
  portals: RepoGraphPortal[];
  insights: RepoGraphInsights;
}

/** `res.ok` is true for 202, so callers must branch on `status` before touching `data`. */
export type RepoGraphResult =
  { status: "ok"; data: RepoGraphPayload } | { status: "re-analyzing" };

// ── Tour Types (Phase 2, E5/E6) ──

export type TourMode = "learn" | "recall" | "diff";

export interface TourStep {
  order: number;
  node_ids: string[];
  layer_id: string | null;
  title: string;
  facts: string[];
  questions: string[];
  change_type?: "STRUCTURAL" | "COSMETIC";
}

export interface TourResponse {
  mode: TourMode | "question";
  steps: TourStep[];
  /** H4: only present on diff-tour responses — files removed since last analysis. */
  deleted_count?: number;
}

// ── API Functions ──

/**
 * Why a restore failed — not merely that it did.
 *
 * The previous signature collapsed "the cache expired", "you are signed out"
 * and "the backend is unreachable" into a single `null` (plus a throw carrying
 * raw backend text). Each needs a different action from the user, so the caller
 * has to be able to tell them apart before it can offer a recovery.
 */
export type RestoreResult =
  | { status: "ok"; data: AnalyzeResponse }
  /** 404 — the 3-tier cache chain has nothing. Re-analysis is the only fix. */
  | { status: "expired" }
  /** 401/403 — `/restore` requires a Supabase JWT; a shared link arrives without one. */
  | { status: "unauthenticated" }
  /** Network failure, timeout, or 5xx. Retrying may work; re-analysing won't. */
  | { status: "unreachable"; detail: string };

/** A restore that hasn't answered by now isn't going to. */
const RESTORE_TIMEOUT_MS = 20_000;

/**
 * Restore analysis results from the backend cache chain (memory → Redis → Supabase).
 */
export async function restoreRepo(repoId: string): Promise<RestoreResult> {
  if (repoId === "dev-mock-repo") {
    const { mockAnalyzeResponse } = await import("./mockData");
    return { status: "ok", data: mockAnalyzeResponse() };
  }

  let res: Response;
  try {
    const headers = await getAuthHeaders();
    res = await fetch(`${API_BASE}/restore/${repoId}`, {
      headers,
      // Without a deadline, a backend that accepts the socket and never replies
      // leaves the page spinning forever — the exact dead end this call feeds.
      signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
    });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("Failed to restore repo:", detail);
    return { status: "unreachable", detail };
  }

  if (res.ok) {
    try {
      return { status: "ok", data: await res.json() };
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      return { status: "unreachable", detail: `Malformed response: ${detail}` };
    }
  }
  if (res.status === 404) return { status: "expired" };
  if (res.status === 401 || res.status === 403) {
    return { status: "unauthenticated" };
  }
  const errText = await res.text().catch(() => "");
  return { status: "unreachable", detail: `${res.status} ${errText}`.trim() };
}

export async function analyzeRepo(githubUrl: string): Promise<AnalyzeResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ github_url: githubUrl }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let errDetail: string | any = "Analysis failed";
    try {
      const errJson = JSON.parse(errText);
      errDetail = errJson.detail || errJson.error || errDetail;
      if (typeof errDetail === "object") {
        if (
          Array.isArray(errDetail) &&
          errDetail.length > 0 &&
          errDetail[0].msg
        ) {
          errDetail = errDetail.map((e: any) => e.msg).join(", ");
        } else {
          errDetail = JSON.stringify(errDetail);
        }
      }
    } catch {
      if (errText.trim()) errDetail = errText;
    }
    throw new Error(errDetail as string);
  }
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || "Analysis failed");
  }
  return data;
}

// ── SSE Streaming Analysis ──

export interface StreamCompleteData {
  total_events: number;
  result: AnalyzeResponse;
}

export interface AnalysisProgressEvent {
  stage: string;
  progress: number;
  message: string;
  seq?: number;
  data?: AnalyzeResponse | StreamCompleteData;
}

function isStreamCompleteData(data: unknown): data is StreamCompleteData {
  return (
    typeof data === "object" &&
    data !== null &&
    "result" in data &&
    "total_events" in data
  );
}

/**
 * Stream repo analysis with real-time progress updates via SSE.
 * Falls back to the regular analyzeRepo() if streaming fails.
 */
export async function analyzeRepoStream(
  githubUrl: string,
  onProgress: (event: AnalysisProgressEvent) => void,
): Promise<AnalyzeResponse> {
  if (githubUrl === "mock://nn") {
    const { mockAnalyzeResponse } = await import("./mockData");
    onProgress({
      stage: "init",
      progress: 0,
      message: "Starting mock analysis...",
    });
    await new Promise((r) => setTimeout(r, 500));
    onProgress({
      stage: "analyzing",
      progress: 50,
      message: "Mocking NN models...",
    });
    await new Promise((r) => setTimeout(r, 500));
    onProgress({ stage: "complete", progress: 100, message: "Mock complete." });
    return mockAnalyzeResponse();
  }

  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/analyze/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ github_url: githubUrl }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Analysis failed" }));
    throw new Error(err.detail || "Analysis failed");
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Streaming not supported");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalData: AnalyzeResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from the buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event: AnalysisProgressEvent = JSON.parse(line.slice(6));
          onProgress(event);

          if (event.stage === "error") {
            throw new Error(event.message);
          }

          if (event.stage === "complete" && event.data) {
            if (isStreamCompleteData(event.data)) {
              finalData = event.data.result;
            } else {
              finalData = event.data as AnalyzeResponse;
            }
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            // Skip malformed JSON
            continue;
          }
          throw e;
        }
      }
    }
  }

  if (!finalData) {
    throw new Error("Analysis stream ended without complete event");
  }

  if (!finalData.repo_id) {
    throw new Error(
      "Received malformed analysis data from server (missing repo_id)",
    );
  }

  return finalData;
}

export async function chatWithRepo(
  repoId: string,
  query: string,
): Promise<ChatResponse> {
  if (repoId === "dev-mock-repo") {
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            success: true,
            repo_id: repoId,
            answer: mockChatResponse(),
            sources: [
              { file_path: "src/index.ts", score: 0.95 },
              { file_path: "src/utils.ts", score: 0.88 },
            ],
          }),
        1000,
      ),
    );
  }

  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/chat/${repoId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let errDetail = "Chat request failed";
    try {
      const errJson = JSON.parse(errText);
      errDetail = errJson.detail || errJson.error || errDetail;
    } catch {
      if (errText.trim()) errDetail = errText;
    }
    throw new Error(errDetail);
  }
  return res.json();
}

// ── NEW: Visualization API Functions ──

export async function fetchVisualization(
  repoId: string,
  type: VizType,
  useLlm: boolean = false,
): Promise<VizResponse> {
  if (repoId === "dev-mock-repo") {
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            type,
            data: mockVizResponse(type),
          }),
        500,
      ),
    );
  }

  const authHeaders = await getAuthHeaders();
  const isPost = type === "mindmap";
  const vizPath = type === "neural_network" ? "nn" : type;
  const endpoint = `${API_BASE}/visualize/${vizPath}/${repoId}`;

  const res = await fetch(endpoint, {
    method: isPost ? "POST" : "GET",
    headers: {
      ...authHeaders,
      ...(isPost && { "Content-Type": "application/json" }),
    },
    ...(isPost && {
      body: JSON.stringify({ use_llm: useLlm }),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || `Failed to fetch ${type} visualization`);
  }

  return res.json();
}

export async function fetchVisualizationExplanation(
  repoId: string,
  vizType: string,
): Promise<ExplanationResponse> {
  if (repoId === "dev-mock-repo") {
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            explanation: mockExplanationResponse(vizType),
            tokens_used: 120,
            model: "mock-model",
          }),
        1000,
      ),
    );
  }

  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/explain/visualization/${vizType}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify({ repo_id: repoId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Failed to generate explanation");
  }

  return res.json();
}

/**
 * Fetch the Phase 1 semantic graph. A 202 means the repo is re-analyzing —
 * `res.ok` is true for 202 too, so that branch must be checked first
 * (review N-2: a naive `!res.ok` check renders re-analyzing as an error).
 */
export async function fetchRepoGraph(
  repoId: string,
  signal?: AbortSignal,
): Promise<RepoGraphResult> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/graph/semantic/${repoId}`, {
    headers: authHeaders,
    signal,
  });

  if (res.status === 202) {
    return { status: "re-analyzing" };
  }

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: "Failed to load graph" }));
    throw new Error(err.detail || `Failed to load graph (${res.status})`);
  }

  return { status: "ok", data: await res.json() };
}

/** Fetch a tour. "diff" (H3) hits its own endpoint; learn/recall (E5) share
 * one behind a ?mode= param. No 202 handling needed — the tour is only
 * requested once the graph itself has already loaded. */
export async function fetchTour(
  repoId: string,
  mode: TourMode,
  signal?: AbortSignal,
): Promise<TourResponse> {
  const authHeaders = await getAuthHeaders();
  const url =
    mode === "diff"
      ? `${API_BASE}/graph/semantic/${repoId}/tour/diff`
      : `${API_BASE}/graph/semantic/${repoId}/tour?mode=${mode}`;
  const res = await fetch(url, { headers: authHeaders, signal });

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: "Failed to load tour" }));
    throw new Error(err.detail || `Failed to load tour (${res.status})`);
  }

  return res.json();
}

/** G3: question-driven tour — the only tour endpoint that costs tokens
 * (embeds ``q``), so it's fetched on explicit submit, not on every keystroke. */
export async function fetchQuestionTour(
  repoId: string,
  q: string,
  signal?: AbortSignal,
): Promise<TourResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_BASE}/graph/semantic/${repoId}/tour/question?q=${encodeURIComponent(q)}`,
    { headers: authHeaders, signal },
  );

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: "Failed to load tour" }));
    const detail =
      typeof err.detail === "string" ? err.detail : err.detail?.message;
    throw new Error(detail || `Failed to load tour (${res.status})`);
  }

  return res.json();
}

/** A3: on-demand LLM narration for a single tour step's node. Falls back to
 * `narration: null` on any non-2xx too — callers already treat null as
 * "use static facts", so a network/provider hiccup degrades the same way
 * a deliberate empty result from the backend does. */
export async function fetchTourNodeNarration(
  repoId: string,
  nodeId: string,
  signal?: AbortSignal,
): Promise<{ narration: string | null }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(
    `${API_BASE}/graph/semantic/${repoId}/tour/node/${encodeURIComponent(nodeId)}`,
    { headers: authHeaders, signal },
  );

  if (!res.ok) {
    return { narration: null };
  }

  return res.json();
}
