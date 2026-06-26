"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, X, FileText, Sparkles } from "lucide-react";

interface CreateReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (prompt: string) => void;
  isStreaming: boolean;
}

const PLACEHOLDER_PROMPT = `For example:

Create a formal competitive review of this codebase's architecture. The tone should be analytical and strategic, focusing on code quality, design patterns, and scalability to inform our development strategy.`;

export function CreateReportModal({
  isOpen,
  onClose,
  onGenerate,
  isStreaming,
}: CreateReportModalProps) {
  const [prompt, setPrompt] = useState("");

  const handleGenerate = useCallback(() => {
    onGenerate(prompt.trim());
    setPrompt("");
  }, [prompt, onGenerate]);

  const handleClose = useCallback(() => {
    if (!isStreaming) {
      setPrompt("");
      onClose();
    }
  }, [isStreaming, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="w-full max-w-xl pointer-events-auto bg-card border border-border/60 rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Header ── */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleClose}
                    className="p-1.5 rounded-lg hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                    aria-label="Go back"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-primary/10">
                      <FileText size={16} className="text-primary" />
                    </div>
                    <h2 className="text-base font-semibold text-foreground">
                      Create report
                    </h2>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="p-1.5 rounded-lg hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              {/* ── Body ── */}
              <div className="px-6 py-5 space-y-5">
                {/* Prompt input */}
                <div>
                  <label className="block text-sm font-semibold text-foreground mb-2.5">
                    Describe the report you want to create
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={PLACEHOLDER_PROMPT}
                    rows={5}
                    className="w-full rounded-xl bg-background/60 border border-border/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-200 resize-none leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Leave empty to generate a comprehensive default report with
                    8 sections covering architecture, components, data flow, and
                    more.
                  </p>
                </div>
              </div>

              {/* ── Footer ── */}
              <div className="flex justify-end px-6 py-4 border-t border-border/30">
                <button
                  onClick={handleGenerate}
                  disabled={isStreaming}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-lg"
                >
                  <Sparkles size={15} />
                  Generate
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
