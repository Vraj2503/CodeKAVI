"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
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
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the portal menu relative to the button
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPos({
      // Open downward: menu sits below the button
      top: rect.bottom + window.scrollY + 8,
      left: rect.left + window.scrollX,
    });
  }, []);

  const handleToggle = () => {
    if (!open) updatePosition();
    setOpen((v) => !v);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on scroll / resize so position doesn't drift
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const handleExport = async (format: "png" | "svg" | "json") => {
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
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        disabled={exporting}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        title="Download"
      >
        <Download size={18} />
        <span className="text-sm font-semibold">{exporting ? "Exporting…" : "Download"}</span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top - window.scrollY,
              left: menuPos.left - window.scrollX,
              zIndex: 9999,
            }}
            className="min-w-[160px] bg-card border border-border/60 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
          >
            {options.map(({ format, label, icon: Icon }) => (
              <button
                key={format}
                onClick={() => handleExport(format)}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Icon size={15} className="text-muted-foreground" />
                {label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
