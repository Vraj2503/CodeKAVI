import { useState } from "react";
import {
  loadTourProgress,
  saveTourProgress,
  type TourProgress,
} from "@/lib/graph/tourProgress";

/** E8: persists tour progress to localStorage, keyed by repoId. */
export function useTourProgress(repoId: string) {
  const [repo, setRepo] = useState(repoId);
  const [progress, setProgress] = useState(() => loadTourProgress(repoId));
  if (repo !== repoId) {
    setRepo(repoId);
    setProgress(loadTourProgress(repoId));
  }

  function markSeen(key: string) {
    setProgress((prev) => {
      if (prev.seenSteps.includes(key)) return prev;
      const next = { ...prev, seenSteps: [...prev.seenSteps, key] };
      saveTourProgress(repoId, next);
      return next;
    });
  }

  function toggleAnswerable(key: string) {
    setProgress((prev) => {
      const has = prev.answerableQuestions.includes(key);
      const next = {
        ...prev,
        answerableQuestions: has
          ? prev.answerableQuestions.filter((q) => q !== key)
          : [...prev.answerableQuestions, key],
      };
      saveTourProgress(repoId, next);
      return next;
    });
  }

  return { progress, markSeen, toggleAnswerable };
}
