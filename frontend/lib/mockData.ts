/* eslint-disable @typescript-eslint/no-explicit-any */
export function mockChatResponse() {
  const responses = [
    "Here is how this works in the codebase. You can find the main logic in `src/index.ts` where it initializes the application.",
    "The data flow starts from the API layer and goes through the services. Check `src/services/api.ts` for more details.",
    "This part of the code uses a custom hook to manage state. It's a standard pattern used throughout the app.",
    "I found references to this in several places, mainly in the UI components and the utility functions.",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Module configuration used by the `dependencies` mock to build a realistic
 * architectural module hierarchy. Module IDs match `ModuleInfo.name` — the
 * key the DependencyGraph component uses to wire up file-level expansion.
 */
const modulesConfig = [
  {
    name: "routes",
    files: [
      "src/routes/auth.routes.ts",
      "src/routes/api.routes.ts",
      "src/routes/web.routes.ts",
    ],
    roles: { routes: 3 },
    importance: 0.92,
    internal_edges: 0,
  },
  {
    name: "services",
    files: [
      "src/services/userService.ts",
      "src/services/orderService.ts",
      "src/services/productService.ts",
      "src/services/notificationService.ts",
    ],
    roles: { services: 4 },
    importance: 0.78,
    internal_edges: 2,
  },
  {
    name: "models",
    files: [
      "src/models/User.ts",
      "src/models/Order.ts",
      "src/models/Product.ts",
    ],
    roles: { models: 3 },
    importance: 0.65,
    internal_edges: 0,
  },
  {
    name: "database",
    files: ["src/database/postgres.ts", "src/database/redis.ts"],
    roles: { database: 2 },
    importance: 0.55,
    internal_edges: 0,
  },
  {
    name: "utils",
    files: ["src/utils/hash.ts", "src/utils/jwt.ts"],
    roles: { utils: 2 },
    importance: 0.35,
    internal_edges: 0,
  },
  {
    name: "components",
    files: ["src/components/Button.tsx", "src/components/Form.tsx"],
    roles: { component: 2 },
    importance: 0.4,
    internal_edges: 1,
  },
];

export function mockVizResponse(type: string) {
  switch (type) {
    case "dependencies": {
      // Realistic architectural module hierarchy.
      // Mock is now deterministic (no Math.random) and exposes BOTH
      // file-level graph data AND the module-level aggregate the
      // two-stage DependencyGraph component reads.
      const fileToModule = (filePath: string): string => {
        const m = modulesConfig.find((mm) => mm.files.includes(filePath));
        return m ? m.name : "components";
      };

      const modules = modulesConfig.map((mm) => ({
        name: mm.name,
        file_count: mm.files.length,
        files: mm.files,
        languages: { typescript: mm.files.length },
        roles: mm.roles,
        importance: mm.importance,
        internal_edges: mm.internal_edges,
      }));

      // Flatten every module's files into file-level nodes
      const nodes = modulesConfig.flatMap((mm) =>
        mm.files.map((f) => ({
          id: f,
          label: f.split("/").pop() || f,
          type: Object.keys(mm.roles)[0] || "file",
        })),
      );
      // Entry-point / cross-cutting files outside any module
      nodes.push(
        { id: "src/index.ts", label: "index.ts", type: "file" },
        { id: "src/app.ts", label: "app.ts", type: "file" },
      );

      // Hand-authored file-level edges — believable dependency flow
      const edges = [
        // app bootstrap
        { source: "src/index.ts", target: "src/app.ts" },
        { source: "src/app.ts", target: "src/routes/auth.routes.ts" },
        { source: "src/app.ts", target: "src/routes/api.routes.ts" },
        { source: "src/app.ts", target: "src/routes/web.routes.ts" },
        // routes → services
        {
          source: "src/routes/auth.routes.ts",
          target: "src/services/userService.ts",
        },
        {
          source: "src/routes/auth.routes.ts",
          target: "src/services/notificationService.ts",
        },
        {
          source: "src/routes/api.routes.ts",
          target: "src/services/orderService.ts",
        },
        {
          source: "src/routes/api.routes.ts",
          target: "src/services/productService.ts",
        },
        {
          source: "src/routes/web.routes.ts",
          target: "src/services/productService.ts",
        },
        // routes → utils
        { source: "src/routes/auth.routes.ts", target: "src/utils/jwt.ts" },
        // services → models
        { source: "src/services/userService.ts", target: "src/models/User.ts" },
        {
          source: "src/services/userService.ts",
          target: "src/models/Order.ts",
        },
        {
          source: "src/services/orderService.ts",
          target: "src/models/Order.ts",
        },
        {
          source: "src/services/orderService.ts",
          target: "src/models/User.ts",
        },
        {
          source: "src/services/productService.ts",
          target: "src/models/Product.ts",
        },
        // services → utils
        { source: "src/services/userService.ts", target: "src/utils/hash.ts" },
        {
          source: "src/services/notificationService.ts",
          target: "src/utils/jwt.ts",
        },
        // models → database
        { source: "src/models/User.ts", target: "src/database/postgres.ts" },
        { source: "src/models/Order.ts", target: "src/database/postgres.ts" },
        { source: "src/models/Product.ts", target: "src/database/redis.ts" },
        // components → utils
        {
          source: "src/components/Form.tsx",
          target: "src/components/Button.tsx",
        },
        { source: "src/components/Form.tsx", target: "src/utils/hash.ts" },
      ];

      // Aggregate file-level edges into module-level edges with weights
      const moduleEdgeMap = new Map<string, number>();
      for (const e of edges) {
        const ms = fileToModule(e.source);
        const mt = fileToModule(e.target);
        if (ms === mt) continue;
        const key = `${ms}|${mt}`;
        moduleEdgeMap.set(key, (moduleEdgeMap.get(key) || 0) + 1);
      }
      const moduleEdges = Array.from(moduleEdgeMap.entries()).map(
        ([k, weight]) => {
          const [source, target] = k.split("|");
          return { source, target, weight };
        },
      );

      // Compute in/out weights from the aggregated edges
      const inWeight = new Map<string, number>();
      const outWeight = new Map<string, number>();
      for (const me of moduleEdges) {
        outWeight.set(me.source, (outWeight.get(me.source) || 0) + me.weight);
        inWeight.set(me.target, (inWeight.get(me.target) || 0) + me.weight);
      }

      const moduleGraph = {
        nodes: modules.map((m) => ({
          id: m.name,
          label: m.name,
          group: m.name,
          file_count: m.file_count,
          importance: m.importance,
          in_weight: inWeight.get(m.name) || 0,
          out_weight: outWeight.get(m.name) || 0,
          primary_language: "typescript",
          size: 0,
        })),
        edges: moduleEdges,
      };

      return {
        nodes,
        edges,
        modules,
        module_graph: moduleGraph,
      };
    }

    case "complexity": {
      // Deterministic so the layout is stable between regenerates — a treemap
      // that reshuffles on every click is impossible to compare against.
      const pseudo = (seed: number, span: number, floor: number) =>
        Math.floor(
          ((((Math.sin(seed * 12.9898) * 43758.5453) % 1) + 1) / 2) * span,
        ) + floor;

      /**
       * `measured: false` mimics a language with no tree-sitter parser: the
       * backend omits `complexity` entirely rather than sending 0, so the
       * treemap greys those tiles instead of painting them cold. Keep at least
       * one such directory here — it is the only way the "Not measured" legend
       * key and neutral fill get exercised in the dev mock.
       */
      const dir = (
        path: string,
        count: number,
        ext: string,
        role: string,
        span: number,
        floor: number,
        seedBase: number,
        opts: { language?: string; cxSpan?: number; measured?: boolean } = {},
      ) => ({
        name: path.split("/").pop()!,
        path,
        children: Array.from({ length: count }, (_, i) => {
          const size = pseudo(seedBase + i, span, floor);
          const measured = opts.measured !== false;
          return {
            name: `${role}${i}${ext}`,
            // Full path — the whole point of T3a. Duplicate basenames across
            // directories must stay distinguishable in the tooltip.
            path: `${path}/${role}${i}${ext}`,
            // Area is bytes; color is complexity. The two are deliberately
            // uncorrelated here so a big-but-simple tile is visibly distinct
            // from a small-but-hot one.
            value: size,
            loc: Math.max(1, Math.round(size / 34)),
            ...(measured
              ? {
                  complexity: pseudo(
                    seedBase * 7 + i * 3,
                    opts.cxSpan ?? 40,
                    1,
                  ),
                  complexity_source: "cyclomatic",
                }
              : { complexity_source: "size_fallback" }),
            language:
              opts.language ??
              (ext.includes("ts") ? "TypeScript" : "JavaScript"),
            role,
            importance: Number((pseudo(seedBase + i, 90, 5) / 100).toFixed(2)),
          };
        }),
      });

      return {
        name: "codekavi",
        path: "",
        children: [
          {
            name: "src",
            path: "src",
            children: [
              dir("src/components", 15, ".tsx", "Component", 400, 50, 1, {
                cxSpan: 60,
              }),
              dir("src/services", 10, ".ts", "Service", 300, 100, 2, {
                cxSpan: 45,
              }),
              dir("src/utils", 8, ".ts", "util", 150, 20, 3, { cxSpan: 12 }),
            ],
          },
          dir("tests", 20, ".spec.ts", "test", 200, 50, 4, { cxSpan: 20 }),
          dir("cmd", 5, ".go", "worker", 350, 80, 5, {
            language: "Go",
            measured: false,
          }),
        ],
        meta: {
          total: 76,
          shown: 58,
          truncated: true,
          metric: "size",
          metric_label: "File size (bytes)",
          color_metric: "cyclomatic",
          color_metric_label: "Cyclomatic complexity",
          measured: 53,
        },
      };
    }

    case "architecture":
      // Stress testing architecture auto-fit by adding many nodes to services layer
      return {
        nodes: [
          // Routes layer
          { id: "routes_auth", label: "auth.routes.ts", type: "routes" },
          { id: "routes_api", label: "api.routes.ts", type: "routes" },
          { id: "routes_web", label: "web.routes.ts", type: "routes" },
          // Services layer (tall column)
          ...Array.from({ length: 12 }, (_, i) => ({
            id: `svc_${i}`,
            label: `domain${i}Service.ts`,
            type: "services",
          })),
          // Models layer
          { id: "model_user", label: "User.ts", type: "models" },
          { id: "model_order", label: "Order.ts", type: "models" },
          { id: "model_product", label: "Product.ts", type: "models" },
          // Database layer
          { id: "db_pg", label: "postgres.ts", type: "database" },
          { id: "db_redis", label: "redis.ts", type: "database" },
          { id: "db_mongo", label: "mongo.ts", type: "database" },
          // Utils layer
          { id: "util_hash", label: "hash.ts", type: "utils" },
          { id: "util_jwt", label: "jwt.ts", type: "utils" },
          // Config layer
          { id: "cfg_env", label: "env.config.ts", type: "config" },
        ],
        edges: [
          { source: "routes_auth", target: "svc_0" },
          { source: "routes_auth", target: "svc_1" },
          { source: "routes_api", target: "svc_5" },
          { source: "routes_web", target: "svc_10" },
          { source: "svc_0", target: "model_user" },
          { source: "svc_5", target: "model_product" },
          { source: "svc_10", target: "model_order" },
          { source: "model_user", target: "db_pg" },
          { source: "model_order", target: "db_pg" },
          { source: "model_product", target: "db_mongo" },
          { source: "svc_1", target: "db_redis" },
          { source: "db_pg", target: "cfg_env" },
          { source: "db_redis", target: "cfg_env" },
          { source: "db_mongo", target: "cfg_env" },
        ],
      };

    case "dataflow":
      // DataFlowGraph renders SEMANTIC STAGES, not files. It needs three
      // backend-supplied fields the previous mock predated:
      //   type  — io | process | transform | data_store  (drives node color)
      //   tier  — integer column index, left to right    (drives layout)
      //   shape — rounded_rect | cylinder | parallelogram | hexagon
      // Without `tier` every node lands in column 0 and the diagram collapses
      // into one unreadable vertical stack; without a known `type` the legend
      // renders nothing and every node falls back to grey.
      //
      // This fixture exercises all four shapes, all four edge transports, a
      // tall middleware column, an animated edge, and the click popover fields.
      return {
        nodes: [
          {
            id: "req",
            label: "HTTP Request",
            type: "io",
            shape: "parallelogram",
            tier: 0,
            description: "Inbound client request entering the API surface.",
            source_files: ["src/routes/index.ts"],
          },
          {
            id: "gw",
            label: "API Gateway",
            type: "process",
            shape: "hexagon",
            tier: 1,
            description: "Routes and rate-limits inbound traffic.",
            source_files: ["src/routes/api.routes.ts"],
          },
          // Tall column — exercises dynamic height and vertical centering
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `mw_${i}`,
            label: `Middleware ${i}`,
            type: "transform",
            shape: "rounded_rect",
            tier: 2,
            description: `Transform stage ${i} in the middleware chain.`,
            source_files: [`src/middleware/mw${i}.ts`],
          })),
          {
            id: "ctrl",
            label: "Controller",
            type: "process",
            shape: "rounded_rect",
            tier: 3,
            description: "Dispatches to domain services.",
            source_files: ["src/routes/auth.routes.ts"],
          },
          {
            id: "svc",
            label: "Order Service",
            type: "process",
            shape: "rounded_rect",
            tier: 4,
            description: "Core domain logic for orders.",
            source_files: ["src/services/OrderService.ts"],
          },
          {
            id: "cache",
            label: "Redis Cache",
            type: "data_store",
            shape: "cylinder",
            tier: 5,
            description: "Read-through cache for hot order lookups.",
            source_files: ["src/services/cache.ts"],
          },
          {
            id: "db",
            label: "Postgres",
            type: "data_store",
            shape: "cylinder",
            tier: 5,
            description: "System of record.",
            source_files: ["src/db/postgres.ts"],
          },
          {
            id: "res",
            label: "HTTP Response",
            type: "io",
            shape: "parallelogram",
            tier: 6,
            description: "Serialized response returned to the client.",
            source_files: ["src/routes/index.ts"],
          },
        ],
        edges: [
          {
            source: "req",
            target: "gw",
            data_type: "http",
            label: "JSON",
            animated: true,
          },
          ...Array.from({ length: 6 }, (_, i) => ({
            source: "gw",
            target: `mw_${i}`,
            data_type: "internal",
          })),
          ...Array.from({ length: 6 }, (_, i) => ({
            source: `mw_${i}`,
            target: "ctrl",
            data_type: "internal",
          })),
          {
            source: "ctrl",
            target: "svc",
            data_type: "event",
            label: "dispatch",
          },
          { source: "svc", target: "cache", data_type: "db", label: "get" },
          { source: "svc", target: "db", data_type: "db", label: "query" },
          { source: "db", target: "res", data_type: "http", animated: true },
        ],
      };

    case "mindmap": {
      // Shape must match the backend exactly: visualize.py returns
      // {"data": {"root": root}}, and isEmptyVisualization requires
      // data.root.children. Returning the root bare (as this mock used to)
      // makes every mind map report "No Data Available".
      //
      // Structure mirrors _build_static_mindmap: root -> role group -> files,
      // with each file node carrying `id` set to the BARE FILENAME, exactly as
      // the backend does (visualize.py:437).
      const role = (name: string, files: string[]) => ({
        name,
        id: name,
        label: name,
        children: files.map((f) => ({ name: f, id: f, label: f })),
      });

      return {
        root: {
          name: "Codebase",
          id: "root",
          label: "Codebase",
          children: [
            // `index.ts` appears under three roles and `utils.ts` under two.
            // That is a regression fixture, not filler: the bare-filename id
            // is what collides in RadialMindmap's D3 join key, so these
            // duplicates reproduce B1 (nodes merging/vanishing on expand).
            // T5 is not verified until every one of these stays on screen.
            role("Routes", ["auth.routes.ts", "api.routes.ts", "index.ts"]),
            role("Models", ["User.ts", "Order.ts", "index.ts"]),
            role("Services", ["OrderService.ts", "utils.ts", "index.ts"]),
            role("Utilities", ["format.ts", "utils.ts", "constants.ts"]),
            role("Tests", ["auth.spec.ts", "order.spec.ts"]),
          ],
        },
      };
    }

    case "neural_network":
      // Re-use the NN data from mockAnalyzeResponse
      const nn_models = mockAnalyzeResponse().nn_models;
      return {
        models: nn_models,
        count: nn_models.length,
      };

    default:
      return {};
  }
}

export function mockExplanationResponse(type: string) {
  return `This is an updated mock AI explanation for the **${type}** visualization, generated to stress-test the new dynamic resizing and auto-fit capabilities. You should see a large amount of data gracefully fitting into the container.`;
}

export function mockAnalyzeResponse(): any {
  return {
    success: true,
    repo_id: "dev-mock-repo",
    repo_name: "Mock Neural Network Repo",
    owner: "Rune",
    github_url: "mock://nn",
    total_files: 10,
    total_size: 1024,
    total_size_formatted: "1 KB",
    languages: { python: 10 },
    tree: [],
    files: [],
    file_profiles: [],
    role_summary: { ml_model: 1 } as any,
    graph: {
      nodes: [],
      edges: [],
      metadata: {
        total_nodes: 0,
        total_edges: 0,
        connected_nodes: 0,
        groups: [],
      },
    },
    module_graph: {
      modules: [],
      connections: [],
      graph_json: { nodes: [], edges: [] },
      mermaid: "",
    },
    cycles: { has_cycles: false, cycle_count: 0, cycles: [], summary: "" },
    mermaid: { file_level: "", module_level: "" },
    nn_models: [
      {
        // Real `extract_models_from_source` output for an equivalent PyTorch
        // model, not hand-written numbers — regenerated 2026-08-14 against the
        // isometric-figure geometry rewrite (constant depth lip, wider
        // height/width ranges, `feature_width` on every layer). Keeping it
        // authentic is the point: the dev mock shows the same figure a real
        // repo does.
        name: "ResNetSmall",
        file: "src/models/resnet.py",
        line: 4,
        framework: "pytorch",
        type: "class",
        total_params: 2182952,
        layers: [
          {"id": "conv1", "type": "Conv2d", "category": "convolution", "params": {"stride": 2, "in_channels": 3, "out_channels": 64, "kernel_size": 7}, "param_count": 9472, "block_dims": {"height": 96.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.5, "feature_width": 64},
          {"id": "bn1", "type": "BatchNorm2d", "category": "normalization", "params": {"num_features": 64}, "param_count": 128, "block_dims": {"height": 96.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.5, "feature_width": 64},
          {"id": "relu", "type": "ReLU", "category": "activation", "params": {}, "block_dims": {"height": 96.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.5, "feature_width": 64},
          {"id": "maxpool", "type": "MaxPool2d", "category": "pooling", "params": {"stride": 2, "kernel_size": 3}, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_0", "type": "Conv2d", "category": "convolution", "params": {"in_channels": 64, "out_channels": 64, "kernel_size": 3}, "param_count": 36928, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_1", "type": "BatchNorm2d", "category": "normalization", "params": {"num_features": 64}, "param_count": 128, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_2", "type": "ReLU", "category": "activation", "params": {}, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_3", "type": "Conv2d", "category": "convolution", "params": {"in_channels": 64, "out_channels": 64, "kernel_size": 3}, "param_count": 36928, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_4", "type": "BatchNorm2d", "category": "normalization", "params": {"num_features": 64}, "param_count": 128, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_5", "type": "ReLU", "category": "activation", "params": {}, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_6", "type": "Conv2d", "category": "convolution", "params": {"in_channels": 64, "out_channels": 64, "kernel_size": 3}, "param_count": 36928, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_7", "type": "BatchNorm2d", "category": "normalization", "params": {"num_features": 64}, "param_count": 128, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "block_8", "type": "ReLU", "category": "activation", "params": {}, "block_dims": {"height": 82.0, "depth": 14.0, "width": 30.1}, "spatial_extent": 0.25, "feature_width": 64},
          {"id": "layer2", "type": "Conv2d", "category": "convolution", "params": {"stride": 2, "in_channels": 64, "out_channels": 128, "kernel_size": 3}, "param_count": 73856, "block_dims": {"height": 68.0, "depth": 14.0, "width": 34.0}, "spatial_extent": 0.125, "feature_width": 128},
          {"id": "layer3", "type": "Conv2d", "category": "convolution", "params": {"stride": 2, "in_channels": 128, "out_channels": 256, "kernel_size": 3}, "param_count": 295168, "block_dims": {"height": 54.0, "depth": 14.0, "width": 38.0}, "spatial_extent": 0.0625, "feature_width": 256},
          {"id": "layer4", "type": "Conv2d", "category": "convolution", "params": {"stride": 2, "in_channels": 256, "out_channels": 512, "kernel_size": 3}, "param_count": 1180160, "block_dims": {"height": 40.0, "depth": 14.0, "width": 42.0}, "spatial_extent": 0.03125, "feature_width": 512},
          {"id": "avgpool", "type": "AdaptiveAvgPool2d", "category": "pooling", "params": {}, "block_dims": {"height": 26.0, "depth": 14.0, "width": 42.0}, "spatial_extent": 0.015625, "feature_width": 512},
          {"id": "fc", "type": "Linear", "category": "dense", "params": {"in_features": 512, "out_features": 1000}, "param_count": 513000, "block_dims": {"height": 36.0, "depth": 14.0, "width": 6.0}, "feature_width": 1000},
        ],
        connections: [
          {"from_id": "input", "to_id": "conv1", "type": "sequential-unverified"},
          {"from_id": "conv1", "to_id": "bn1", "type": "sequential-unverified"},
          {"from_id": "bn1", "to_id": "relu", "type": "sequential-unverified"},
          {"from_id": "relu", "to_id": "maxpool", "type": "sequential-unverified"},
          {"from_id": "maxpool", "to_id": "block_0", "type": "sequential-unverified"},
          {"from_id": "block_0", "to_id": "block_1", "type": "sequential-unverified"},
          {"from_id": "block_1", "to_id": "block_2", "type": "sequential-unverified"},
          {"from_id": "block_2", "to_id": "block_3", "type": "sequential-unverified"},
          {"from_id": "block_3", "to_id": "block_4", "type": "sequential-unverified"},
          {"from_id": "block_4", "to_id": "block_5", "type": "sequential-unverified"},
          {"from_id": "block_5", "to_id": "block_6", "type": "sequential-unverified"},
          {"from_id": "block_6", "to_id": "block_7", "type": "sequential-unverified"},
          {"from_id": "block_7", "to_id": "block_8", "type": "sequential-unverified"},
          {"from_id": "block_8", "to_id": "layer2", "type": "sequential-unverified"},
          {"from_id": "layer2", "to_id": "layer3", "type": "sequential-unverified"},
          {"from_id": "layer3", "to_id": "layer4", "type": "sequential-unverified"},
          {"from_id": "layer4", "to_id": "avgpool", "type": "sequential-unverified"},
          {"from_id": "avgpool", "to_id": "fc", "type": "sequential-unverified"},
          {"from_id": "fc", "to_id": "output", "type": "sequential-unverified"},
          // Synthetic, as before: the extractor does not yet trace
          // `x = x + identity` in forward(), and the UI needs a residual to
          // exercise the merge glyph.
          {"from_id": "maxpool", "to_id": "layer2", "type": "skip", "label": "residual"},
        ],
        repeats: [{"start": 4, "length": 3, "count": 3, "label": "Conv2d + BatchNorm2d + ReLU block", "param_count": 37056}],
      },
      {
        // Also real `extract_models_from_source` output, run against a
        // BERT-shaped encoder (`MultiheadAttention` + `LayerNorm` + MLP,
        // repeated 4x) so the dev mock exercises the detail-panel callout
        // (D3) the way the isometric-transformer mockup draws it — the main
        // figure has nothing else to click open otherwise.
        name: "MiniBertEncoder",
        file: "src/models/transformer.py",
        line: 4,
        framework: "pytorch",
        type: "class",
        total_params: 52386050,
        layers: [
          {"id": "embeddings", "type": "Embedding", "category": "embedding", "params": {"num_embeddings": 30522, "embedding_dim": 768}, "param_count": 23440896, "block_dims": {"height": 110.0, "depth": 14.0, "width": 44.3}, "spatial_extent": 1.0, "feature_width": 768},
          {"id": "embed_norm", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 110.0, "depth": 14.0, "width": 44.3}, "spatial_extent": 1.0, "feature_width": 768},
          {"id": "embed_dropout", "type": "Dropout", "category": "dropout", "params": {"p": 0.1}, "block_dims": {"height": 110.0, "depth": 14.0, "width": 44.3}, "spatial_extent": 1.0, "feature_width": 768},
          {"id": "encoder_0", "type": "MultiheadAttention", "category": "attention", "params": {"embed_dim": 768, "num_heads": 12}, "param_count": 2362368, "block_dims": {"height": 110.0, "depth": 14.0, "width": 44.3}, "spatial_extent": 1.0, "feature_width": 768},
          {"id": "encoder_1", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 110.0, "depth": 14.0, "width": 44.3}, "spatial_extent": 1.0, "feature_width": 768},
          {"id": "encoder_2", "type": "Linear", "category": "dense", "params": {"in_features": 768, "out_features": 3072}, "param_count": 2362368, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_3", "type": "GELU", "category": "activation", "params": {}, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_4", "type": "Linear", "category": "dense", "params": {"in_features": 3072, "out_features": 768}, "param_count": 2360064, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_5", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_6", "type": "MultiheadAttention", "category": "attention", "params": {"embed_dim": 768, "num_heads": 12}, "param_count": 2362368, "block_dims": {"height": 40.0, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_7", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 40.0, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_8", "type": "Linear", "category": "dense", "params": {"in_features": 768, "out_features": 3072}, "param_count": 2362368, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_9", "type": "GELU", "category": "activation", "params": {}, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_10", "type": "Linear", "category": "dense", "params": {"in_features": 3072, "out_features": 768}, "param_count": 2360064, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_11", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_12", "type": "MultiheadAttention", "category": "attention", "params": {"embed_dim": 768, "num_heads": 12}, "param_count": 2362368, "block_dims": {"height": 40.0, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_13", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 40.0, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_14", "type": "Linear", "category": "dense", "params": {"in_features": 768, "out_features": 3072}, "param_count": 2362368, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_15", "type": "GELU", "category": "activation", "params": {}, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_16", "type": "Linear", "category": "dense", "params": {"in_features": 3072, "out_features": 768}, "param_count": 2360064, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_17", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_18", "type": "MultiheadAttention", "category": "attention", "params": {"embed_dim": 768, "num_heads": 12}, "param_count": 2362368, "block_dims": {"height": 40.0, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_19", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 40.0, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_20", "type": "Linear", "category": "dense", "params": {"in_features": 768, "out_features": 3072}, "param_count": 2362368, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_21", "type": "GELU", "category": "activation", "params": {}, "block_dims": {"height": 110.0, "depth": 14.0, "width": 6.0}, "feature_width": 3072},
          {"id": "encoder_22", "type": "Linear", "category": "dense", "params": {"in_features": 3072, "out_features": 768}, "param_count": 2360064, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "encoder_23", "type": "LayerNorm", "category": "normalization", "params": {"normalized_shape": 768}, "param_count": 1536, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "pooler", "type": "Linear", "category": "dense", "params": {"in_features": 768, "out_features": 768}, "param_count": 590592, "block_dims": {"height": 106.5, "depth": 14.0, "width": 6.0}, "feature_width": 768},
          {"id": "classifier", "type": "Linear", "category": "dense", "params": {"in_features": 768, "out_features": 2}, "param_count": 1538, "block_dims": {"height": 39.3, "depth": 14.0, "width": 6.0}, "feature_width": 2},
        ],
        connections: [
          {"from_id": "input", "to_id": "embeddings", "type": "sequential-unverified"},
          {"from_id": "embeddings", "to_id": "embed_norm", "type": "sequential-unverified"},
          {"from_id": "embed_norm", "to_id": "embed_dropout", "type": "sequential-unverified"},
          {"from_id": "embed_dropout", "to_id": "encoder_0", "type": "sequential-unverified"},
          {"from_id": "encoder_0", "to_id": "encoder_1", "type": "sequential-unverified"},
          {"from_id": "encoder_1", "to_id": "encoder_2", "type": "sequential-unverified"},
          {"from_id": "encoder_2", "to_id": "encoder_3", "type": "sequential-unverified"},
          {"from_id": "encoder_3", "to_id": "encoder_4", "type": "sequential-unverified"},
          {"from_id": "encoder_4", "to_id": "encoder_5", "type": "sequential-unverified"},
          {"from_id": "encoder_5", "to_id": "encoder_6", "type": "sequential-unverified"},
          {"from_id": "encoder_6", "to_id": "encoder_7", "type": "sequential-unverified"},
          {"from_id": "encoder_7", "to_id": "encoder_8", "type": "sequential-unverified"},
          {"from_id": "encoder_8", "to_id": "encoder_9", "type": "sequential-unverified"},
          {"from_id": "encoder_9", "to_id": "encoder_10", "type": "sequential-unverified"},
          {"from_id": "encoder_10", "to_id": "encoder_11", "type": "sequential-unverified"},
          {"from_id": "encoder_11", "to_id": "encoder_12", "type": "sequential-unverified"},
          {"from_id": "encoder_12", "to_id": "encoder_13", "type": "sequential-unverified"},
          {"from_id": "encoder_13", "to_id": "encoder_14", "type": "sequential-unverified"},
          {"from_id": "encoder_14", "to_id": "encoder_15", "type": "sequential-unverified"},
          {"from_id": "encoder_15", "to_id": "encoder_16", "type": "sequential-unverified"},
          {"from_id": "encoder_16", "to_id": "encoder_17", "type": "sequential-unverified"},
          {"from_id": "encoder_17", "to_id": "encoder_18", "type": "sequential-unverified"},
          {"from_id": "encoder_18", "to_id": "encoder_19", "type": "sequential-unverified"},
          {"from_id": "encoder_19", "to_id": "encoder_20", "type": "sequential-unverified"},
          {"from_id": "encoder_20", "to_id": "encoder_21", "type": "sequential-unverified"},
          {"from_id": "encoder_21", "to_id": "encoder_22", "type": "sequential-unverified"},
          {"from_id": "encoder_22", "to_id": "encoder_23", "type": "sequential-unverified"},
          {"from_id": "encoder_23", "to_id": "pooler", "type": "sequential-unverified"},
          {"from_id": "pooler", "to_id": "classifier", "type": "sequential-unverified"},
          {"from_id": "classifier", "to_id": "output", "type": "sequential-unverified"},
          // Synthetic, same rationale as ResNetSmall's: the extractor does not
          // yet trace forward()'s `x = x + Attention(x)` / `x = x + FFN(x)`.
          // Two residuals per encoder repetition, matching the "Add & Norm"
          // pattern the transformer mockup's inner panel draws — one wrapping
          // attention, one wrapping the MLP.
          {"from_id": "embed_dropout", "to_id": "encoder_1", "type": "skip", "label": "residual"},
          {"from_id": "encoder_1", "to_id": "encoder_5", "type": "skip"},
        ],
        repeats: [{"start": 3, "length": 6, "count": 4, "label": "MultiheadAttention + LayerNorm + Linear + … block", "param_count": 7087872}],
      },
    ],
  };
}
