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

  # Recreate bin/ from scratch so stale binaries from older layouts are never published.
  rm -rf "$pkg_dir/bin"
  mkdir -p "$pkg_dir/bin"
  cp "$ARTIFACTS/cz-cli-${platform}/bin/cz-cli" "$pkg_dir/bin/cz-cli"
  chmod +x "$pkg_dir/bin/cz-cli"

  # Copy skills if present
  if [ -d "$ARTIFACTS/cz-cli-${platform}/skills" ]; then
    rm -rf "$pkg_dir/bin/skills"
    cp -r "$ARTIFACTS/cz-cli-${platform}/skills" "$pkg_dir/bin/skills"
  fi

  # Publish (tolerate "already published" from partial prior runs)
  if [ -n "$DRY_RUN" ]; then
    echo "  [dry-run] npm publish --access public"
  else
    set +e
    publish_output=$(cd "$pkg_dir" && npm publish --access public 2>&1)
    publish_rc=$?
    set -e
    if [ $publish_rc -ne 0 ]; then
      if echo "$publish_output" | grep -q "cannot publish over the previously published"; then
        echo "  ⚠ Already published @clickzetta/cz-cli-${platform}@${VERSION}, skipping."
      else
        echo "$publish_output" >&2
        exit $publish_rc
      fi
    fi
  fi
  echo ""
done

# ── Publish main package ──────────────────────────────────────────────────

echo "── @clickzetta/cz-cli (main) ──"
update_main_pkg

if [ -n "$DRY_RUN" ]; then
  echo "  [dry-run] npm publish --access public"
else
  set +e
  publish_output=$(cd "$NPM_DIR/cz-cli" && npm publish --access public 2>&1)
  publish_rc=$?
  set -e
  if [ $publish_rc -ne 0 ]; then
    if echo "$publish_output" | grep -q "cannot publish over the previously published"; then
      echo "  ⚠ Already published @clickzetta/cz-cli@${VERSION}, skipping."
    else
      echo "$publish_output" >&2
      exit $publish_rc
    fi
  fi
fi

echo ""
echo "✓ Published @clickzetta/cz-cli@${VERSION}"

# ── Version bump note ─────────────────────────────────────────────────────
# package.json uses placeholder versions (0.1.0). The publish script injects
# the real version at publish time. No commit back to the repo is needed.
