"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NNModel } from "@/lib/api";
import { NNEditor } from "@/components/report/viz/NNEditor";
import { addLayer, emptyModel } from "@/lib/viz/figureModel";

/**
 * /studio — the neural network studio, as its own destination.
 *
 * It was previously only reachable as a modal over a chart, which framed it
 * as an accessory to repository analysis. It is not: drawing a figure for a
 * paper is a whole job on its own, and one people arrive wanting to do. A
 * route means it can be linked, bookmarked, opened in a second tab and
 * returned to — none of which a modal supports.
 */
export default function StudioPage() {
  const router = useRouter();

  // Seeded, not blank. An empty canvas asks the user to supply the idea; four
  // blocks show the shape of the thing and are faster to edit than to create.
  const [model, setModel] = useState<NNModel>(() => {
    let m = emptyModel("New architecture");
    for (const category of ["embedding", "attention", "normalization", "dense"]) {
      m = addLayer(m, category).model;
    }
    return m;
  });

  return (
    <NNEditor
      initial={model}
      onApply={setModel}
      onClose={() => router.push("/")}
    />
  );
}
