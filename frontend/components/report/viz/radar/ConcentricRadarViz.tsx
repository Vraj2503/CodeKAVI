"use client";

import React, { useReducer, useEffect, useCallback, useState } from "react";
import * as d3 from "d3";
import { VizShell, VizTooltip } from "@/components/viz/VizShell";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom, ZOOM_MIN, ZOOM_MAX } from "@/components/viz/useVizZoom";
import { useReducedMotion } from "@/components/viz/useReducedMotion";
import type { RadarData, RadarState, RadarAction } from "./types";
import { searchFilter, riskColor } from "./useRadarLayout";
import { BackgroundRings } from "./layers/BackgroundRings";
import { ComplexityHull } from "./layers/ComplexityHull";
import { DependencyArcs } from "./layers/DependencyArcs";
import { ModuleNodes } from "./layers/ModuleNodes";
import { SweepBeam } from "./layers/SweepBeam";
import { RadarToolbar } from "./RadarToolbar";
import { RadarSearch } from "./RadarSearch";
import { RadarInspector } from "./RadarInspector";

const initialState: RadarState = {
  colorMode: "risk",
  sizeMode: "cc",
  showHull: true,
  showSweep: true,
  hoveredId: null,
  selectedId: null,
  searchQuery: "",
};

function radarReducer(state: RadarState, action: RadarAction): RadarState {
  switch (action.type) {
    case "SET_COLOR_MODE": return { ...state, colorMode: action.payload };
    case "SET_SIZE_MODE": return { ...state, sizeMode: action.payload };
    case "TOGGLE_HULL": return { ...state, showHull: !state.showHull };
    case "TOGGLE_SWEEP": return { ...state, showSweep: !state.showSweep };
    case "HOVER": return { ...state, hoveredId: action.payload };
    case "SELECT": return { ...state, selectedId: action.payload };
    case "SEARCH": return { ...state, searchQuery: action.payload };
    default: return state;
  }
}

interface ConcentricRadarVizProps {
  data: RadarData;
}

export function ConcentricRadarViz({ data }: ConcentricRadarVizProps) {
  const [state, dispatch] = useReducer(radarReducer, initialState);
  const canvas = useVizCanvas();
  const zoom = useVizZoom();
  const reducedMotion = useReducedMotion();
  const svgRef = React.useRef<SVGSVGElement>(null);
  const gRef = React.useRef<SVGGElement>(null);

  /* Tooltip mouse position — tracked in container coords. */
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on("zoom", (e) => {
        if (gRef.current) {
          d3.select(gRef.current).attr("transform", e.transform);
        }
      });
    zoom.register(svgRef.current, zoomBehavior, gRef.current);
  }, [zoom.register]);

  const searchMatches = React.useMemo(
    () => searchFilter(data.modules, state.searchQuery),
    [data.modules, state.searchQuery],
  );
  const selectedModule = React.useMemo(
    () => data.modules.find(m => m.id === state.selectedId) ?? null,
    [data.modules, state.selectedId],
  );
  const hoveredModule = React.useMemo(
    () => data.modules.find(m => m.id === state.hoveredId) ?? null,
    [data.modules, state.hoveredId],
  );

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [],
  );

  return (
    <div className="relative flex h-[600px] w-full overflow-hidden bg-background">
      <div className="flex-1 relative">
        <VizShell
          canvas={canvas}
          zoom={zoom}
          label="Concentric Radar & Complexity Hull"
          description="Modules arranged by architectural depth with complexity mapping and directed dependencies."
          toolbarLeft={<RadarToolbar state={state} dispatch={dispatch} stats={data.stats} />}
        >
          <svg
            ref={svgRef}
            viewBox="-550 -550 1100 1100"
            className="w-full h-full outline-none"
            onMouseMove={handleSvgMouseMove}
            onMouseLeave={() => setMouse(null)}
            onClick={(e) => {
              if (e.target === svgRef.current) {
                dispatch({ type: "SELECT", payload: null });
              }
            }}
          >
            <g ref={gRef}>
              <BackgroundRings tiers={data.tiers} />
              <SweepBeam visible={state.showSweep} reducedMotion={reducedMotion} />
              <ComplexityHull modules={data.modules} visible={state.showHull} />
              <DependencyArcs edges={data.edges} modules={data.modules} hoveredId={state.hoveredId} selectedId={state.selectedId} reducedMotion={reducedMotion} />
              <ModuleNodes
                modules={data.modules}
                tiers={data.tiers}
                colorMode={state.colorMode}
                sizeMode={state.sizeMode}
                hoveredId={state.hoveredId}
                selectedId={state.selectedId}
                searchMatches={searchMatches}
                onHover={(id) => dispatch({ type: "HOVER", payload: id })}
                onSelect={(id) => dispatch({ type: "SELECT", payload: id })}
              />
            </g>
          </svg>

          {hoveredModule && mouse && !state.selectedId && (
            <VizTooltip
              x={mouse.x}
              y={mouse.y}
              containerWidth={canvas.size.width}
              containerHeight={canvas.size.height}
            >
              <div className="space-y-1">
                <div className="font-semibold text-foreground text-[12px]">{hoveredModule.name}</div>
                <div className="text-muted-foreground">{hoveredModule.path}</div>
                <div>Tier: {data.tiers.find(t => t.level === hoveredModule.tier)?.name}</div>
                <div className="flex items-center gap-1.5">
                  <span>CC:</span>
                  <span className="font-mono font-bold" style={{ color: riskColor(hoveredModule.cc) }}>{hoveredModule.cc}</span>
                  {hoveredModule.is_hotspot && <span className="text-red-500 font-bold">⚠ SPIKE</span>}
                </div>
                <div>LOC: {hoveredModule.loc}</div>
              </div>
            </VizTooltip>
          )}
        </VizShell>

        <RadarSearch
          query={state.searchQuery}
          onChange={(q) => dispatch({ type: "SEARCH", payload: q })}
          matchCount={state.searchQuery ? searchMatches.size : 0}
          totalCount={data.modules.length}
        />
      </div>

      <RadarInspector
        module={selectedModule}
        tiers={data.tiers}
        onClose={() => dispatch({ type: "SELECT", payload: null })}
        onNavigate={(id) => dispatch({ type: "SELECT", payload: id })}
      />
    </div>
  );
}

