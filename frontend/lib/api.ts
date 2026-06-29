/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "./supabase";

const API_BASE = "/api";
import { mockChatResponse, mockVizResponse, mockExplanationResponse } from "./mockData";

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return {
        "Authorization": `Bearer ${session.access_token}`,
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
  | "mindmap";

export interface VizResponse {
  type: string;
  data: unknown;
}

export interface ExplanationResponse {
  explanation: string;
  tokens_used: number;
  model: string;
}

// ── API Functions ──

/**
 * Restore analysis results from backend cache (Redis/Supabase).
 * Returns null if the repo has expired (404), throws on other errors.
 */
export async function restoreRepo(
  repoId: string
): Promise<AnalyzeResponse | null> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/restore/${repoId}`, {
      headers,
    });
    if (res.status === 404) {
      return null; // Repo expired — caller should show re-analyze prompt
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Restore failed: ${res.status} ${errText}`);
    }
    return res.json();
  } catch (e: unknown) {
    if ((e as any).message?.includes("Restore failed")) throw e;
    // Network error — return null so UI degrades gracefully
    console.warn("Failed to restore repo:", e);
    return null;
  }
}


export async function analyzeRepo(
  githubUrl: string
): Promise<AnalyzeResponse> {
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
      if (typeof errDetail === 'object') {
        if (Array.isArray(errDetail) && errDetail.length > 0 && errDetail[0].msg) {
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

export interface AnalysisProgressEvent {
  stage: string;
  progress: number;
  message: string;
  data?: AnalyzeResponse;
}

/**
 * Stream repo analysis with real-time progress updates via SSE.
 * Falls back to the regular analyzeRepo() if streaming fails.
 */
export async function analyzeRepoStream(
  githubUrl: string,
  onProgress: (event: AnalysisProgressEvent) => void
): Promise<AnalyzeResponse> {
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
            finalData = event.data;
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

  return finalData;
}

export async function chatWithRepo(
  repoId: string,
  query: string
): Promise<ChatResponse> {
  if (repoId === "dev-mock-repo") {
    return new Promise((resolve) => setTimeout(() => resolve({
      success: true,
      repo_id: repoId,
      answer: mockChatResponse(),
      sources: [{ file_path: "src/index.ts", score: 0.95 }, { file_path: "src/utils.ts", score: 0.88 }]
    }), 1000));
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
  useLlm: boolean = false
): Promise<VizResponse> {
  if (repoId === "dev-mock-repo") {
    return new Promise((resolve) => setTimeout(() => resolve({
      type,
      data: mockVizResponse(type)
    }), 500));
  }

  const authHeaders = await getAuthHeaders();
  const isPost = type === "mindmap";
  const endpoint = `${API_BASE}/visualize/${type}/${repoId}`;

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
  vizType: string
): Promise<ExplanationResponse> {
  if (repoId === "dev-mock-repo") {
    return new Promise((resolve) => setTimeout(() => resolve({
      explanation: mockExplanationResponse(vizType),
      tokens_used: 120,
      model: "mock-model"
    }), 1000));
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
