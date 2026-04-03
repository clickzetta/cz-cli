.PHONY: help clean test build build-fat install upload dev lint format

help:
	@echo "cz-cli Makefile commands:"
	@echo "  make clean      - Remove build artifacts and cache files"
	@echo "  make test       - Run pytest tests"
	@echo "  make lint       - Run code linting (ruff)"
	@echo "  make format     - Format code (ruff format)"
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

test:
	@echo "🧪 Running tests..."
	python -m pytest tests/ -v
	@echo "✅ Tests complete"

lint:
	@echo "🔍 Running linter..."
	python -m ruff check cz_cli/ tests/
	@echo "✅ Lint complete"

format:
	@echo "✨ Formatting code..."
	python -m ruff format cz_cli/ tests/
	@echo "✅ Format complete"

build: clean
	@echo "📦 Building distribution packages..."
	python -m build
	@echo "✅ Build complete"
	@ls -lh dist/

build-fat:
	@echo "📦 Building standalone binaries (multi-version)..."
	bash scripts/build_fat_multi_platform.sh
	@echo "✅ Standalone binaries build complete"

install:
	@echo "📥 Installing in editable mode..."
	pip install -e .
	@echo "✅ Install complete"

dev:
	@echo "📥 Installing with dev dependencies..."
	pip install -e ".[dev]"
	@echo "✅ Dev install complete"

upload: build
	@echo "📤 Uploading to PyPI..."
	@echo "⚠️  Make sure you have configured your PyPI credentials!"
	python -m twine upload dist/*
	@echo "✅ Upload complete"

upload-test: build
	@echo "📤 Uploading to TestPyPI..."
	python -m twine upload --repository testpypi dist/*
	@echo "✅ Upload to TestPyPI complete"

all: clean test build
	@echo "✅ All tasks complete"

verify: test lint
	@echo "✅ Verification complete"
