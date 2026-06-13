# CodeKavi Backend — Development Targets
# Usage: make <target>

.PHONY: test lint format typecheck run clean install install-dev help

# Default target
help:
	@echo "Available targets:"
	@echo "  make install      Install production dependencies"
	@echo "  make install-dev  Install dev dependencies (testing, linting)"
	@echo "  make test         Run test suite with pytest"
	@echo "  make test-cov     Run tests with coverage report"
	@echo "  make lint         Run ruff linter"
	@echo "  make format       Auto-format code with ruff"
	@echo "  make typecheck    Run mypy type checker"
	@echo "  make run          Start development server"
	@echo "  make clean        Remove caches and build artifacts"
	@echo "  make check        Run lint + typecheck + test (CI pipeline)"

# ── Install ──
install:
	pip install -r requirements.txt

install-dev: install
	pip install -r requirements-dev.txt

# ── Testing ──
test:
	python -m pytest tests/ -v --tb=short

test-cov:
	python -m pytest tests/ -v --tb=short --cov=codekavi --cov-report=term-missing

# ── Linting & Formatting ──
lint:
	python -m ruff check codekavi/ tests/

format:
	python -m ruff check --fix codekavi/ tests/
	python -m ruff format codekavi/ tests/

# ── Type Checking ──
typecheck:
	python -m mypy codekavi/ --ignore-missing-imports

# ── Development Server ──
run:
	python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# ── Cleanup ──
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .mypy_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .ruff_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf htmlcov/ .coverage coverage.xml

# ── CI Pipeline (run all checks) ──
check: lint typecheck test
	@echo "All checks passed!"
