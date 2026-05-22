#!/bin/sh
# cz-cli setup — installs via npm.
# If you downloaded a release archive manually, this script will install cz-cli
# using npm (recommended) instead of copying the binary directly.
set -e

echo "Installing cz-cli via npm (recommended method)..."
echo ""

if ! command -v npm > /dev/null 2>&1; then
  echo "Error: npm is required but not installed." >&2
  echo "Install Node.js from https://nodejs.org/ or via your package manager, then retry."
  exit 1
fi

# Remove standalone binary if present (avoid conflicts with npm-managed version)
LOCAL_BIN="${HOME}/.local/bin/cz-cli"
if [ -f "$LOCAL_BIN" ] && [ ! -L "$LOCAL_BIN" ]; then
  rm -f "$LOCAL_BIN" 2>/dev/null && echo "✓ Removed outdated standalone binary: $LOCAL_BIN"
fi

npm install -g @clickzetta/cz-cli@latest --registry https://registry.npmjs.org --ignore-scripts=false

echo ""
echo "✓ cz-cli installed successfully."
echo "Try: cz-cli --help"
