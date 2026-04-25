import { useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { analyzeRepo, type AnalyzeResponse } from "./lib/api";

export default function App() {
  const [repoData, setRepoData] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = useCallback(async (url: string) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const data = await analyzeRepo(url);
      setRepoData(data);
    } catch (err: any) {
      setError(err.message || "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-primary">
      {/* Sidebar */}
      <Sidebar
        repoData={repoData}
        isAnalyzing={isAnalyzing}
        onAnalyze={handleAnalyze}
        error={error}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {repoData ? (
          <ChatPanel repoData={repoData} />
        ) : (
          <WelcomeScreen
            onAnalyze={handleAnalyze}
            isAnalyzing={isAnalyzing}
            error={error}
          />
        )}
      </main>
    </div>
  );
}
