#!/bin/bash
# Publish @clickzetta/cz-cli and platform packages to npm.
#
# Usage:
#   scripts/npm-publish.sh <version> <artifacts-dir>
#
# <artifacts-dir> should contain the built binaries:
#   cz-cli-darwin-arm64/bin/cz-cli
#   cz-cli-darwin-x64/bin/cz-cli
#   cz-cli-linux-arm64/bin/cz-cli
#   cz-cli-linux-x64/bin/cz-cli
#   cz-cli-win32-x64/bin/cz-cli.exe
#
# Environment:
#   NPM_TOKEN — npm auth token (required)
#   DRY_RUN   — set to "1" to skip actual publish

set -euo pipefail

VERSION="${1:?Usage: npm-publish.sh <version> <artifacts-dir>}"
ARTIFACTS="${2:?Usage: npm-publish.sh <version> <artifacts-dir>}"
DRY_RUN="${DRY_RUN:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NPM_DIR="$REPO_ROOT/packages/npm"

PLATFORMS=(
  "darwin-arm64"
  "darwin-x64"
  "linux-arm64"
  "linux-x64"
  "win32-x64"
)

echo "Publishing @clickzetta/cz-cli v${VERSION}"
echo "Artifacts: $ARTIFACTS"
echo ""

# ── Set version in all package.json files ─────────────────────────────────

set_version() {
  local pkg="$1"
  local tmp
  tmp=$(mktemp)
  sed "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" "$pkg" > "$tmp"
  mv "$tmp" "$pkg"
}

# Update main package optionalDependencies versions too
update_main_pkg() {
  local pkg="$NPM_DIR/cz-cli/package.json"
  local tmp
  tmp=$(mktemp)
  sed "s/\"@clickzetta\/cz-cli-\([^\"]*\)\": \"[^\"]*\"/\"@clickzetta\/cz-cli-\1\": \"${VERSION}\"/g" "$pkg" > "$tmp"
  sed "s/\"version\": \".*\"/\"version\": \"${VERSION}\"/" "$tmp" > "$pkg"
  rm -f "$tmp"
}

# ── Publish platform packages ─────────────────────────────────────────────

for platform in "${PLATFORMS[@]}"; do
  pkg_dir="$NPM_DIR/cz-cli-${platform}"
  echo "── @clickzetta/cz-cli-${platform} ──"

  set_version "$pkg_dir/package.json"

  # Copy binary
  mkdir -p "$pkg_dir/bin"
  if [ "$platform" = "win32-x64" ]; then
    cp "$ARTIFACTS/cz-cli-${platform}/bin/cz-cli.exe" "$pkg_dir/bin/cz-cli.exe"
  else
    cp "$ARTIFACTS/cz-cli-${platform}/bin/cz-cli" "$pkg_dir/bin/cz-cli"
    chmod +x "$pkg_dir/bin/cz-cli"
  fi

  # Publish
  if [ -n "$DRY_RUN" ]; then
    echo "  [dry-run] npm publish --access public"
  else
    (cd "$pkg_dir" && npm publish --access public)
  fi
  echo ""
done

# ── Publish main package ──────────────────────────────────────────────────

echo "── @clickzetta/cz-cli (main) ──"
update_main_pkg

if [ -n "$DRY_RUN" ]; then
  echo "  [dry-run] npm publish --access public"
else
  (cd "$NPM_DIR/cz-cli" && npm publish --access public)
fi

echo ""
echo "✓ Published @clickzetta/cz-cli@${VERSION}"
