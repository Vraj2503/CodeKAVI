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
          { id: "A", label: "index.ts", type: "file" },
          { id: "B", label: "app.ts", type: "file" },
          { id: "C", label: "utils.ts", type: "file" },
        ],
        edges: [
          { source: "A", target: "B" },
          { source: "B", target: "C" },
        ],
      };
    case "complexity":
      return {
        name: "root",
        children: [
          { name: "index.ts", value: 100 },
          { name: "app.ts", value: 300 },
          { name: "utils.ts", value: 50 },
        ],
      };
    case "architecture":
      return {
        nodes: [
          { id: "frontend", label: "Frontend", type: "module" },
          { id: "backend", label: "Backend", type: "module" },
          { id: "db", label: "Database", type: "external" },
        ],
        edges: [
          { source: "frontend", target: "backend" },
          { source: "backend", target: "db" },
        ],
      };
    case "dataflow":
      return {
        nodes: [
          { id: "user", label: "User Input", type: "component" },
          { id: "api", label: "API Call", type: "function" },
          { id: "db_update", label: "DB Update", type: "method" },
        ],
        edges: [
          { source: "user", target: "api" },
          { source: "api", target: "db_update" },
        ],
      };
    case "mindmap":
      return {
        id: "root",
        label: "CodeKavi Mock",
        children: [
          { id: "ui", label: "UI", children: [{ id: "comp", label: "Components" }, { id: "pages", label: "Pages" }] },
          { id: "api", label: "API", children: [{ id: "routes", label: "Routes" }, { id: "ctrl", label: "Controllers" }] },
        ],
      };
    default:
      return {};
  }
}

export function mockExplanationResponse(type: string) {
  return `This is a mock AI explanation for the **${type}** visualization. It explains the key concepts and patterns found in this mock data. You can see how the different parts connect together without spending any Groq tokens!`;
}
