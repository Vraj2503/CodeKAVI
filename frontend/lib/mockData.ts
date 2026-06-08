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
        nodes: [
          { id: "index", label: "index.ts", type: "file" },
          { id: "app", label: "App.tsx", type: "component" },
          { id: "router", label: "router.ts", type: "file" },
          { id: "auth_hook", label: "useAuth.ts", type: "function" },
          { id: "api_client", label: "apiClient.ts", type: "file" },
          { id: "dashboard", label: "Dashboard.tsx", type: "component" },
          { id: "settings", label: "Settings.tsx", type: "component" },
          { id: "user_service", label: "userService.ts", type: "file" },
          { id: "utils", label: "utils.ts", type: "file" },
          { id: "constants", label: "constants.ts", type: "file" },
          { id: "types", label: "types.ts", type: "file" },
          { id: "logger", label: "logger.ts", type: "file" },
          { id: "db_client", label: "dbClient.ts", type: "external" },
          { id: "config", label: "config.ts", type: "file" },
          { id: "middleware", label: "middleware.ts", type: "file" },
        ],
        edges: [
          { source: "index", target: "app" },
          { source: "index", target: "config" },
          { source: "app", target: "router" },
          { source: "app", target: "auth_hook" },
          { source: "router", target: "dashboard" },
          { source: "router", target: "settings" },
          { source: "dashboard", target: "api_client" },
          { source: "dashboard", target: "utils" },
          { source: "settings", target: "api_client" },
          { source: "settings", target: "auth_hook" },
          { source: "api_client", target: "user_service" },
          { source: "api_client", target: "constants" },
          { source: "api_client", target: "types" },
          { source: "api_client", target: "middleware" },
          { source: "user_service", target: "db_client" },
          { source: "user_service", target: "logger" },
          { source: "user_service", target: "types" },
          { source: "middleware", target: "logger" },
          { source: "middleware", target: "auth_hook" },
          { source: "config", target: "constants" },
          { source: "utils", target: "types" },
        ],
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
                children: [
                  { name: "Dashboard.tsx", value: 420 },
                  { name: "Settings.tsx", value: 310 },
                  { name: "Navbar.tsx", value: 180 },
                  { name: "Sidebar.tsx", value: 150 },
                  { name: "Modal.tsx", value: 95 },
                  { name: "Table.tsx", value: 260 },
                  { name: "Chart.tsx", value: 340 },
                ],
              },
              {
                name: "services",
                children: [
                  { name: "userService.ts", value: 380 },
                  { name: "authService.ts", value: 290 },
                  { name: "apiClient.ts", value: 250 },
                  { name: "cacheService.ts", value: 170 },
                ],
              },
              {
                name: "hooks",
                children: [
                  { name: "useAuth.ts", value: 220 },
                  { name: "useQuery.ts", value: 190 },
                  { name: "useWebSocket.ts", value: 310 },
                ],
              },
              {
                name: "utils",
                children: [
                  { name: "helpers.ts", value: 140 },
                  { name: "validators.ts", value: 210 },
                  { name: "formatters.ts", value: 90 },
                ],
              },
              { name: "index.ts", value: 80 },
              { name: "config.ts", value: 60 },
            ],
          },
          {
            name: "tests",
            children: [
              { name: "auth.test.ts", value: 200 },
              { name: "api.test.ts", value: 280 },
              { name: "utils.test.ts", value: 120 },
            ],
          },
        ],
      };

    case "architecture":
      return {
        nodes: [
          { id: "routes_auth", label: "auth.routes.ts", type: "routes" },
          { id: "routes_user", label: "user.routes.ts", type: "routes" },
          { id: "routes_data", label: "data.routes.ts", type: "routes" },
          { id: "svc_auth", label: "authService.ts", type: "services" },
          { id: "svc_user", label: "userService.ts", type: "services" },
          { id: "svc_data", label: "dataService.ts", type: "services" },
          { id: "svc_cache", label: "cacheService.ts", type: "services" },
          { id: "model_user", label: "User.ts", type: "models" },
          { id: "model_post", label: "Post.ts", type: "models" },
          { id: "model_session", label: "Session.ts", type: "models" },
          { id: "db_pg", label: "postgres.ts", type: "database" },
          { id: "db_redis", label: "redis.ts", type: "database" },
          { id: "util_hash", label: "hash.ts", type: "utils" },
          { id: "util_jwt", label: "jwt.ts", type: "utils" },
          { id: "util_validate", label: "validate.ts", type: "utils" },
          { id: "cfg_env", label: "env.config.ts", type: "config" },
          { id: "cfg_db", label: "db.config.ts", type: "config" },
        ],
        edges: [
          { source: "routes_auth", target: "svc_auth" },
          { source: "routes_user", target: "svc_user" },
          { source: "routes_data", target: "svc_data" },
          { source: "svc_auth", target: "model_user" },
          { source: "svc_auth", target: "model_session" },
          { source: "svc_auth", target: "util_hash" },
          { source: "svc_auth", target: "util_jwt" },
          { source: "svc_user", target: "model_user" },
          { source: "svc_user", target: "util_validate" },
          { source: "svc_data", target: "model_post" },
          { source: "svc_data", target: "svc_cache" },
          { source: "svc_cache", target: "db_redis" },
          { source: "model_user", target: "db_pg" },
          { source: "model_post", target: "db_pg" },
          { source: "model_session", target: "db_redis" },
          { source: "db_pg", target: "cfg_db" },
          { source: "db_redis", target: "cfg_db" },
          { source: "cfg_db", target: "cfg_env" },
        ],
      };

    case "dataflow":
      return {
        nodes: [
          { id: "user_req", label: "HTTP Request", type: "entry_point" },
          { id: "middleware", label: "Auth Middleware", type: "routes" },
          { id: "rate_limit", label: "Rate Limiter", type: "routes" },
          { id: "controller", label: "Route Controller", type: "routes" },
          { id: "validator", label: "Input Validator", type: "utils" },
          { id: "service", label: "Business Logic", type: "services" },
          { id: "cache_check", label: "Cache Lookup", type: "services" },
          { id: "db_query", label: "DB Query", type: "database" },
          { id: "transform", label: "Data Transform", type: "services" },
          { id: "serialize", label: "Response Serializer", type: "utils" },
          { id: "response", label: "HTTP Response", type: "other" },
          { id: "logger", label: "Audit Logger", type: "utils" },
        ],
        edges: [
          { source: "user_req", target: "rate_limit" },
          { source: "rate_limit", target: "middleware" },
          { source: "middleware", target: "controller" },
          { source: "controller", target: "validator" },
          { source: "validator", target: "service" },
          { source: "service", target: "cache_check" },
          { source: "cache_check", target: "db_query" },
          { source: "db_query", target: "transform" },
          { source: "transform", target: "serialize" },
          { source: "serialize", target: "response" },
          { source: "controller", target: "logger" },
          { source: "service", target: "logger" },
        ],
      };

    case "mindmap":
      return {
        id: "root",
        label: "CodeKavi Project",
        children: [
          {
            id: "frontend",
            label: "Frontend",
            children: [
              {
                id: "components",
                label: "Components",
                children: [
                  { id: "layout", label: "Layout" },
                  { id: "forms", label: "Forms" },
                  { id: "charts", label: "Charts" },
                  { id: "modals", label: "Modals" },
                  { id: "tables", label: "Tables" },
                ],
              },
              {
                id: "pages",
                label: "Pages",
                children: [
                  { id: "dashboard_page", label: "Dashboard" },
                  { id: "settings_page", label: "Settings" },
                  { id: "profile_page", label: "Profile" },
                  { id: "analytics_page", label: "Analytics" },
                ],
              },
              {
                id: "hooks",
                label: "Hooks",
                children: [
                  { id: "use_auth", label: "useAuth" },
                  { id: "use_query", label: "useQuery" },
                  { id: "use_theme", label: "useTheme" },
                ],
              },
              {
                id: "state",
                label: "State Management",
                children: [
                  { id: "store", label: "Store" },
                  { id: "slices", label: "Slices" },
                  { id: "selectors", label: "Selectors" },
                ],
              },
            ],
          },
          {
            id: "backend",
            label: "Backend",
            children: [
              {
                id: "api_layer",
                label: "API Layer",
                children: [
                  { id: "rest_routes", label: "REST Routes" },
                  { id: "graphql_schema", label: "GraphQL Schema" },
                  { id: "websocket", label: "WebSocket Handler" },
                ],
              },
              {
                id: "services",
                label: "Services",
                children: [
                  { id: "auth_svc", label: "Auth Service" },
                  { id: "user_svc", label: "User Service" },
                  { id: "data_svc", label: "Data Service" },
                  { id: "notification_svc", label: "Notification Service" },
                ],
              },
              {
                id: "data_layer",
                label: "Data Layer",
                children: [
                  { id: "orm_models", label: "ORM Models" },
                  { id: "migrations", label: "Migrations" },
                  { id: "seeds", label: "Seeds" },
                ],
              },
            ],
          },
          {
            id: "shared",
            label: "Shared",
            children: [
              { id: "types_shared", label: "Types" },
              { id: "constants_shared", label: "Constants" },
              { id: "validators_shared", label: "Validators" },
              { id: "helpers_shared", label: "Helpers" },
            ],
          },
          {
            id: "infra",
            label: "Infrastructure",
            children: [
              { id: "docker", label: "Docker" },
              { id: "ci_cd", label: "CI/CD" },
              { id: "monitoring", label: "Monitoring" },
            ],
          },
        ],
      };

    default:
      return {};
  }
}

export function mockExplanationResponse(type: string) {
  const responses: Record<string, string> = {
    dependencies:
      "This dependency graph reveals a **well-structured layered architecture**. The entry point `index.ts` flows through `App.tsx` and the router into page-level components. The `apiClient.ts` acts as a central **dependency hub** with 4 outgoing connections — it mediates all communication between the UI layer and the service layer. Notable patterns:\n\n- **Clean separation**: UI components don't directly access database clients\n- **Shared utilities**: `types.ts` is referenced by 3 modules, making it a potential **change amplifier**\n- **Middleware pattern**: Auth is injected via `middleware.ts` rather than duplicated across routes",

    complexity:
      "The complexity treemap highlights **Dashboard.tsx** (420) and **userService.ts** (380) as the two highest-complexity files — these are strong candidates for refactoring. Key observations:\n\n- **Components cluster**: 7 UI components with an average complexity of 250 — the `Chart.tsx` (340) and `Table.tsx` (260) are the most complex, likely containing significant rendering logic\n- **Service layer**: Business logic is concentrated in 4 service files averaging 272 complexity\n- **Test coverage gap**: Test files are relatively low complexity (avg 200), suggesting they may not cover the more complex code paths in services",

    architecture:
      "The architecture follows a **classic 4-tier pattern**: Routes → Services → Models → Database. Key architectural insights:\n\n- **Service fan-out**: `authService.ts` connects to 4 downstream modules (2 models + 2 utils), making it the most interconnected service\n- **Dual data stores**: The system uses both PostgreSQL (primary) and Redis (caching/sessions), with `cacheService.ts` abstracting the Redis layer\n- **Configuration cascade**: Database configs depend on environment config, following the 12-factor app principle\n- **Utility isolation**: `hash.ts`, `jwt.ts`, and `validate.ts` are stateless utilities with no downstream dependencies",

    dataflow:
      "The data flow reveals a **10-stage request pipeline** from HTTP Request to HTTP Response. Critical path analysis:\n\n- **Security layers**: Requests pass through Rate Limiter → Auth Middleware before reaching business logic (defense in depth)\n- **Cache-first strategy**: The service checks cache before hitting the database, reducing DB load\n- **Audit trail**: Both the Controller and Service emit to the Audit Logger, providing two levels of logging granularity\n- **Linear flow**: The pipeline is mostly linear with 2 fan-out points (controller → logger, service → logger), making it easy to trace and debug",

    mindmap:
      "This radial mind map reveals the **full project topology** across 4 major domains with 40+ modules:\n\n- **Frontend** (largest cluster): 4 sub-categories including Components (5 types), Pages (4 routes), Hooks (3 custom hooks), and State Management (store pattern)\n- **Backend**: Follows clean architecture with separate API, Service, and Data layers. The API layer supports REST, GraphQL, and WebSocket — a multi-protocol approach\n- **Shared**: Cross-cutting concerns (types, constants, validators, helpers) are isolated in a shared module — good for monorepo consistency\n- **Infrastructure**: DevOps concerns (Docker, CI/CD, Monitoring) are properly separated from application code",
  };

  return responses[type] || `This is a mock AI explanation for the **${type}** visualization. It explains the key concepts and patterns found in this data.`;
}
