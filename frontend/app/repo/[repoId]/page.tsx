import { redirect } from "next/navigation";

// Default repo page redirects to graph
export default async function RepoPage({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  redirect(`/repo/${repoId}/graph`);
}
