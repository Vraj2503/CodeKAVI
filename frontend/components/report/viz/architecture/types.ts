export interface ArchitectureRequest {
  schema_version: string;
  view: string;
  detail: string;
  include?: {
    actors?: boolean;
    entry_points?: boolean;
    application_capabilities?: boolean;
    state?: boolean;
    async_infrastructure?: boolean;
    external_integrations?: boolean;
    technology_products?: boolean;
    model_names?: boolean;
    edge_labels?: boolean;
    evidence?: string;
  };
  layout?: {
    direction?: string;
    routing?: string;
    max_nodes?: number;
    max_edges?: number;
    collapse_supporting_components?: boolean;
  };
  enrichment?: {
    mode?: string;
  };
  focus?: {
    node_id?: string;
    entrypoint_id?: string;
  };
}

export interface ArchitectureRepository {
  repo_id: string;
  topology: string;
  confidence: number;
}

export interface ArchitectureGroup {
  id: string;
  label: string;
  order: number;
  kind: string;
}

export interface ArchitectureTechnology {
  vendor: string;
  product: string;
  model?: string;
  purpose?: string;
  confidence: number;
}

export interface ArchitectureEvidence {
  path: string;
  lines?: number[];
  reason: string;
}

export interface ArchitectureNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  kind: string;
  group_id: string;
  summary: string;
  technologies: ArchitectureTechnology[];
  confidence: number;
  evidence: ArchitectureEvidence[];
}

export interface ArchitectureEdgeSection {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: { x: number; y: number }[];
}

export interface ArchitectureEdgeData extends Record<string, unknown> {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: string;
  protocol?: string;
  async?: boolean;
  confidence: number;
  evidence_count: number;
  sections?: ArchitectureEdgeSection[];
}

export interface ArchitectureCollapsed {
  id: string;
  label: string;
  member_ids: string[];
  reason: string;
}

export interface ArchitectureAvailableFocus {
  id: string;
  kind: string;
  label: string;
}

export interface ArchitectureDiagnostics {
  status: string;
  unsupported_languages: string[];
  excluded_low_confidence_edges: number;
  source_coverage: number;
}

export interface ArchitectureGraphData {
  schema_version: string;
  repository: ArchitectureRepository;
  groups: ArchitectureGroup[];
  nodes: ArchitectureNodeData[];
  edges: ArchitectureEdgeData[];
  collapsed: ArchitectureCollapsed[];
  available_focuses: ArchitectureAvailableFocus[];
  diagnostics: ArchitectureDiagnostics;
}

export interface ArchitectureResponse {
  type: string;
  data: ArchitectureGraphData;
}
