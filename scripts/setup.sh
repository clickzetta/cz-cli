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
