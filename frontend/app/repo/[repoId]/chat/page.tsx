"use client";

import { ChatPanel } from "@/components/ChatPanel";
import { useRepo } from "@/components/RepoProvider";

export default function ChatPage() {
  const { repoData, sessionId } = useRepo();

  if (!repoData) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Loading repository data…</p>
      </div>
    );
  }

  return <ChatPanel repoData={repoData} sessionId={sessionId} />;
}
