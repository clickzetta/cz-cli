.PHONY: help clean test test-unit test-integration build build-fat install upload dev lint format generate-skills

help:
	@echo "cz-cli Makefile commands:"
	@echo "  make clean      - Remove build artifacts and cache files"
	@echo "  make test       - Run unit + integration tests (default)"
	@echo "  make test-unit  - Run unit tests only (exclude integration)"
	@echo "  make test-integration - Run real Studio integration tests only"
	@echo "  make lint       - Run code linting (ruff)"
	@echo "  make format     - Format code (ruff format)"
	@echo "  make generate-skills - Regenerate bundled SKILL.md from Click command tree"
	@echo "  make build      - Build distribution packages"
	@echo "  make build-fat  - Build standalone binaries (supports multi-version)"
	@echo "  make install    - Install package in editable mode"
	@echo "  make dev        - Install with dev dependencies"
	@echo "  make upload     - Upload to PyPI (requires credentials)"
	@echo "  make all        - Run clean, test, build"

clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info
	rm -rf cz_cli.egg-info/
	rm -rf .pytest_cache/
	rm -rf .ruff_cache/
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	@echo "✅ Clean complete"

test: test-unit test-integration
	@echo "✅ Tests complete (unit + integration)"

test-it: test-integration
	@echo "✅ Tests complete (integration)"

test-unit:
	@echo "🧪 Running unit tests..."
	python -m pytest tests/ -v -m "not integration"
	@echo "✅ Unit tests complete"

test-integration:
	@echo "🧪 Running integration tests..."
	CZ_RUN_INTEGRATION=1 CZ_IT_PROFILE=$${CZ_IT_PROFILE:-dev} CZ_IT_DEBUG=$${CZ_IT_DEBUG:-1} python -m pytest tests/integration/test_studio_integration.py -v -s
	@echo "✅ Integration tests complete"

lint:
	@echo "🔍 Running linter..."
	python -m ruff check cz_cli/ tests/
	@echo "✅ Lint complete"

format:
	@echo "✨ Formatting code..."
	python -m ruff format cz_cli/ tests/
	@echo "✅ Format complete"

generate-skills:
	@echo "🧩 Generating bundled skill docs..."
	python scripts/generate_skills.py
	@echo "✅ Skill docs generated"

build-pkg: clean generate-skills
	@echo "📦 Building distribution packages..."
	python -m build
	@echo "✅ Build complete"
	@ls -lh dist/

build-fat: generate-skills
	@echo "📦 Building standalone binaries (multi-version)..."
	bash scripts/build_fat_multi_platform.sh
	@echo "✅ Standalone binaries build complete"

build: build-pkg build-fat
	@echo "✅ All builds complete"

install:
	@echo "📥 Installing in editable mode..."
	pip uninstall cz-cli && pip install -e ".[dev]"
	@echo "✅ Install complete"

upload: build
	@echo "📤 Uploading to PyPI..."
	@echo "Notice:  Make sure you have configured your PyPI credentials!"
	python -m twine upload dist/*
	@echo "✅ Upload complete"

upload-test: build
	@echo "📤 Uploading to TestPyPI..."
	python -m twine upload --repository testpypi dist/*
	@echo "✅ Upload to TestPyPI complete"

all: clean format test verify build
	@echo "✅ All tasks complete"

verify: test lint
	@echo "✅ Verification complete"
