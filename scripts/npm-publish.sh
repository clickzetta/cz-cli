#!/bin/bash
# Publish @clickzetta/cz-cli and platform packages to npm.
#
# Usage:
#   scripts/npm-publish.sh <version> <artifacts-dir>
#
# <artifacts-dir> should contain the built binaries:
#   cz-cli-darwin-arm64/bin/cz-cli
#   cz-cli-darwin-x64/bin/cz-cli
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

PUBLISH_ARGS=(
  --access public
)

if [[ "$VERSION" == *-dev* ]]; then
  PUBLISH_ARGS+=(--tag dev)
fi

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
  PLATFORMS_CSV="$(IFS=,; echo "${PLATFORMS[*]}")" VERSION="$VERSION" PACKAGE_JSON="$pkg" node <<'EOF'
const fs = require("fs")

const pkgPath = process.env.PACKAGE_JSON
const version = process.env.VERSION
const platforms = (process.env.PLATFORMS_CSV || "").split(",").filter(Boolean)
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))

pkg.version = version
pkg.optionalDependencies = Object.fromEntries(
  platforms.map((platform) => [`@clickzetta/cz-cli-${platform}`, version]),
)

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
EOF
}

# ── Publish platform packages ─────────────────────────────────────────────

for platform in "${PLATFORMS[@]}"; do
  pkg_dir="$NPM_DIR/cz-cli-${platform}"
  artifact_platform="${platform/win32/windows}"
  artifact_dir="$ARTIFACTS/cz-cli-${artifact_platform}"
  echo "── @clickzetta/cz-cli-${platform} ──"

  if [ ! -d "$artifact_dir" ]; then
    echo "  ⚠ Artifact not found at $artifact_dir, skipping platform."
    echo ""
    continue
  fi

  set_version "$pkg_dir/package.json"

  # Recreate bin/ from scratch so stale binaries from older layouts are never published.
  rm -rf "$pkg_dir/bin"
  mkdir -p "$pkg_dir/bin"
  if [ "$platform" = "win32-x64" ]; then
    cp "$artifact_dir/bin/cz-cli.exe" "$pkg_dir/bin/cz-cli.exe" 2>/dev/null || \
      cp "$artifact_dir/bin/cz-cli" "$pkg_dir/bin/cz-cli.exe"
  else
    cp "$artifact_dir/bin/cz-cli" "$pkg_dir/bin/cz-cli"
    chmod +x "$pkg_dir/bin/cz-cli"
  fi

  # Copy bundled skills if present
  if [ -d "$artifact_dir/bin/skills" ]; then
    rm -rf "$pkg_dir/bin/skills"
    cp -r "$artifact_dir/bin/skills" "$pkg_dir/bin/skills"
  fi

  # Ship ClickZetta runtime assets next to the binary. platform.js runs the binary
  # in-place from this package's bin/, so dirname(process.execPath) must contain these
  # or runtime-assets.ts resolveRuntimeModulePath throws "Missing ClickZetta runtime
  # asset" and agent/llm features crash. build.ts emits them into artifact bin/.
  for asset in clickzetta-ai-gateway.js clickzetta-opencode-plugin.js clickzetta-tui-brand.tsx tui-title-brand.ts; do
    if [ -f "$artifact_dir/bin/$asset" ]; then
      cp "$artifact_dir/bin/$asset" "$pkg_dir/bin/$asset"
    fi
  done

  # Publish (tolerate "already published" from partial prior runs)
  if [ -n "$DRY_RUN" ]; then
    echo "  [dry-run] npm publish ${PUBLISH_ARGS[*]}"
  else
    set +e
    publish_output=$(cd "$pkg_dir" && npm publish "${PUBLISH_ARGS[@]}" 2>&1)
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
  echo "  [dry-run] npm publish ${PUBLISH_ARGS[*]}"
else
  set +e
  publish_output=$(cd "$NPM_DIR/cz-cli" && npm publish "${PUBLISH_ARGS[@]}" 2>&1)
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
