import { supabase } from "./supabase";
import type { AnalyzeResponse, ChatMessage, ChatSource } from "./api";

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

/**
 * Find the session for a repo this tab has no memory of.
 *
 * `sessionStorage` dies with the tab, so a bookmarked or shared repo URL arrives
 * carrying nothing but the id in the path. Supabase still knows that repo's
 * `github_url`, and that is the whole difference between offering a working
 * "Re-analyze" button and offering a dead end.
 *
 * Returns null when signed out, or when the repo belongs to someone else — RLS
 * and the explicit `user_id` filter both see to that.
 */
export async function getSessionByRepoId(
  repoId: string,
): Promise<Session | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("repo_id", repoId)
    .maybeSingle();

  if (error) {
    console.error("Failed to look up session by repo id:", error);
    return null;
  }

  return data;
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

  // Check if session already exists for this user and repo
  const { data: existingSession } = await supabase
    .from("sessions")
    .select()
    .eq("user_id", user.id)
    .eq("repo_id", params.repo_id)
    .maybeSingle();

  if (existingSession) {
    // Optionally update it, but for now just return the existing one
    return existingSession;
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
    console.error("Failed to create session:", JSON.stringify(error, null, 2));
    throw new Error(error.message || "Failed to create session in database");
  }

  return data;
}

/**
 * Record a freshly analyzed repo: a durable Supabase session plus the per-tab
 * pointers `RepoProvider` hydrates from.
 *
 * Only the lightweight identifiers go into `sessionStorage` — a full analysis
 * can exceed 5MB and would blow the quota. Every caller that finishes an
 * analysis must go through here, or the next navigation lands on a repo page
 * the provider has no record of.
 */
export async function persistAnalyzedRepo(
  data: AnalyzeResponse,
): Promise<Session | null> {
  const session = await createSession({
    repo_id: data.repo_id,
    repo_name: data.repo_name,
    owner: data.owner,
    github_url: data.github_url,
    total_files: data.total_files,
    total_size_formatted: data.total_size_formatted,
    languages: data.languages,
  });

  if (typeof window !== "undefined") {
    sessionStorage.setItem(
      `codekavi-session-meta-${data.repo_id}`,
      JSON.stringify({
        repo_id: data.repo_id,
        repo_name: data.repo_name,
        owner: data.owner,
        github_url: data.github_url,
        total_files: data.total_files,
        total_size_formatted: data.total_size_formatted,
        languages: data.languages,
      }),
    );
    if (session) {
      sessionStorage.setItem(`codekavi-session-${data.repo_id}`, session.id);
    }
  }

  return session;
}

export async function touchSession(sessionId: string): Promise<void> {
  await supabase
    .from("sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  
  try {
    const res = await fetch(`/api/session/${sessionId}`, {
      method: "DELETE",
      headers: {
        ...(token ? { "Authorization": `Bearer ${token}` } : {})
      }
    });
    
    if (!res.ok) {
      console.error("Failed to delete session, status:", res.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to delete session via API:", error);
    return false;
  }
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
