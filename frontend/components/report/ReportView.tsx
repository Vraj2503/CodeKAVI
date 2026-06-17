"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { useSSE } from "@/hooks/useSSE";
import { ProgressTracker } from "./ProgressTracker";
import { SectionSkeleton } from "./SectionSkeleton";
import { SectionRenderer, type SectionData } from "./SectionRenderer";

const API_BASE = "/api";

const sectionOrder = [
  "overview",
  "architecture",
  "components",
  "data_flow",
  "dependencies",
  "complexity",
  "patterns",
  "mindmap",
] as const;

// ── Helper components ──

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 text-center">
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function LanguageBar({ languages }: { languages: Record<string, number> }) {
  const entries = Object.entries(languages).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) return null;

  // Monochrome shades from light to dark
  const monoShades = [
    "hsl(var(--foreground))",
    "hsl(var(--muted-foreground))",
    "hsl(var(--ring))",
    "hsl(var(--primary))",
    "hsl(0 0% 55%)",
    "hsl(0 0% 40%)",
    "hsl(0 0% 30%)",
    "hsl(0 0% 70%)",
  ];

  return (
    <div>
      {/* Bar */}
      <div className="flex h-2 rounded-full overflow-hidden">
        {entries.map(([lang, count], i) => (
          <div
            key={lang}
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: monoShades[i % monoShades.length],
            }}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {entries.map(([lang, count], i) => {
          const pct = ((count / total) * 100).toFixed(1);
          return (
            <div key={lang} className="flex items-center gap-1.5 text-xs">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: monoShades[i % monoShades.length] }}
              />
              <span className="text-foreground">
                {lang} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ReportView ──

interface ReportViewProps {
  repoId: string;
  repoName?: string;
}

interface StatsData {
  total_files: number;
  languages: Record<string, number>;
  selected_files: number;
  entry_points: string[];
}

export function ReportView({ repoId, repoName }: ReportViewProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [sections, setSections] = useState<Map<string, SectionData>>(
    new Map()
  );
  const [completedSections, setCompletedSections] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const { startStream, stop, isStreaming, progress, phase, message } = useSSE({
    onStats: (data) => setStats(data as StatsData),
    onTree: (data) => console.log("[Report tree]", data),
    onSection: (data) => {
      const sectionData = data as SectionData;
      setSections((prev) => new Map(prev).set(sectionData.name, sectionData));
      setCompletedSections((prev) => [...prev, sectionData.name]);
    },
    onDone: () => setIsComplete(true),
    onError: (data) => toast.error(data.message || "Stream error"),
    onWarning: (data) => console.warn("[Report warning]", data),
  });

  const handleGenerate = useCallback(() => {
    // Reset state
    setStats(null);
    setSections(new Map());
    setCompletedSections([]);
    setIsComplete(false);
    setHasStarted(true);

    const streamUrl = `${API_BASE}/explain/${repoId}/stream`;
    startStream(streamUrl, { depth: "detailed" });
  }, [repoId, startStream]);

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Code Explanation Report
            </h1>
            {repoName && (
              <p className="text-sm text-muted-foreground">{repoName}</p>
            )}
          </div>

          {/* Generate / Stop / Regenerate button */}
          {!isStreaming && !isComplete && (
            <button
              onClick={handleGenerate}
              className="bg-foreground hover:bg-foreground/90 text-background rounded-lg px-4 py-2 font-medium transition-colors flex items-center gap-2"
            >
              <Sparkles size={16} /> Generate Report
            </button>
          )}
          {isStreaming && (
            <button
              onClick={stop}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg px-4 py-2 font-medium transition-colors"
            >
              ⏹ Stop
            </button>
          )}
          {isComplete && !isStreaming && (
            <button
              onClick={handleGenerate}
              className="bg-card hover:bg-muted text-foreground rounded-lg px-4 py-2 font-medium border border-border transition-colors"
            >
              Regenerate
            </button>
          )}
        </div>

        {/* Progress (only while streaming) */}
        {isStreaming && (
          <ProgressTracker
            phase={phase}
            progress={progress}
            message={message}
            completedCount={completedSections.length}
            totalCount={8}
          />
        )}
      </div>

      {/* Empty state when not started */}
      {!hasStarted && !isStreaming && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Ready to Generate Your Report
          </h2>
          <p className="text-muted-foreground max-w-md">
            AI will analyze your codebase and generate 8 comprehensive sections
            covering architecture, components, data flow, and more.
          </p>
        </div>
      )}

      {/* Stat cards (appear instantly when stats arrive) */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-6"
        >
          <StatCard value={stats.total_files} label="Source Files" />
          <StatCard
            value={Object.keys(stats.languages || {}).length}
            label="Languages"
          />
          <StatCard value={stats.selected_files} label="Files Analyzed" />
          <StatCard
            value={(stats.entry_points || []).length}
            label="Entry Points"
          />
        </motion.div>
      )}

      {/* Language bar */}
      {stats?.languages && Object.keys(stats.languages).length > 0 && (
        <div className="px-6 mb-6">
          <LanguageBar languages={stats.languages} />
        </div>
      )}

      {/* Sections */}
      <div className="px-6 pb-20 space-y-4">
        {sectionOrder.map((name) => {
          const section = sections.get(name);
          const isCompleted = completedSections.includes(name);

          if (!isCompleted && !isStreaming) return null;

          return (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              {isCompleted && section ? (
                <SectionRenderer section={section} />
              ) : (
                <SectionSkeleton name={name} />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Completion toast */}
      <AnimatePresence>
        {isComplete && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 right-6 bg-foreground text-background px-4 py-3 rounded-lg shadow-2xl flex items-center gap-2 z-50"
          >
            <CheckCircle size={18} />
            Report Complete — {completedSections.length} sections
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
