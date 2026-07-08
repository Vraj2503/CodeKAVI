#!/usr/bin/env python3
"""
Drives the CodeKAVI /api/analyze/stream pipeline end-to-end against a small
public fixture repo and reports which stages completed.

Usage:
    python3 check_pipeline.py [--repo-url URL] [--backend-url URL] [--no-cleanup]
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

try:
    import jwt
except ImportError:
    print("PyJWT is required. Install it with: pip install pyjwt", file=sys.stderr)
    sys.exit(1)

try:
    import requests
except ImportError:
    print(
        "requests is required. Install it with: pip install requests", file=sys.stderr
    )
    sys.exit(1)

DEFAULT_REPO = "https://github.com/navdeep-G/samplemod"
DEFAULT_BACKEND = "http://localhost:8000"

# progress% -> human label, in the order the backend is expected to emit them.
# "indexing" only fires if GEMINI_API_KEY + ZILLIZ_URI are configured, so it's optional.
EXPECTED_STAGES = [
    (10, "cloning", False),
    (25, "traversing", False),
    (40, "analyzing (dependencies)", False),
    (60, "analyzing (classifying roles)", False),
    (70, "graphing", False),
    (80, "selecting", False),
    (90, "indexing", True),
    (100, "complete", False),
]


def repo_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        capture_output=True,
        text=True,
        check=True,
    )
    return Path(out.stdout.strip())


def load_env(env_path: Path) -> dict:
    values = {}
    if not env_path.exists():
        return values
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip()
    return values


def mint_token(jwt_secret: str) -> str:
    now = int(time.time())
    payload = {
        "sub": "pipeline-check",
        "role": "authenticated",
        "iat": now,
        "exp": now + 3600,
    }
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-url", default=DEFAULT_REPO, help="Public repo URL to analyze"
    )
    parser.add_argument(
        "--backend-url", default=DEFAULT_BACKEND, help="Base URL of the running backend"
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Skip DELETE /cleanup/{repo_id} at the end",
    )
    args = parser.parse_args()

    root = repo_root()
    env = load_env(root / "backend" / ".env")
    jwt_secret = env.get("SUPABASE_JWT_SECRET")
    if not jwt_secret:
        print(
            "SUPABASE_JWT_SECRET not found in backend/.env — cannot mint a test token. "
            "Set it (any value that matches the backend's config) and re-run.",
            file=sys.stderr,
        )
        return 1

    health_url = f"{args.backend_url}/api/health"
    try:
        resp = requests.get(health_url, timeout=5)
        resp.raise_for_status()
    except Exception as e:
        print(f"Backend not reachable at {health_url} ({e}).")
        print(
            "Start it first: cd backend && make run   (or: docker compose up backend redis)"
        )
        return 1
    print(f"[ok] backend healthy at {args.backend_url}")

    token = mint_token(jwt_secret)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {"github_url": args.repo_url}

    print(f"[ok] POST /api/analyze/stream  github_url={args.repo_url}")
    seen = {}
    repo_id = None
    error_message = None
    start = time.time()

    try:
        with requests.post(
            f"{args.backend_url}/api/analyze/stream",
            headers=headers,
            json=body,
            stream=True,
            timeout=180,
        ) as r:
            r.raise_for_status()
            for raw_line in r.iter_lines(decode_unicode=True):
                if not raw_line or not raw_line.startswith("data: "):
                    continue
                payload = json.loads(raw_line[len("data: ") :])
                stage, progress, message = (
                    payload.get("stage"),
                    payload.get("progress"),
                    payload.get("message"),
                )
                elapsed = time.time() - start
                if stage == "error":
                    error_message = message
                    print(f"  [{elapsed:6.1f}s] ✘ error ({progress}%): {message}")
                    break
                seen[progress] = (stage, message)
                print(f"  [{elapsed:6.1f}s] ✓ {stage} ({progress}%): {message}")
                if stage == "complete":
                    result = (payload.get("data") or {}).get("result") or {}
                    repo_id = result.get("repo_id")
    except Exception as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return 1

    print()
    if error_message:
        print(f"FAILED: pipeline reported an error stage: {error_message}")
        return 1

    missing = [
        label
        for pct, label, optional in EXPECTED_STAGES
        if pct not in seen and not optional
    ]
    if missing:
        print(f"FAILED: pipeline stopped early — missing stages: {', '.join(missing)}")
        return 1

    print(
        f"PASSED: all pipeline stages completed in {time.time() - start:.1f}s (repo_id={repo_id})"
    )

    if repo_id and not args.no_cleanup:
        try:
            requests.delete(
                f"{args.backend_url}/api/cleanup/{repo_id}", headers=headers, timeout=10
            )
            print(f"[ok] cleaned up repo_id={repo_id}")
        except Exception as e:
            print(f"[warn] cleanup failed (non-fatal): {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
