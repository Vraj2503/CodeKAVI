import { redirect } from "next/navigation";

// Default repo page redirects to chat
export default async function RepoPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  redirect(`/repo/${repoId}/chat`);
}
