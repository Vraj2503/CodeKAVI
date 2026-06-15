export function mockChatResponse() {
  const responses = [
    "Here is how this works in the codebase. You can find the main logic in `src/index.ts` where it initializes the application.",
    "The data flow starts from the API layer and goes through the services. Check `src/services/api.ts` for more details.",
    "This part of the code uses a custom hook to manage state. It's a standard pattern used throughout the app.",
    "I found references to this in several places, mainly in the UI components and the utility functions.",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

export function mockVizResponse(type: string) {
  switch (type) {
    case "dependencies":
      return {
        nodes: Array.from({ length: 30 }, (_, i) => ({
          id: `node_${i}`,
          label: `Module${i}.ts`,
          type: i % 5 === 0 ? "component" : i % 3 === 0 ? "service" : "file",
        })),
        edges: Array.from({ length: 45 }, (_, i) => ({
          source: `node_${Math.floor(Math.random() * 10)}`, // hubs
          target: `node_${Math.floor(Math.random() * 20) + 10}`,
        })).concat([
          { source: "node_0", target: "node_1" },
          { source: "node_1", target: "node_2" }
        ]),
      };

    case "complexity":
      return {
        name: "root",
        children: [
          {
            name: "src",
            children: [
              {
                name: "components",
                children: Array.from({ length: 15 }, (_, i) => ({
                  name: `Component${i}.tsx`,
                  value: Math.floor(Math.random() * 400) + 50,
                })),
              },
              {
                name: "services",
                children: Array.from({ length: 10 }, (_, i) => ({
                  name: `Service${i}.ts`,
                  value: Math.floor(Math.random() * 300) + 100,
                })),
              },
              {
                name: "utils",
                children: Array.from({ length: 8 }, (_, i) => ({
                  name: `util${i}.ts`,
                  value: Math.floor(Math.random() * 150) + 20,
                })),
              },
            ],
          },
          {
            name: "tests",
            children: Array.from({ length: 20 }, (_, i) => ({
              name: `test${i}.spec.ts`,
              value: Math.floor(Math.random() * 200) + 50,
            })),
          },
        ],
      };

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

    default:
      return {};
  }
}

export function mockExplanationResponse(type: string) {
  return `This is an updated mock AI explanation for the **${type}** visualization, generated to stress-test the new dynamic resizing and auto-fit capabilities. You should see a large amount of data gracefully fitting into the container.`;
}
