# Contributing to CodeKAVI

Thank you for your interest in contributing to CodeKAVI! This document outlines guidelines and instructions to help you get started with contributing code, running checks, and submitting changes.

---

## Code Quality Standards

We enforce strict quality control on all codebase updates. Before submitting any pull requests, make sure that:
1. **Linter & Formatter (`ruff`)**: Your code is formatted and has no lint issues.
2. **Type Checker (`mypy`)**: Your code passes static type analysis with strict type constraints.
3. **Test Suite (`pytest`)**: All unit and concurrency tests pass successfully.

---

## Local Development Workflow

### 1. Set up Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

### 2. Verify Your Changes
We provide a `Makefile` in the `backend/` directory to simplify verification checks:

```bash
# Run the complete verification chain (tests, linting, type checks)
make lint typecheck test
```

Individually:
- Run tests: `pytest` or `make test`
- Run linting: `ruff check .` or `make lint`
- Run typecheck: `mypy .` or `make typecheck`

---

## Commits & Code Styles

- **Write Clean Commit Messages**: Prefixes should match standard conventional commits (e.g. `feat: ...`, `fix: ...`, `refactor: ...`, `test: ...`).
- **No Placeholders**: Do not check in code with unfinished `TODO` blocks or placeholders.
- **Thread Safety**: All state caching and executors should be attached to FastAPI's lifespan configuration and injected scoped via dependency injection.
- **Clean Errors**: Wrap external API and Git integrations with custom exceptions (like `CloneError`, `ProviderError`, or `VectorStoreError`) and avoid exposing raw internal system traces to streaming responses.
