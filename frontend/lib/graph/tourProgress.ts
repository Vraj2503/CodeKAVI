import type { TourStep } from "@/lib/api";

export interface TourProgress {
  seenSteps: string[];
  answerableQuestions: string[];
}

const EMPTY: TourProgress = { seenSteps: [], answerableQuestions: [] };

function storageKey(repoId: string): string {
  return `codekavi-tour-progress-${repoId}`;
}

/** Stable across learn/recall mode switches — keyed by file identity, not order.
 *
 * Every generator emits one step per file, each carrying its own file's
 * layer_id (tour_generator.py:181, 215, 303, 370), so layer_id is NOT unique
 * per step — keying on it first collapsed every file in a layer onto one key,
 * bleeding seen/answerable state across steps. node_ids is the stable
 * per-step identity; layer_id is only a fallback for a file with no node id. */
export function stepKey(step: TourStep): string {
  return step.node_ids.join(",") || (step.layer_id ?? "");
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
