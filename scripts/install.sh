#!/bin/sh
# cz-cli installer — installs via npm (recommended).
# Usage:
#   curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh
#
# Environment variables:
#   CZ_VERSION          — pin a specific version (e.g. "0.3.62"); default: latest
#   NON_INTERACTIVE     — skip all prompts (set to any non-empty value)

set -e

NPM_PACKAGE="@clickzetta/cz-cli"
REGISTRY="https://registry.npmjs.org"

print_success() { echo "✓ $1"; }
print_error()   { echo "Error: $1" >&2; }

# ── Check prerequisites ───────────────────────────────────────────────────

if ! command -v npm > /dev/null 2>&1; then
  print_error "npm is required but not installed."
  echo "Install Node.js from https://nodejs.org/ or via your package manager, then retry."
  exit 1
fi

# ── Clean up outdated standalone binaries ─────────────────────────────────

cleanup_outdated() {
  local paths
  paths=$(which -a cz-cli 2>/dev/null || true)
  if [ -z "$paths" ]; then return; fi

  echo "$paths" | while IFS= read -r p; do
    # Skip npm/bun managed paths
    case "$p" in
      *node_modules*|*.bun*) continue ;;
    esac
    echo "Found outdated cz-cli binary: $p"
    rm -f "$p" 2>/dev/null && print_success "Removed $p" || echo "  Could not remove $p (try: sudo rm $p)"
  done
}

cleanup_outdated

# ── Install via npm ───────────────────────────────────────────────────────

VERSION_SPEC="latest"
if [ -n "$CZ_VERSION" ]; then
  VERSION_SPEC="$CZ_VERSION"
  echo "Installing cz-cli@${VERSION_SPEC} ..."
else
  echo "Installing cz-cli@latest ..."
fi

npm install -g "${NPM_PACKAGE}@${VERSION_SPEC}" --registry "$REGISTRY" --ignore-scripts=false

print_success "cz-cli installed successfully."
echo ""
echo "Try: cz-cli --help"
