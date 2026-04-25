const API_BASE = "/api";

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

export async function analyzeRepo(githubUrl: string): Promise<AnalyzeResponse> {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ github_url: githubUrl }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || "Analysis failed");
  }
  return data;
}

export async function chatWithRepo(
  repoId: string,
  query: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat/${repoId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || "Chat request failed");
  }
  return data;
}
