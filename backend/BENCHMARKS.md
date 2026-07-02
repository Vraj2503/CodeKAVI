# Classifier Evaluation Benchmarks

This document tracks the precision / recall / F1 of the file role
classifier (`codekavi.classifier.classify_files`) across a set of
labeled ground-truth repositories.

## Ground Truth Dataset

| Repo    | Source                                 | # Labels | Avg. roles coverage |
|---------|----------------------------------------|----------|---------------------|
| fastapi | https://github.com/tiangolo/fastapi    | 25       | 11 distinct roles   |
| express | https://github.com/expressjs/express   | 18       | 8 distinct roles    |
| django  | https://github.com/django/django       | 22       | 9 distinct roles    |
| react   | https://github.com/facebook/react      | 16       | 9 distinct roles    |
| flask   | https://github.com/pallets/flask       | 16       | 9 distinct roles    |
| **Total** |                                      | **97**   | **All 14 roles**    |

The JSON manifest lives at
[`tests/fixtures/classifier_eval/ground_truth.json`](tests/fixtures/classifier_eval/ground_truth.json).
Each entry is a `{repo, path, expected_role}` triple assigned manually
based on filename, path convention, and a quick read of the source.

## Role Aliases (for evaluation)

Several classifier labels are semantically equivalent under different
keys. Before scoring, both the classifier output and the ground-truth
label are projected onto this canonical set:

| Canonical role      | Maps from (classifier / ground-truth)                                                |
|---------------------|--------------------------------------------------------------------------------------|
| `entry_point`       | `entry_point`                                                                        |
| `router`            | `router`                                                                             |
| `config`            | `config`                                                                             |
| `test`              | `test`                                                                               |
| `documentation`     | `documentation`                                                                      |
| `build`             | `build`                                                                              |
| `type_definition`   | `type_definition`                                                                    |
| `data`              | `data`                                                                               |
| `leaf`              | `leaf`                                                                               |
| `shared_utility`    | `shared_utility`, `internal_helper`, `orchestrator`, `core_module`                   |
| `barrel`            | `barrel`                                                                             |

This keeps scores stable when small reshuffles of internal categories
would otherwise bounce the headline metric.

## Running the Eval

```bash
# One-time setup: shallow-clone the eval repos under tests/fixtures/classifier_eval/repos/
python tests/test_classifier_accuracy.py setup

# Run the F1 test (skipped per-repo if the clone is missing):
pytest tests/test_classifier_accuracy.py -v
```

Both Windows + POSIX shells work. On Windows you may need:
```powershell
python tests\test_classifier_accuracy.py setup
pytest tests\test_classifier_accuracy.py -v
```

## Current Scores

See CI output from `pytest tests/test_classifier_accuracy.py -v` for
the latest per-repo macro-F1 and per-role detail. The assertion floor
is `macro_f1 >= 0.6` (see `MACRO_F1_FLOOR` in the test file).

If a score regresses:

1. Look at the per-role F1 grid printed in the failure message.
2. Update `ground_truth.json` if the human label is now wrong (e.g. a
   repo moved config files into `config/`).
3. Otherwise tune `classifier.py` thresholds or expand the role
   candidate path.

## Adding New Labels or Repos

1. Pick the file path inside the chosen repo.
2. Open the file briefly and decide which role it SHOULD get from the
   classifier's perspective.
3. Append `{repo, path, expected_role}` to the appropriate key in
   `ground_truth.json`.
4. Keep each repo at 15-25 entries so the test stays fast (<10s) and
   the per-role score remains interpretable.
