"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, CheckCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useSSE } from "@/hooks/useSSE";
import { ProgressTracker } from "./ProgressTracker";
import { SectionSkeleton } from "./SectionSkeleton";
import { SectionRenderer, type SectionData } from "./SectionRenderer";
import { CreateReportModal } from "./CreateReportModal";

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



// ── Main ReportView ──

interface ReportViewProps {
  repoId: string;
  repoName?: string;
  needsReanalysis?: boolean;
  onReanalyze?: () => void;
}

interface StatsData {
  total_files: number;
  languages: Record<string, number>;
  selected_files: number;
  entry_points: string[];
}

export function ReportView({ repoId, repoName, needsReanalysis, onReanalyze }: ReportViewProps) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [sections, setSections] = useState<Map<string, SectionData>>(
    new Map()
  );
  const [completedSections, setCompletedSections] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const handleGenerate = useCallback(
    (prompt: string) => {
      // Close the modal
      setIsModalOpen(false);

      // Reset state
      setStats(null);
      setSections(new Map());
      setCompletedSections([]);
      setIsComplete(false);
      setHasStarted(true);

      const streamUrl = `${API_BASE}/explain/${repoId}/stream`;
      startStream(streamUrl, {
        depth: "detailed",
        ...(prompt ? { prompt } : {}),
      });
    },
    [repoId, startStream]
  );

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm px-6 py-4">
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
          {!isStreaming && !isComplete && hasStarted && (
            <button
              onClick={openModal}
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
              onClick={openModal}
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
          {needsReanalysis ? (
            <>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Analysis Data Expired
              </h2>
              <p className="text-muted-foreground max-w-md mb-6">
                The cached analysis for this repository has expired.
                Please re-analyze the repository before generating a report.
              </p>
              {onReanalyze && (
                <button
                  onClick={onReanalyze}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98] transition-all duration-200 shadow-lg"
                >
                  <RefreshCw size={16} />
                  Re-analyze Repository
                </button>
              )}
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Ready to Generate Your Report
              </h2>
              <p className="text-muted-foreground max-w-md mb-6">
                AI will analyze your codebase and generate a comprehensive report.
                You can provide custom instructions or use the default template.
              </p>
              <button
                onClick={openModal}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98] transition-all duration-200 shadow-lg"
              >
                <Sparkles size={16} />
                Generate Report
              </button>
            </>
          )}
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

      {/* Create Report Modal */}
      <CreateReportModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onGenerate={handleGenerate}
        isStreaming={isStreaming}
      />
    </div>
  );
}
