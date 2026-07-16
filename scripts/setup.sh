#!/bin/sh
set -e

BINARY_NAME="${BINARY_NAME:-cz-cli}"
VERSION="${CZ_VERSION:-unknown}"
CHANNEL="${CZ_CHANNEL:-stable}"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/.local/bin}"
METADATA_DIR="${HOME}/.clickzetta"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
SOURCE_BINARY="${SCRIPT_DIR}/${BINARY_NAME}"
TARGET_BINARY="${INSTALL_DIR}/${BINARY_NAME}"
METADATA_FILE="${METADATA_DIR}/install.json"

print_error() {
  echo "Error: $1" >&2
}

if [ ! -f "$SOURCE_BINARY" ]; then
  print_error "binary not found: $SOURCE_BINARY"
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$METADATA_DIR"
cp "$SOURCE_BINARY" "$TARGET_BINARY"
chmod +x "$TARGET_BINARY"

# Ship ClickZetta runtime assets beside the installed binary. The compiled cz-cli
# resolves these from dirname(process.execPath) at runtime (see runtime-assets.ts
# resolveRuntimeModulePath); without them `cz-cli agent`/`agent llm` crash with
# "Missing ClickZetta runtime asset". build.ts emits them into the archive's bin/
# next to the binary, so they sit in $SCRIPT_DIR here. The .tsx/.ts are shipped as
# raw source on purpose (pre-bundling would embed a second @opentui/core).
for asset in clickzetta-ai-gateway.js clickzetta-opencode-plugin.js clickzetta-tui-brand.tsx tui-title-brand.ts; do
  [ -f "${SCRIPT_DIR}/${asset}" ] && cp "${SCRIPT_DIR}/${asset}" "${INSTALL_DIR}/${asset}"
done

case "$(uname -s)" in
  Darwin)
    xattr -dr com.apple.quarantine "$TARGET_BINARY" 2>/dev/null || true
    codesign --force --sign - "$TARGET_BINARY" 2>/dev/null || true
    codesign -v --verbose=4 "$TARGET_BINARY" 2>/dev/null || true
    ;;
esac

# cz-agent: convenience wrapper for `cz-cli agent` (same dir, already on PATH;
# works in any shell and in scripts, unlike a shell alias).
cat > "${INSTALL_DIR}/cz-agent" <<EOF
#!/bin/sh
exec "${TARGET_BINARY}" agent "\$@"
EOF
chmod +x "${INSTALL_DIR}/cz-agent"

SKILLS_SRC="${SCRIPT_DIR}/skills"
BUILTIN_DEST="${HOME}/.clickzetta/skills/.builtin"
rm -rf "$BUILTIN_DEST"
mkdir -p "$BUILTIN_DEST"
if [ -d "$SKILLS_SRC" ]; then
  for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    cp -r "$skill_dir" "$BUILTIN_DEST/$skill_name"
  done
fi

# External AI clients (Claude Code / Cursor / Codex) are no longer wired up by
# auto-installing a skill into their directories. They now integrate via MCP —
# run `cz-cli mcp init` to register cz-cli as an MCP server. Clean up any
# skill (current or deprecated aliases) left by older installers so upgrades
# don't leave a stale cz-cli skill behind.
for agent_dir in \
    "$HOME/.claude/skills" \
    "$HOME/.agents/skills" \
    "$HOME/.kiro/skills" \
    "$HOME/.cursor/skills" \
    "$HOME/.codex/skills" \
    "$HOME/.openclaw/workspace/skills" \
    "$HOME/.singclaw/workspace/skills"; do
  for legacy in cz-cli czagent czcli cz-cli-v2; do
    rm -rf "${agent_dir}/${legacy}" 2>/dev/null || true
  done
done

cat > "$METADATA_FILE" <<EOF
{
  "version": 1,
  "installed_path": "$TARGET_BINARY",
  "channel": "$CHANNEL",
  "binary_version": "$VERSION",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "✓ cz-cli installed to $TARGET_BINARY"
if ! printf '%s' ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  echo "Add $INSTALL_DIR to PATH if cz-cli is not found in a new shell."
fi

# Offer MCP onboarding for external AI clients (Claude Code / Cursor / Codex).
# Interactive TTY → run `cz-cli mcp init` so the user can pick clients now.
# Non-interactive (curl | bash pipe, or NON_INTERACTIVE set) → just print the
# hint; never block or auto-write client configs.
if [ -t 0 ] && [ -t 1 ] && [ -z "${NON_INTERACTIVE:-}" ]; then
  echo ""
  echo "Connect cz-cli to your AI editors (Claude Code / Cursor / Codex)..."
  "$TARGET_BINARY" mcp init || echo "You can run 'cz-cli mcp init' later to configure this."
else
  echo "To use cz-cli in Claude Code / Cursor / Codex, run:  cz-cli mcp init"
fi
