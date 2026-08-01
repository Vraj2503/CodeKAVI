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
        Math.floor(((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) / 2 * span) + floor;

      const dir = (
        path: string,
        count: number,
        ext: string,
        role: string,
        span: number,
        floor: number,
        seedBase: number,
      ) => ({
        name: path.split("/").pop()!,
        path,
        children: Array.from({ length: count }, (_, i) => ({
          name: `${role}${i}${ext}`,
          // Full path — the whole point of T3a. Duplicate basenames across
          // directories must stay distinguishable in the tooltip.
          path: `${path}/${role}${i}${ext}`,
          value: pseudo(seedBase + i, span, floor),
          language: ext.includes("ts") ? "TypeScript" : "JavaScript",
          role,
          importance: Number((pseudo(seedBase + i, 90, 5) / 100).toFixed(2)),
        })),
      });

      return {
        name: "codekavi",
        path: "",
        children: [
          {
            name: "src",
            path: "src",
            children: [
              dir("src/components", 15, ".tsx", "Component", 400, 50, 1),
              dir("src/services", 10, ".ts", "Service", 300, 100, 2),
              dir("src/utils", 8, ".ts", "util", 150, 20, 3),
            ],
          },
          dir("tests", 20, ".spec.ts", "test", 200, 50, 4),
        ],
        meta: {
          total: 71,
          shown: 53,
          truncated: true,
          metric: "size",
          metric_label: "File size (bytes)",
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
      // Stress testing dataflow graph with deep pipeline and one very tall column
      return {
        nodes: [
          { id: "req", label: "Request", type: "entry_point" },
          { id: "gw", label: "Gateway", type: "routes" },
          // Middleware layer - tall column to test dynamic height
          ...Array.from({ length: 8 }, (_, i) => ({
            id: `mw_${i}`,
            label: `Middleware ${i}`,
            type: "utils",
          })),
          { id: "ctrl", label: "Controller", type: "routes" },
          { id: "svc", label: "Service", type: "services" },
          { id: "cache", label: "Cache", type: "database" },
          { id: "db", label: "Database", type: "database" },
          { id: "res", label: "Response", type: "other" },
        ],
        edges: [
          { source: "req", target: "gw" },
          ...Array.from({ length: 8 }, (_, i) => ({
            source: "gw",
            target: `mw_${i}`,
          })),
          ...Array.from({ length: 8 }, (_, i) => ({
            source: `mw_${i}`,
            target: "ctrl",
          })),
          { source: "ctrl", target: "svc" },
          { source: "svc", target: "cache" },
          { source: "cache", target: "db" },
          { source: "db", target: "res" },
        ],
      };

    case "mindmap":
      // Stress testing mindmap with lots of initial children and deep nesting
      return {
        id: "root",
        label: "Enterprise System",
        children: Array.from({ length: 8 }, (_, i) => ({
          id: `domain_${i}`,
          label: `Domain ${i}`,
          children: Array.from({ length: 5 }, (_, j) => ({
            id: `sub_${i}_${j}`,
            label: `Subsystem ${j}`,
            children: Array.from({ length: 3 }, (_, k) => ({
              id: `leaf_${i}_${j}_${k}`,
              label: `Component ${k}`,
            })),
          })),
        })),
      };

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
    owner: "CodeKavi",
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
        name: "ResNet50_Mock",
        file: "src/models/resnet.py",
        line: 15,
        framework: "pytorch",
        type: "class",
        total_params: 25600000,
        input_shape: [3, 224, 224],
        output_shape: [1000],
        layers: [
          {
            id: "conv1",
            type: "Conv2d",
            category: "convolution",
            params: {
              in_channels: 3,
              out_channels: 64,
              kernel_size: 7,
              stride: 2,
              padding: 3,
            },
            output_shape: [64, 112, 112],
            param_count: 9408,
            activation: "ReLU",
            block_dims: { width: 10, height: 10, depth: 8, x: 0, y: 0, z: 0 },
          },
          {
            id: "bn1",
            type: "BatchNorm2d",
            category: "normalization",
            params: { num_features: 64 },
            output_shape: [64, 112, 112],
            param_count: 128,
            block_dims: { width: 4, height: 10, depth: 8, x: 0, y: 0, z: 0 },
          },
          {
            id: "pool1",
            type: "MaxPool2d",
            category: "pooling",
            params: { kernel_size: 3, stride: 2, padding: 1 },
            output_shape: [64, 56, 56],
            param_count: 0,
            block_dims: { width: 6, height: 6, depth: 8, x: 0, y: 0, z: 0 },
          },
          {
            id: "layer1_conv",
            type: "Conv2d",
            category: "convolution",
            params: {
              in_channels: 64,
              out_channels: 256,
              kernel_size: 3,
              stride: 1,
              padding: 1,
            },
            output_shape: [256, 56, 56],
            param_count: 147456,
            activation: "ReLU",
            block_dims: { width: 6, height: 6, depth: 15, x: 0, y: 0, z: 0 },
          },
          {
            id: "fc",
            type: "Linear",
            category: "dense",
            params: { in_features: 256, out_features: 1000 },
            output_shape: [1000],
            param_count: 257000,
            activation: "Softmax",
            block_dims: { width: 2, height: 20, depth: 2, x: 0, y: 0, z: 0 },
          },
        ],
        connections: [
          { from_id: "conv1", to_id: "bn1", type: "sequential" },
          { from_id: "bn1", to_id: "pool1", type: "sequential" },
          { from_id: "pool1", to_id: "layer1_conv", type: "sequential" },
          { from_id: "layer1_conv", to_id: "fc", type: "sequential" },
          // Mock skip connection to test UI
          { from_id: "pool1", to_id: "fc", type: "skip", label: "Residual" },
        ],
        blocks: [
          { name: "Stem", layers: ["conv1", "bn1", "pool1"], has_skip: false },
          { name: "ResBlock1", layers: ["layer1_conv", "fc"], has_skip: true },
        ],
      },
    ],
  };
}
