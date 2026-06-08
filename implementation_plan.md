# Fix Visualization Graphs & Redesign Layout (2×2 + 1×2)

The visualization graphs currently have rendering/layout issues (e.g. DataFlow nodes clustering in center, Mind Map not using space properly). This plan addresses fixing each D3 graph and restructuring the `VisualizationPanel` grid from a flat `grid-cols-2` into a **2×2 top row + 1×2 full-width Mind Map bottom row**.

## User Review Required

> [!IMPORTANT]
> **Layout change**: The 5 graphs will be reorganized as:
> - **Top row (2×2)**: Dependency Graph, Complexity Treemap, Architecture Graph, Data Flow Diagram
> - **Bottom row (1×2 full-width)**: Mind Map — spanning the full width for its radial layout
>
> The Mind Map gets promoted to a full-width card since radial trees need more horizontal space.

> [!WARNING]
> **Graph height reduction**: With 4 graphs in a 2×2 grid, each graph's `minHeight` will be reduced from 400–500px → ~350px to avoid excessive scrolling. The full-width Mind Map will retain a taller height (~500px). Let me know if you prefer different dimensions.

## Open Questions

> [!IMPORTANT]
> 1. Should we add a "Generate All" button in the header to trigger all 5 visualizations at once?
> 2. For the Mind Map spanning full width — should the explanation section be side-by-side (left: graph, right: explanation) or stacked (graph on top, explanation below)?

---

## Proposed Changes

### Layout — VisualizationPanel

#### [MODIFY] [VisualizationPanel.tsx](file:///Applications/Projects/CodeKavi/frontend/components/visualize/VisualizationPanel.tsx)

- **Split `VIZ_CONFIG` into two groups**: `TOP_VIZ_CONFIG` (4 items: dependencies, complexity, architecture, dataflow) and `BOTTOM_VIZ_CONFIG` (1 item: mindmap)
- **Render two separate grids**:
  - Top grid: `grid-cols-1 lg:grid-cols-2` with the 4 graphs → produces the 2×2 layout on desktop
  - Bottom section: Single full-width `VisualizationCard` for the Mind Map, wrapped in a distinct container with `col-span-full`
- Add a subtle visual separator or section label between the top grid and the bottom mind map

---

### Graph Fix — DataFlowGraph

#### [MODIFY] [DataFlowGraph.tsx](file:///Applications/Projects/CodeKavi/frontend/Components/report/viz/DataFlowGraph.tsx)

Current issues visible in screenshot:
- Nodes are pill-shaped but clustered flat in the center with no visible flow direction
- Edges/arrows are barely visible

Fixes:
- **Improve BFS depth assignment**: Add fallback logic so single-layer graphs still get spread across columns
- **Increase vertical spacing**: Reduce `pillH` and increase inter-node spacing to prevent overlap
- **Make edges more visible**: Increase `stroke-width` to 2.5, increase arrow marker size, improve gradient opacity from 0.6 → 0.8
- **Reduce `minHeight`** from 450px → 350px to fit the 2×2 grid
- **Add responsive container width measurement** using `ResizeObserver` instead of one-shot `clientWidth`

---

### Graph Fix — RadialMindmap

#### [MODIFY] [RadialMindmap.tsx](file:///Applications/Projects/CodeKavi/frontend/Components/report/viz/RadialMindmap.tsx)

Current issues visible in screenshot:
- Nodes are pushed to the bottom-right of the container, not centered
- Very few nodes visible, labels are rotated/hard to read
- Initial zoom level too far out for small data

Fixes:
- **Fix centering**: Adjust initial `translate` to account for actual hierarchy bounds, not just `size/2`
- **Auto-fit on render**: After initial layout, compute the bounding box of all visible nodes and set an initial zoom transform to fit them centered in the viewport
- **Increase initial expansion depth**: Change from depth ≥ 1 collapse to depth ≥ 2 so more structure is visible on first render
- **Improve label readability**: Increase font-size from 11 → 12, add a dark background rect behind labels for contrast
- **Increase `minHeight`** to 500px since this graph gets the full-width treatment
- **Better separation function**: Tweak the `separation()` parameters to give more space between sibling nodes

---

### Graph Fix — DependencyGraph

#### [MODIFY] [DependencyGraph.tsx](file:///Applications/Projects/CodeKavi/frontend/Components/report/viz/DependencyGraph.tsx)

- **Reduce `minHeight`** from 400px → 350px for the 2×2 grid
- **Improve force parameters**: Increase `charge` strength from -300 → -400 to spread nodes more, increase link distance from 120 → 140
- **Add collision force**: `d3.forceCollide(30)` to prevent node overlap in dense graphs

---

### Graph Fix — ArchitectureGraph

#### [MODIFY] [ArchitectureGraph.tsx](file:///Applications/Projects/CodeKavi/frontend/Components/report/viz/ArchitectureGraph.tsx)

- **Reduce `minHeight`** from 500px → 350px for the 2×2 grid
- **Make swim-lane height adaptive**: Reduce `layerPadding` and `nodeH` slightly so more layers fit in the reduced viewport
- **Add auto-fit zoom**: After rendering, compute total content height and if it exceeds the viewport, set an initial zoom transform to fit

---

### Graph Fix — TreemapViz

#### [MODIFY] [TreemapViz.tsx](file:///Applications/Projects/CodeKavi/frontend/Components/report/viz/TreemapViz.tsx)

- **Reduce `minHeight`** from 400px → 350px for the 2×2 grid
- **Set initial dimensions height** from 400 → 350

---

### VisualizationCard (Minor)

#### [MODIFY] [VisualizationCard.tsx](file:///Applications/Projects/CodeKavi/frontend/Components/visualize/VisualizationCard.tsx)

- Add an optional `fullWidth` prop that the Mind Map card uses — when true, adjusts internal paddings and the viz container height for a wider layout
- Ensure the `VizSkeleton` height adapts (350px for regular cards, 500px for full-width)

---

## Verification Plan

### Manual Verification
- Run `npm run dev` and navigate to the Visualization Studio page
- Verify the 2×2 + 1×2 layout renders correctly on desktop (lg breakpoint)
- Verify mobile (single column) still stacks all 5 cards properly
- Generate each of the 5 visualizations and confirm:
  - DataFlow: Nodes spread left-to-right with visible arrows
  - Mind Map: Centered in container, nodes readable, expand/collapse works
  - Dependency: Nodes don't overlap, hover highlights work
  - Architecture: Swim lanes fit without excessive scrolling
  - Treemap: Colors and tooltips work at reduced height
- Test the Download and Explain features still work after layout changes

### Automated Tests
- `npm run build` — ensure no TypeScript or build errors
