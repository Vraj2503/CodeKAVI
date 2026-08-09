"use client";

import { ChatPanel } from "@/components/ChatPanel";
import { useRepo } from "@/components/RepoProvider";
import { RepoStatePanel } from "@/components/RepoStatePanel";

export default function ChatPage() {
  const { repoData, sessionId } = useRepo();

  // No data yet, or none coming — RepoStatePanel decides which and says so.
  if (!repoData) return <RepoStatePanel />;

  return <ChatPanel repoData={repoData} sessionId={sessionId} />;
}
