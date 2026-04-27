import { useState, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Toaster, toast } from "sonner";
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
      toast.error(err.message || "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Toaster theme="dark" position="top-right" />
      {/* Conditionally Render Layout */}
      {!repoData && !isAnalyzing ? (
        <WelcomeScreen
          onAnalyze={handleAnalyze}
          isAnalyzing={isAnalyzing}
          error={error}
        />
      ) : (
        <div className="flex w-full h-full p-4 gap-4 bg-background relative z-10">
          <Sidebar
            repoData={repoData}
            isAnalyzing={isAnalyzing}
            onAnalyze={handleAnalyze}
            error={error}
          />
          <main className="flex-1 flex flex-col overflow-hidden bg-card/40 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl">
            {repoData ? <ChatPanel repoData={repoData} /> : null}
          </main>
        </div>
      )}
    </div>
  );
}
