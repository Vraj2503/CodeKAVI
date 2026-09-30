"use client";

import React from "react";
import { RadarState, RadarAction, RadarStats } from "./types";

interface RadarToolbarProps {
  state: RadarState;
  dispatch: React.Dispatch<RadarAction>;
  stats: RadarStats;
}

export const RadarToolbar: React.FC<RadarToolbarProps> = ({ state, dispatch, stats }) => {
  return (
    <div className="flex flex-row items-center gap-3">
      <div className="flex bg-card border border-border rounded-lg p-0.5">
        <span className="px-2.5 py-1 text-[11px] font-medium text-foreground">
          {stats.total_modules} modules
        </span>
        <span className="px-2.5 py-1 text-[11px] font-medium text-foreground border-l border-border">
          Avg CC: {stats.avg_cc.toFixed(1)}
        </span>
        {stats.hotspot_count > 0 && (
          <span className="px-2.5 py-1 text-[11px] font-medium text-red-500 border-l border-border">
            {stats.hotspot_count} hotspots
          </span>
        )}
      </div>

      <div className="flex bg-card border border-border rounded-lg p-0.5">
        <button
          className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${state.colorMode === "risk" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => dispatch({ type: "SET_COLOR_MODE", payload: "risk" })}
        >
          Risk
        </button>
        <button
          className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${state.colorMode === "tier" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => dispatch({ type: "SET_COLOR_MODE", payload: "tier" })}
        >
          Tier
        </button>
      </div>

      <div className="flex bg-card border border-border rounded-lg p-0.5">
        <button
          className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${state.sizeMode === "cc" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => dispatch({ type: "SET_SIZE_MODE", payload: "cc" })}
        >
          CC
        </button>
        <button
          className={`px-2.5 py-1 text-[11px] rounded-md transition-colors ${state.sizeMode === "loc" ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => dispatch({ type: "SET_SIZE_MODE", payload: "loc" })}
        >
          LOC
        </button>
      </div>

      <label className="flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer">
        <div className="relative w-3.5 h-3.5 border border-border rounded-sm flex items-center justify-center bg-card">
          <input
            type="checkbox"
            className="absolute opacity-0 w-full h-full cursor-pointer"
            checked={state.showHull}
            onChange={() => dispatch({ type: "TOGGLE_HULL" })}
          />
          {state.showHull && (
            <svg viewBox="0 0 14 14" className="w-2.5 h-2.5 text-primary" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7l2.5 2.5L11 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        Hull
      </label>

      <label className="flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer">
        <div className="relative w-3.5 h-3.5 border border-border rounded-sm flex items-center justify-center bg-card">
          <input
            type="checkbox"
            className="absolute opacity-0 w-full h-full cursor-pointer"
            checked={state.showSweep}
            onChange={() => dispatch({ type: "TOGGLE_SWEEP" })}
          />
          {state.showSweep && (
            <svg viewBox="0 0 14 14" className="w-2.5 h-2.5 text-primary" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7l2.5 2.5L11 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        Sweep
      </label>
    </div>
  );
};
