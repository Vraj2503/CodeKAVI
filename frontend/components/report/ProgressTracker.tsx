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
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
      {/* Progress bar */}
      <div className="h-2 bg-[#21262d] rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-[#3fb950] rounded-full"
          style={{ boxShadow: "0 0 10px rgba(63, 185, 80, 0.5)" }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Info row */}
      <div className="flex justify-between mt-2">
        <span className="text-sm text-[#8b949e]">
          {phase && <span className="font-semibold text-[#c9d1d9] mr-2">{phase}:</span>}
          {message || "Initializing..."}
        </span>
        <span className="text-sm text-[#58a6ff]">
          {completedCount}/{totalCount}
        </span>
      </div>
    </div>
  );
}
