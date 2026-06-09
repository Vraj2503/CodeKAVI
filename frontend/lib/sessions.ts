import { supabase } from "./supabase";
import type { ChatMessage, ChatSource } from "./api";

// ── Types ──

export interface Session {
  id: string;
  repo_id: string;
  repo_name: string;
  owner: string;
  github_url: string;
  total_files: number;
  total_size_formatted: string;
  languages: Record<string, number>;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface PersistedMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  created_at: string;
}

// ── Sessions ──

export async function getSessions(): Promise<Session[]> {
  // Get the authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch sessions:", error);
    return [];
  }

  // Get message counts via server-side RPC (single query instead of N+1)
  const sessionIds = (data || []).map((s) => s.id);
  const countMap: Record<string, number> = {};

  if (sessionIds.length > 0) {
    const { data: counts, error: rpcError } = await supabase.rpc(
      "get_session_message_counts",
      { session_ids: sessionIds }
    );

    if (!rpcError && counts) {
      counts.forEach((row: { session_id: string; count: number }) => {
        countMap[row.session_id] = row.count;
      });
    }
  }

  return (data || []).map((s) => ({
    ...s,
    message_count: countMap[s.id] || 0,
  }));
}

export async function createSession(params: {
  repo_id: string;
  repo_name: string;
  owner: string;
  github_url: string;
  total_files: number;
  total_size_formatted: string;
  languages: Record<string, number>;
}): Promise<Session | null> {
  // Get the authenticated user's ID
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("Failed to create session: user not authenticated");
    return null;
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: user.id,
      repo_id: params.repo_id,
      repo_name: params.repo_name,
      owner: params.owner,
      github_url: params.github_url,
      total_files: params.total_files,
      total_size_formatted: params.total_size_formatted,
      languages: params.languages,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create session:", error);
    return null;
  }

  return data;
}

export async function touchSession(sessionId: string): Promise<void> {
  await supabase
    .from("sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

// ── Messages ──

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch messages:", error);
    return [];
  }

  return (data || []).map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content,
    sources: row.sources || [],
    timestamp: new Date(row.created_at).getTime(),
  }));
}

export async function saveMessage(
  sessionId: string,
  msg: ChatMessage
): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    session_id: sessionId,
    role: msg.role,
    content: msg.content,
    sources: msg.sources || [],
  });

  if (error) {
    console.error("Failed to save message:", error);
  }

  // Touch the session's updated_at
  await touchSession(sessionId);
}
