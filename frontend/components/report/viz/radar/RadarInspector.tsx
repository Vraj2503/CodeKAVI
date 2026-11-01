"use client";

import React from "react";
import { RadarModule, RadarTier } from "./types";

interface RadarInspectorProps {
  module: RadarModule | null;
  tiers: RadarTier[];
  onClose: () => void;
  onNavigate: (moduleId: string) => void;
}

export const RadarInspector: React.FC<RadarInspectorProps> = ({ module, tiers, onClose, onNavigate }) => {
  const isVisible = module !== null;
  
  if (!module) {
    return (
      <div className="w-[340px] bg-card border-l border-border transform transition-transform duration-300 translate-x-full absolute right-0 top-0 bottom-0 z-20" />
    );
  }

  const tier = tiers.find(t => t.level === module.tier);
  const tierColor = tier ? tier.color : "gray";
  
  let riskBadgeColor = "text-muted-foreground border-border bg-card";
  let riskLabelText = "Clean";
  if (module.cc >= 50) {
    riskBadgeColor = "text-red-500 border-red-500 bg-red-500/10";
    riskLabelText = "Critical Spike";
  } else if (module.cc >= 21) {
    riskBadgeColor = "text-orange-500 border-orange-500 bg-orange-500/10";
    riskLabelText = "High Alert";
  } else if (module.cc >= 11) {
    riskBadgeColor = "text-yellow-500 border-yellow-500 bg-yellow-500/10";
    riskLabelText = "Medium";
  }

  const pathParts = module.path.split("/");
  const fileName = pathParts.pop() || module.name;
  const dirPath = pathParts.length > 0 ? pathParts.join("/") + "/" : "";

  return (
    <div className={`w-[340px] bg-card border-l border-border transform transition-transform duration-300 flex flex-col h-full absolute right-0 top-0 bottom-0 z-20 ${isVisible ? "translate-x-0" : "translate-x-full"}`}>
      <div className="flex items-start justify-between p-4 border-b border-border">
        <div className="flex-1 min-w-0 pr-4">
          <div className="text-[11px] text-muted-foreground font-mono truncate">{dirPath}</div>
          <div className="text-[14px] font-bold text-foreground font-mono truncate">{fileName}</div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-border bg-muted/50" style={{ color: tierColor }}>
            {tier?.name || `Ring ${module.tier}`}
          </span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${riskBadgeColor}`}>
            {riskLabelText}
          </span>
        </div>

        {module.is_hotspot && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-[12px] p-2.5 rounded-md flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            ⚠ Complexity spike detected — CC ≥ 50
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/30 border border-border rounded-md p-3">
            <div className="text-[11px] text-muted-foreground mb-1">Cyclomatic CC</div>
            <div className={`text-[18px] font-mono font-bold ${module.cc >= 50 ? 'text-red-500' : module.cc >= 21 ? 'text-orange-500' : module.cc >= 11 ? 'text-yellow-500' : 'text-foreground'}`}>
              {module.cc}
            </div>
          </div>
          <div className="bg-muted/30 border border-border rounded-md p-3">
            <div className="text-[11px] text-muted-foreground mb-1">Lines of Code</div>
            <div className="text-[18px] font-mono font-bold text-foreground">
              {module.loc}
            </div>
          </div>
          <div className="bg-muted/30 border border-border rounded-md p-3">
            <div className="text-[11px] text-muted-foreground mb-1">Arch. Depth</div>
            <div className="text-[18px] font-mono font-bold text-foreground">
              Ring {module.tier}
            </div>
          </div>
          <div className="bg-muted/30 border border-border rounded-md p-3">
            <div className="text-[11px] text-muted-foreground mb-1">Density (CC/LOC)</div>
            <div className="text-[18px] font-mono font-bold text-foreground">
              {module.density.toFixed(3)}
            </div>
          </div>
        </div>

        {module.outbound && module.outbound.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-medium text-foreground">Outbound ({module.outbound.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {module.outbound.map(dep => (
                <button
                  key={dep}
                  onClick={() => onNavigate(dep)}
                  className="bg-muted text-foreground text-[11px] px-2 py-0.5 rounded-full cursor-pointer hover:bg-muted/80 text-left truncate max-w-[280px]"
                >
                  {dep}
                </button>
              ))}
            </div>
          </div>
        )}

        {module.inbound && module.inbound.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-medium text-foreground">Inbound ({module.inbound.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {module.inbound.map(dep => (
                <button
                  key={dep}
                  onClick={() => onNavigate(dep)}
                  className="bg-muted text-foreground text-[11px] px-2 py-0.5 rounded-full cursor-pointer hover:bg-muted/80 text-left truncate max-w-[280px]"
                >
                  {dep}
                </button>
              ))}
            </div>
          </div>
        )}

        {module.symbols && module.symbols.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="text-[12px] font-medium text-foreground">Top Complex Symbols</div>
            <div className="bg-muted/20 border border-border rounded-md overflow-hidden">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-2 py-1.5 font-medium text-muted-foreground">Name</th>
                    <th className="px-2 py-1.5 font-medium text-muted-foreground w-12">Kind</th>
                    <th className="px-2 py-1.5 font-medium text-muted-foreground w-12 text-right">CC</th>
                  </tr>
                </thead>
                <tbody>
                  {[...module.symbols].sort((a, b) => b.complexity - a.complexity).slice(0, 5).map((sym, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="px-2 py-1.5 font-mono truncate max-w-[150px]" title={sym.name}>{sym.name}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        <span className="bg-card border border-border px-1 py-0.5 rounded text-[9px]">{sym.kind === 'function' ? 'fn' : sym.kind}</span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-right font-medium">{sym.complexity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
