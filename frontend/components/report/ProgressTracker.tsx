"use client";

import { motion } from "framer-motion";

interface ProgressTrackerProps {
  phase?: string;
  progress: number;
  message: string;
  completedCount: number;
  totalCount: number;
}

export function ProgressTracker({
  phase,
  progress,
  message,
  completedCount,
  totalCount,
}: ProgressTrackerProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-foreground rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Info row */}
      <div className="flex justify-between mt-2">
        <span className="text-sm text-muted-foreground">
          {phase && <span className="font-semibold text-foreground mr-2">{phase}:</span>}
          {message || "Initializing..."}
        </span>
        <span className="text-sm text-foreground font-medium">
          {completedCount}/{totalCount}
        </span>
      </div>
    </div>
  );
}
