"use client";

import { useParams } from "next/navigation";
import { GraphCanvas } from "@/components/graph/GraphCanvas";

export default function GraphPage() {
  const params = useParams();
  const repoId = params.repoId as string;

  return <GraphCanvas repoId={repoId} />;
}
