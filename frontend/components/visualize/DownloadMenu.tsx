"use client";

import { useState, useRef, useEffect } from "react";
import { Download, Image, FileCode, FileJson } from "lucide-react";
import { exportAsPng, exportAsSvg, exportAsJson } from "@/lib/downloadUtils";
import { toast } from "sonner";

interface DownloadMenuProps {
  /** Ref to the container element that holds the SVG visualization */
  containerRef: React.RefObject<HTMLElement | null>;
  /** The raw visualization data (for JSON export) */
  data: unknown;
  /** Base filename without extension */
  filename?: string;
}

export function DownloadMenu({
  containerRef,
  data,
  filename = "visualization",
}: DownloadMenuProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleExport = async (
    format: "png" | "svg" | "json"
  ) => {
    setExporting(true);
    setOpen(false);

    try {
      if (format === "json") {
        exportAsJson(data, `${filename}.json`);
        toast.success("JSON downloaded");
      } else if (format === "svg") {
        if (!containerRef.current) throw new Error("Container not found");
        exportAsSvg(containerRef.current, `${filename}.svg`);
        toast.success("SVG downloaded");
      } else {
        if (!containerRef.current) throw new Error("Container not found");
        await exportAsPng(containerRef.current, `${filename}.png`);
        toast.success("PNG downloaded");
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to export as ${format.toUpperCase()}`);
    } finally {
      setExporting(false);
    }
  };

  const options = [
    { format: "png" as const, label: "PNG Image", icon: Image },
    { format: "svg" as const, label: "SVG Vector", icon: FileCode },
    { format: "json" as const, label: "JSON Data", icon: FileJson },
  ];

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={exporting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
      >
        <Download size={12} />
        {exporting ? "Exporting…" : "Download"}
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 min-w-[160px] bg-card border border-border/60 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
          {options.map(({ format, label, icon: Icon }) => (
            <button
              key={format}
              onClick={() => handleExport(format)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <Icon size={14} className="text-muted-foreground" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
