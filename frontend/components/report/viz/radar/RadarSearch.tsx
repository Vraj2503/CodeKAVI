"use client";

import React from "react";

interface RadarSearchProps {
  query: string;
  onChange: (query: string) => void;
  matchCount: number;
  totalCount: number;
}

export const RadarSearch: React.FC<RadarSearchProps> = ({ query, onChange, matchCount, totalCount }) => {
  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center bg-card border border-border rounded-md shadow-sm overflow-hidden h-8">
      <div className="pl-2.5 pr-2 text-muted-foreground flex items-center justify-center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </div>
      <input
        type="text"
        className="bg-transparent border-none outline-none text-[12px] text-foreground font-mono placeholder:text-muted-foreground w-40 focus:ring-0"
        placeholder="Search modules..."
        value={query}
        onChange={(e) => onChange(e.target.value)}
      />
      {query && (
        <div className="pr-2.5 text-[11px] text-muted-foreground font-mono">
          {matchCount} / {totalCount}
        </div>
      )}
    </div>
  );
};
