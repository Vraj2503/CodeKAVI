"use client";
// dataflow/search-box.tsx — debounced search input
import { useRef, useEffect, type ChangeEvent } from "react";

interface SearchBoxProps {
  value: string;
  onChange: (q: string) => void;
}

export function SearchBox({ value, onChange }: SearchBoxProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(q), 150);
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="relative flex items-center">
      <span className="absolute left-2 text-muted-foreground text-[11px] pointer-events-none">⌕</span>
      <input
        className="h-6 rounded border border-border bg-card/80 pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        defaultValue={value}
        placeholder="Search nodes…"
        onChange={handleChange}
        aria-label="Search nodes"
      />
    </div>
  );
}
