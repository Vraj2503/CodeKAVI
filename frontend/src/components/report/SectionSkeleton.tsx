const sectionTitles: Record<string, string> = {
  overview: "📋 Overview",
  architecture: "🏗️ Architecture",
  components: "🧩 Components",
  data_flow: "🌊 Data Flow",
  dependencies: "🔗 Dependencies",
  complexity: "🔥 Complexity",
  patterns: "🧬 Patterns",
  mindmap: "🧠 Mind Map",
};

interface SectionSkeletonProps {
  name: string;
}

export function SectionSkeleton({ name }: SectionSkeletonProps) {
  const title = sectionTitles[name] || name;

  return (
    <div className="bg-[#161b22] rounded-xl border border-[#30363d] p-6">
      {/* Faded title with pulsing dots */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[#8b949e]/60 text-lg font-semibold">
          {title}
        </span>
        <span className="flex items-center gap-1 ml-1">
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#8b949e]/40"
            style={{ animation: "typing-dot 1.4s ease-in-out infinite" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#8b949e]/40"
            style={{ animation: "typing-dot 1.4s ease-in-out 0.2s infinite" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#8b949e]/40"
            style={{ animation: "typing-dot 1.4s ease-in-out 0.4s infinite" }}
          />
        </span>
      </div>

      {/* Shimmer lines */}
      <div className="space-y-3">
        <div className="skeleton-shimmer h-3" style={{ width: "100%" }} />
        <div className="skeleton-shimmer h-3" style={{ width: "75%" }} />
        <div className="skeleton-shimmer h-3" style={{ width: "87%" }} />
        <div className="skeleton-shimmer h-3" style={{ width: "66%" }} />
      </div>
    </div>
  );
}
