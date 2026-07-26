import type { TourStep } from "@/lib/api";

export interface TourProgress {
  seenSteps: string[];
  answerableQuestions: string[];
}

const EMPTY: TourProgress = { seenSteps: [], answerableQuestions: [] };

function storageKey(repoId: string): string {
  return `codekavi-tour-progress-${repoId}`;
}

/** Stable across learn/recall mode switches — keyed by topology, not order. */
export function stepKey(step: TourStep): string {
  return step.layer_id ?? step.node_ids.join(",");
}

export function questionKey(step: TourStep, questionIndex: number): string {
  return `${stepKey(step)}::q${questionIndex}`;
}

export function loadTourProgress(repoId: string): TourProgress {
  try {
    const raw = localStorage.getItem(storageKey(repoId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return {
      seenSteps: Array.isArray(parsed.seenSteps) ? parsed.seenSteps : [],
      answerableQuestions: Array.isArray(parsed.answerableQuestions)
        ? parsed.answerableQuestions
        : [],
    };
  } catch {
    return EMPTY;
  }
}

export function saveTourProgress(repoId: string, progress: TourProgress): void {
  localStorage.setItem(storageKey(repoId), JSON.stringify(progress));
}
