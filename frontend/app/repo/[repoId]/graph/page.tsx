"use client";

import { useParams } from "next/navigation";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { useRepo } from "@/components/RepoProvider";
import { RepoStatePanel } from "@/components/RepoStatePanel";

export default function GraphPage() {
  const params = useParams();
  const repoId = params.repoId as string;
  const { unavailable } = useRepo();

  // The graph fetches its own payload, so it doesn't wait on `repoData` — but
  // when the repo is known to be unloadable it must not sit there retrying an
  // endpoint that will keep refusing. `/repo/<id>` redirects here, so this is
  // where most shared links land.
  if (unavailable) return <RepoStatePanel />;

  return <GraphCanvas repoId={repoId} />;
}
