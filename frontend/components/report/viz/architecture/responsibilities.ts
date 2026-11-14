import { ArchitectureNodeData } from "./types";

const ROLE_EXPLANATIONS: Record<string, string[]> = {
  "API & Request Entry": [
    "Role in project: Serves as the primary ingress gateway for the project, exposing public API endpoints, routes, and controllers that clients and services interact with.",
    "What it does in the project: Ingests incoming requests, parses parameters against defined contracts, and dispatches calls to downstream business handlers.",
    "Project safeguards: Enforces route authentication, request body validation, and rate-limiting guards to prevent malformed or unauthorized calls from reaching core services.",
  ],
  "Application Orchestration": [
    "Role in project: Functions as the central workflow orchestrator for the project, directing multi-step business workflows and coordinating actions across domain services.",
    "What it does in the project: Sequences end-to-end multi-step application lifecycles, coordinating operations across internal domain services.",
    "Project coordination: Manages execution state transitions, handles fallback strategies when secondary services fail, and mediates communications between processing pipelines and external services.",
  ],
  "Processing Pipeline": [
    "Role in project: Drives the core transformation and data processing engine for the project, processing input data into structured system representations.",
    "What it does in the project: Executes automated transformation, validation, and data extraction routines, preparing normalized data structures for consuming services.",
    "Project output: Generates structured records, analytical aggregates, and state checkpoints that power the project's features and views.",
  ],
  "Data Access": [
    "Role in project: Acts as the project's data persistence and cache management layer, abstracting database queries and storage operations for all services.",
    "What it does in the project: Executes queries for persistent entities, user sessions, index lookups, and serialized domain representations.",
    "Project safeguards: Enforces transactional integrity, query sanitization, and data consistency, insulating upstream domain logic from database drivers and connection pools.",
  ],
  "Shared Application Services": [
    "Role in project: Supplies universal utilities, cross-cutting algorithms, and helper routines utilized throughout the entire project.",
    "What it does in the project: Implements reusable string formatters, cryptographic hashing, date-time parsers, mathematical calculations, and logging helpers.",
    "Value to the project: Prevents duplicate logic and ensures consistent behavior across different modules and background routines.",
  ],
  "API Route Handler": [
    "Role in project: Dispatches incoming HTTP requests to dedicated endpoint controllers across the project's API surface.",
    "What it does in the project: Maps individual URL routes to business handlers, extracts path parameters, and deserializes JSON request bodies.",
    "Project error handling: Traps domain exceptions and formats standard HTTP error responses and status codes back to client callers.",
  ],
  "API & Access Control": [
    "Role in project: Enforces security policies, authentication verification, and access guardrails for the project.",
    "What it does in the project: Verifies bearer tokens, user session cookies, and API permissions before allowing requests to execute backend logic.",
    "Project safeguards: Applies rate-limiting buckets and IP throttling to protect the project's services and AI tokens from abuse or runaway loops.",
  ],
  "Application Service": [
    "Role in project: Contains the core business logic, domain algorithms, and specialized operational workflows of the project.",
    "What it does in the project: Processes business calculations, coordinates state mutations, and mediates between API ingress and persistent storage.",
    "Architectural role: Keeps the project's fundamental business rules clean and independent of web frameworks, HTTP routers, or UI components.",
  ],
  "Domain Models": [
    "Role in project: Defines the foundational data schemas, typed entities, and object structures that model the project's domain.",
    "What it does in the project: Specifies data contracts for repositories, analysis graphs, file profiles, visual nodes, and user configurations.",
    "Data integrity: Enforces type safety, structural validations, and default values, preventing schema corruption and drift across project layers.",
  ],
  "Client Interface": [
    "Role in project: Houses the interactive presentation layer for the project, rendering the graphical diagrams, dashboards, and control panels in the user's browser.",
    "What it does in the project: Renders the dynamic architecture graphs, complexity treemaps, radar charts, and interactive chat sidebars that allow users to explore the codebase.",
    "Interactive role: Manages client-side zoom, pan, and node inspection state while streaming real-time server-sent events (SSE) during active repository analysis.",
  ],
  "Client Page": [
    "Role in project: Represents top-level routes and page layouts in the project's web frontend application.",
    "What it does in the project: Organizes view hierarchies, navigation transitions, and URL query state across different analytical views.",
    "View coordination: Orchestrates initial data fetching and mounts error boundaries to prevent rendering crashes from breaking the application.",
  ],
  "Background Worker": [
    "Role in project: Executes heavy background processing jobs and deferred tasks away from user-facing HTTP request threads.",
    "What it does in the project: Powers long-running operations like full repository indexing, vector embedding generation, and graph dependency extraction.",
    "Project reliability: Prevents browser requests from timing out and manages job retries, task heartbeats, and failure recovery.",
  ],
  "Background Job": [
    "Role in project: Defines modular, asynchronous work units and scheduled batch routines executed by background workers.",
    "What it does in the project: Encapsulates specific tasks such as cache pruning, index updates, report exports, and repository cleanup.",
    "Operational role: Ensures heavy computational routines run idempotently without interrupting active user workflows.",
  ],
  "Middleware & Auth": [
    "Role in project: Operates as a request-response interceptor, applying cross-cutting policies across every HTTP call in the project.",
    "What it does in the project: Injects CORS headers, authenticates user tokens, logs request diagnostics, and catches unhandled exceptions.",
    "System observability: Tracks request timing and distributed tracing identifiers to monitor performance and debug issues across the project.",
  ],
  "Configuration": [
    "Role in project: Centralizes runtime environment variables, service credentials, and feature switches for the project.",
    "What it does in the project: Loads database connection strings, AI provider API keys, server ports, and indexing thresholds into typed settings.",
    "Startup safety: Validates configuration parameters at application boot, catching missing credentials before services start processing traffic.",
  ],
  "Authentication & Session": [
    "Role in project: Manages user identities, secure session tokens, and access credentials throughout the project.",
    "What it does in the project: Handles user sign-in, issues cryptographic tokens (JWTs), and maintains session states for authorized accounts.",
    "Project security: Supplies verified user context to route handlers and data access layers to ensure strict multi-tenant data isolation.",
  ],
  "Messaging / Notifications": [
    "Role in project: Dispatches real-time alerts, event updates, and notifications from the project to users and external services.",
    "What it does in the project: Formats message templates, routes notifications to delivery providers, and broadcasts status changes to connected clients.",
    "Decoupling role: Decouples core business events from delivery mechanics, preventing third-party latency from slowing down project workflows.",
  ],
  "Application Component": [
    "Role in project: Implements specialized functional logic supporting specific domain workflows within the project.",
    "What it does in the project: Processes targeted inputs, applies domain-specific rules, and collaborates with adjacent architectural modules.",
    "Modularity role: Keeps specialized routines organized into modular units, preventing monolithic coupling across the codebase.",
  ],
};

const KIND_FALLBACK_EXPLANATIONS: Record<string, string[]> = {
  gateway: [
    "Role in project: Serves as an architectural gateway managing network communication and request dispatching across project boundaries.",
    "What it does in the project: Validates inbound communication contracts and ensures protocol compliance before passing payloads to downstream handlers.",
    "Project boundaries: Isolates external transport and network concerns from core application business logic.",
  ],
  service: [
    "Role in project: Implements core business logic, domain rules, and computational workflows for this functional area of the project.",
    "What it does in the project: Coordinates data transformations and mediates interactions between ingress layers and persistence datastores.",
    "Project consistency: Maintains operational invariants and ensures consistent processing across domain capabilities.",
  ],
  datastore: [
    "Role in project: Serves as the persistence foundation for this tier of the project, managing structured data storage and query execution.",
    "What it does in the project: Guarantees data durability, access authorization, and consistency across state read and write operations.",
    "Project isolation: Shields application services from low-level storage driver and connection pool complexities.",
  ],
  client: [
    "Role in project: Delivers user-facing interface elements, presentation layout structures, and client-side interaction state for the project.",
    "What it does in the project: Captures user actions and orchestrates visual updates in response to backend events and user workflows.",
    "User experience: Maintains client state consistency and handles localized presentation error states.",
  ],
  worker: [
    "Role in project: Executes asynchronous tasks and heavy background computational workloads detached from interactive request threads.",
    "What it does in the project: Processes queued work items with automated retry logic, error logging, and timeout boundaries.",
    "Performance role: Shields interactive project services from latency-sensitive or long-running computational overhead.",
  ],
  queue: [
    "Role in project: Buffers event streams and message payloads to decouple asynchronous producers from downstream processing consumers.",
    "What it does in the project: Guarantees reliable message delivery semantics and absorbs high-volume workload traffic spikes across the project.",
    "Scalability role: Facilitates horizontal scaling and independent deployment of specialized background worker pools.",
  ],
  external: [
    "Role in project: Integrates external third-party infrastructure, SaaS platforms, or cloud provider APIs into the project.",
    "What it does in the project: Wraps provider-specific protocols and authentication keys behind standardized application contracts.",
    "Project resilience: Ensures resilience through network retry mechanisms, rate limit tracking, and timeout guards.",
  ],
};

const TECH_RESPONSIBILITIES: Record<string, string[]> = {
  "Supabase:Auth, Postgres & Storage": [
    "Role in project: Supplies the primary managed backend platform for the project, providing unified user authentication, relational database storage, and file asset hosting.",
    "What it does in the project: Verifies user JWT tokens on API requests, stores relational repository metadata and user records in PostgreSQL, and stores generated report artifacts in cloud storage.",
    "Project safeguards: Enforces row-level security (RLS) policies and authenticated sessions to protect proprietary repository insights and analysis history.",
    "Project integration: Integrated across the project's auth middleware, analysis cache stores, and client session providers as the central persistence backbone.",
  ],
  "PostgreSQL:Database": [
    "Role in project: Serves as the primary relational database for the project, providing durable, ACID-compliant storage for all structured repository data.",
    "What it does in the project: Stores repository records, commit metadata, dependency graphs, user accounts, and analysis timestamps across structured relational tables.",
    "Project performance: Runs indexed queries, joins, and relational lookups to retrieve cached repository insights and analysis state with low latency.",
    "Project integration: Connected directly to the project's data access and caching layer, guaranteeing transactional consistency across concurrent analysis runs.",
  ],
  "Redis:Cache & Rate Limits": [
    "Role in project: Operates as the high-speed in-memory caching and request-coordination layer across the project's backend services.",
    "What it does in the project: Caches computationally intensive query outputs, session tokens, and volatile state to deliver sub-millisecond data retrieval.",
    "Project safeguards: Enforces sliding-window API rate limits and token bucket throttling on sensitive endpoints to protect backend workers and external APIs from traffic surges.",
    "Project synchronization: Stores distributed locks, ephemeral user session flags, and active task statuses to coordinate asynchronous job processing across the codebase.",
  ],
  "MongoDB:Database": [
    "Role in project: Provides document-oriented storage for the project, handling semi-structured data payloads and dynamic graph structures.",
    "What it does in the project: Persists JSON/BSON graph nodes, variable analysis payloads, and flexible document models without rigid table schema constraints.",
    "Project flexibility: Supports dynamic indexing and aggregation pipelines to query unstructured technical metadata efficiently.",
    "Project integration: Interfaced by specialized project services that store variable-format analysis outputs and dynamic code metadata.",
  ],
  "MySQL:Database": [
    "Role in project: Operates as the relational data store for the project, managing structured tabular business records and transactional logs.",
    "What it does in the project: Manages core system configurations, user accounts, and historical analysis records using ACID-compliant relational schemas.",
    "Project reliability: Ensures referential integrity and data durability across read and write operations via InnoDB storage engines and foreign key constraints.",
    "Project integration: Linked to the project's repository layers to persist and retrieve application state reliably.",
  ],
  "Zilliz Cloud:Milvus": [
    "Role in project: Powers the Retrieval-Augmented Generation (RAG) and semantic code search capabilities across the project.",
    "What it does in the project: Stores and indexes high-dimensional vector embeddings generated from the project's source code, function signatures, and documentation.",
    "How it serves the project: When a developer queries the project in chat, it performs fast vector similarity searches to retrieve the exact code chunks needed to ground the AI's response.",
    "Project integration: Interfaced during background repository indexing to ingest code vectors and queried by the chat service during user interactions.",
  ],
  "Pinecone:Vector Database": [
    "Role in project: Serves as the managed vector search backend for the project's semantic retrieval and AI code assistant features.",
    "What it does in the project: Stores dense vector representations generated from codebase files, functions, and documentation snippets.",
    "How it serves the project: Executes low-latency similarity searches across code vectors to fetch top-k contextual snippets whenever users ask questions in chat.",
    "Project integration: Connected to the project's indexing and RAG chat pipelines to support instant semantic code exploration.",
  ],
  "Qdrant:Vector Database": [
    "Role in project: Delivers high-performance vector similarity search and payload-based vector storage for the project's RAG workflows.",
    "What it does in the project: Stores dense code embeddings paired with rich JSON payload metadata for precise code chunk retrieval.",
    "How it serves the project: Combines vector distance scoring with boolean metadata filters to locate relevant source code files based on user prompts.",
    "Project integration: Integrated with the project's vector store service to power context retrieval for code explanations and chat.",
  ],
  "Chroma:Vector Database": [
    "Role in project: Operates as an embedded or local vector store powering semantic search for the project without cloud infrastructure overhead.",
    "What it does in the project: Stores document chunks, code snippets, and corresponding vector embeddings within local collection indices.",
    "How it serves the project: Provides fast nearest-neighbor retrieval to furnish LLMs with relevant codebase context during question-answering.",
    "Project integration: Used by the project's local analysis routines to enable instant vector indexing and semantic retrieval.",
  ],
  "Cloudflare:Workers AI": [
    "Role in project: Executes serverless machine learning inference at the network edge for the project with minimal latency.",
    "What it does in the project: Runs quantized language models and embedding pipelines close to clients to offload compute-heavy NLP tasks from the origin server.",
    "Project efficiency: Minimizes latency for initial text transformations and embedding calculations without requiring dedicated GPU infrastructure.",
    "Project integration: Interfaced via edge worker clients to accelerate pre-processing and model inference for the project.",
  ],
  "OpenAI:Models": [
    "Role in project: Powers the project's advanced code analysis, architectural reasoning, and interactive conversational assistant.",
    "What it does in the project: Ingests code snippets, symbol hierarchies, and architectural graphs extracted by the backend to generate plain-English explanations, tour narratives, and refactoring guidance.",
    "Value to the project: Translates complex AST data and dependency structures into human-readable developer insights with high contextual accuracy.",
    "Project integration: Connected directly to the project's chat and explain API routes, enabling real-time developer query answering over the analyzed codebase.",
  ],
  "Anthropic:Claude": [
    "Role in project: Serves as the high-capacity reasoning engine for the project, analyzing long-context codebase relationships and complex design patterns.",
    "What it does in the project: Processes expansive repository contexts, cross-file architectural dependencies, and multifaceted design patterns to generate comprehensive codebase summaries.",
    "Value to the project: Formulates detailed code tour narratives, architectural breakdowns, and refactoring recommendations with technical precision.",
    "Project integration: Invoked by the project's architectural explanation and guided tour services to produce in-depth technical documentation.",
  ],
  "Google:Gemini": [
    "Role in project: Provides large-context multimodal reasoning for the project's deep repository-scale analysis workflows.",
    "What it does in the project: Ingests entire repository source trees, configuration manifests, and documentation within its massive context window to synthesize project-wide architecture overviews.",
    "Value to the project: Detects subtle cross-module patterns and answers complex architectural queries across large multi-language codebases.",
    "Project integration: Powers the project's high-level repository summary generator and full-codebase explanation features.",
  ],
  "Groq:Llama": [
    "Role in project: Delivers ultra-low-latency LPU model inference for the project's real-time streaming chat and code explanations.",
    "What it does in the project: Generates instant streaming responses for chat queries, quick file summaries, and symbol lookups with near-zero latency.",
    "Value to the project: Eliminates wait times for interactive user experiences, ensuring developer questions receive immediate conversational feedback.",
    "Project integration: Backs the project's primary streaming chat endpoint, optimizing conversational responsiveness during code exploration.",
  ],
  "Ollama:Local LLM": [
    "Role in project: Executes large language models locally on private infrastructure, ensuring complete data privacy for sensitive codebases.",
    "What it does in the project: Performs local inference for code explanation, semantic classification, and query answering without sending proprietary source code to external cloud APIs.",
    "Project privacy: Guarantees zero external data leakage, zero API rate-limit constraints, and complete offline capability for the project.",
    "Project integration: Connected as the private inference provider for local and air-gapped deployments of the project.",
  ],
  "Apache Kafka:Kafka": [
    "Role in project: Acts as the high-throughput distributed event backbone for the project's asynchronous processing pipelines.",
    "What it does in the project: Buffers and routes high-volume event streams between fast repository ingestion endpoints and downstream indexing workers.",
    "Project resilience: Prevents service saturation during large batch analysis jobs, guaranteeing ordered message delivery and replayable event logs upon worker failures.",
    "Project integration: Serves as the message transport coordinating communication between analysis producers and background consumer workers.",
  ],
  "RabbitMQ:RabbitMQ": [
    "Role in project: Serves as the reliable message broker distributing asynchronous background jobs across the project's worker pools.",
    "What it does in the project: Queues repository cloning, AST extraction, complexity profiling, and vector indexing tasks, dispatching them to available worker nodes.",
    "Project safeguards: Implements task acknowledgments, prefetch limits, and dead-letter queues to ensure failed jobs are tracked and retried without crashing the system.",
    "Project integration: Bridges user-facing web endpoints with the project's background worker pool, keeping interactive response times snappy.",
  ],
  "AWS:S3": [
    "Role in project: Serves as the project's durable cloud object storage for repository archives, large analysis artifacts, and generated reports.",
    "What it does in the project: Stores file-system snapshots, static visualization files, raw telemetry dumps, and exported architecture diagrams.",
    "Project efficiency: Offloads heavy binary storage and bandwidth consumption from web servers, providing pre-signed URLs for authenticated user downloads.",
    "Project integration: Linked to the project's export and caching services as the central storage repository for generated assets.",
  ],
  "AWS:SQS": [
    "Role in project: Provides managed message queuing that decouples the project's web endpoints from long-running background analysis jobs.",
    "What it does in the project: Buffers asynchronous repository analysis requests, re-indexing triggers, and notification deliveries.",
    "Project reliability: Eliminates bottlenecks during usage spikes with automatic scaling, visibility timeouts, and dead-letter queues for unprocessable tasks.",
    "Project integration: Mediates between the project's API entry points and background task executors, ensuring tasks are processed reliably.",
  ],
  "AWS:Lambda": [
    "Role in project: Executes event-driven serverless functions for the project, performing on-demand compute tasks without persistent server overhead.",
    "What it does in the project: Runs short-lived background tasks—such as file format transformations, webhook dispatches, and metric computations—in response to queue or S3 triggers.",
    "Project scalability: Scales compute capacity instantaneously to handle bursty repository analysis workloads while minimizing operational costs.",
    "Project integration: Used for offloading auxiliary compute tasks and webhook event handling across the project.",
  ],
  "AWS:EventBridge": [
    "Role in project: Operates as the serverless event bus coordinating event routing across the project's decoupled microservices and external webhooks.",
    "What it does in the project: Ingests, filters, and routes repository lifecycle events to targeted endpoints, Lambda functions, or SQS queues based on pattern rules.",
    "Project automation: Schedules automated recurring jobs—such as repository re-indexing, cache cleanups, and maintenance routines.",
    "Project integration: Connects the project's distributed services without brittle point-to-point network couplings.",
  ],
  "GitHub:API": [
    "Role in project: Serves as the external Git platform bridge connecting the project to remote repositories on GitHub.",
    "What it does in the project: Clones repository trees, pulls commit histories, inspects branch references, and retrieves source files for deep static analysis.",
    "Project automation: Listens to GitHub push and pull-request webhooks to trigger automated re-analysis and diagram updates when code changes.",
    "Project integration: Connected to the project's cloner and repository source modules, handling OAuth tokens and API rate limits securely.",
  ],
  "GitLab:API": [
    "Role in project: Connects the project to GitLab's platform to access repository sources, branches, and commit histories.",
    "What it does in the project: Clones source trees, downloads repository archives, and inspects merge request diffs for architecture mapping.",
    "Project automation: Subscribes to GitLab webhooks to ensure visualizations and complexity metrics stay synchronized with repository updates.",
    "Project integration: Handled by the project's repository source layer, managing GitLab personal access tokens and project scopes.",
  ],
  "Bitbucket:API": [
    "Role in project: Integrates the project with Bitbucket workspaces to inspect enterprise repositories and version histories.",
    "What it does in the project: Clones repository source trees and downloads commit diffs to feed the project's static analysis and dependency extraction engines.",
    "Project automation: Receives Bitbucket repository webhooks to trigger automatic re-indexing when developers push code.",
    "Project integration: Interfaced by the project's cloner service to securely authenticate and fetch code from Bitbucket workspaces.",
  ],
};

function formatEvidenceSentence(evidence: ArchitectureNodeData["evidence"]): string {
  if (!evidence || evidence.length === 0) {
    return "Project implementation: Serves as an essential architectural boundary in this project, decoupling this layer from surrounding application concerns.";
  }

  const cleanPaths = evidence.map((e) => e.path).filter((p) => p && !p.startsWith("<"));
  if (cleanPaths.length === 0) {
    return "Project implementation: Serves as an essential architectural boundary in this project, decoupling this layer from surrounding application concerns.";
  }

  const count = cleanPaths.length;
  const sample = cleanPaths.slice(0, 2).map((p) => p.split("/").pop() || p);
  const sampleStr = sample.map((s) => `\`${s}\``).join(" and ");

  if (count === 1) {
    return `Project implementation: Implemented in this project by source file ${sampleStr}, defining the primary concrete logic for this capability.`;
  } else if (count === 2) {
    return `Project implementation: Implemented in this project across 2 source files (${sampleStr}), establishing a cohesive architectural boundary.`;
  } else {
    return `Project implementation: Backed by ${count} source files in this repository (including ${sampleStr}), consolidating these operations in a single layer.`;
  }
}

export function splitIntoSentences(text: string): string[] {
  if (!text) return [];

  if (text.includes("\n")) {
    return text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Split on sentence boundaries: period/exclamation/question followed by space and a prefix/capital letter
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z`])/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Returns an array of 3-4 brief, non-generic explanation sentences for an architecture node,
 * specifically emphasizing its role in the project.
 */
export function getRichResponsibility(node: ArchitectureNodeData): string[] {
  const summary = (node.summary || "").trim();

  // If summary already has structured project points (from backend LLM or rich generator), use it directly!
  if (
    summary &&
    (summary.includes("Role in project:") ||
      summary.includes("Business problem solved:") ||
      summary.includes("Project implementation:"))
  ) {
    const parsed = splitIntoSentences(summary);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  // Check if summary is already rich and project-focused
  const isGeneric =
    !summary ||
    summary.startsWith("Provides ") && summary.endsWith("responsibilities.") ||
    summary.startsWith("Provides ") && summary.endsWith(".") && summary.length < 50 ||
    summary === "Backend as a Service" ||
    summary === "In-memory cache" ||
    summary === "NoSQL document store" ||
    summary === "Vector database" ||
    summary === "Vector search";

  if (!isGeneric) {
    const parsed = splitIntoSentences(summary);
    if (
      parsed.length >= 2 &&
      parsed.some((s) => {
        const lower = s.toLowerCase();
        return lower.includes("project") || lower.includes("business problem");
      })
    ) {
      return parsed;
    }
  }

  // Check if this is a technology node
  if (node.technologies && node.technologies.length > 0) {
    const tech = node.technologies[0];
    const techKey = `${tech.vendor}:${tech.product}`;
    if (TECH_RESPONSIBILITIES[techKey]) {
      return [...TECH_RESPONSIBILITIES[techKey]];
    }
  }

  // Fallback to role-specific project explanation
  const baseSentences =
    ROLE_EXPLANATIONS[node.label] ||
    KIND_FALLBACK_EXPLANATIONS[node.kind] ||
    KIND_FALLBACK_EXPLANATIONS.service;

  const result = [...baseSentences];
  result.push(formatEvidenceSentence(node.evidence));
  return result;
}
