---
name: pipeline-check
description: Smoke-test the CodeKAVI /api/analyze/stream pipeline end-to-end against a small public repo and report which stages (cloning, traversing, analyzing, classifying, graphing, selecting, indexing, complete) succeeded. Use after touching backend/codekavi/{analyzer,classifier,graph,indexer,cloner,routes/analyze}.py, or when asked to verify the analysis pipeline / smoke-test the backend.
---

# pipeline-check

Drives the real SSE pipeline instead of relying on unit tests, since the
stages (clone → AST/dependency graph → role classification → embedding →
streaming explanations) only fully integrate at runtime.

## Steps

1. Make sure the backend is running (`cd backend && make run`, or via the
   project's `/run` skill). This skill does not start it for you.
2. Run the checker script from the repo root:

   ```bash
   python3 .claude/skills/pipeline-check/check_pipeline.py
   ```

   Optional flags:
   - `--repo-url <url>` — analyze a different public repo (default is a tiny
     fixture repo, `navdeep-G/samplemod`, to keep it fast and cheap).
   - `--backend-url <url>` — if the backend isn't on `localhost:8000`.
   - `--no-cleanup` — skip the `DELETE /api/cleanup/{repo_id}` call at the end.

3. The script mints its own short-lived Supabase-compatible JWT locally using
   `SUPABASE_JWT_SECRET` from `backend/.env` (HS256, `sub=pipeline-check`) —
   no real Supabase user/session is needed for this check.
4. Report back to the user which stages passed/failed, quoting the stage
   list and elapsed time from the script's output. A missing "indexing"
   stage is expected (not a failure) if `GEMINI_API_KEY` or `ZILLIZ_URI`
   aren't configured in `backend/.env`.
5. If a stage fails, look at the corresponding module before proposing a fix:
   cloning → `codekavi/cloner.py`, traversing → `codekavi/traverser.py`,
   analyzing → `codekavi/analyzer.py`, classifying → `codekavi/classifier.py`,
   graphing → `codekavi/graph.py`, selecting → `codekavi/file_selector.py`,
   indexing → `codekavi/indexer.py` + `codekavi/embedding.py`.

## Requirements

`pyjwt` and `requests` must be importable by the `python3` on PATH (both are
already in `backend/requirements.txt`, so running from an activated
`backend/venv` works, or `pip install pyjwt requests` otherwise).