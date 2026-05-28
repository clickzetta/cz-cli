#!/bin/sh
set -e

CHANNEL="${CZ_CHANNEL:-stable}"
DEFAULT_INSTALL_URL="https://cz-cli.ai/install.sh"
if [ "$CHANNEL" = "latest" ]; then
  DEFAULT_INSTALL_URL="https://cz-cli.ai/install/latest.sh"
fi
INSTALL_URL="${CZ_INSTALL_URL:-$DEFAULT_INSTALL_URL}"
TEMP_DIR=$(mktemp -d)
SCRIPT_PATH="${TEMP_DIR}/bootstrap.sh"

cleanup() {
  [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

download() {
  if command -v curl > /dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
    return
  fi
  if command -v wget > /dev/null 2>&1; then
    wget -qO "$2" "$1"
    return
  fi
  echo "Error: curl or wget is required" >&2
  exit 1
}

download "$INSTALL_URL" "$SCRIPT_PATH"
chmod +x "$SCRIPT_PATH"

NON_INTERACTIVE="${NON_INTERACTIVE:-}" \
SKIP_PATH_PROMPT="${SKIP_PATH_PROMPT:-}" \
INSTALL_DIR="${INSTALL_DIR:-}" \
sh "$SCRIPT_PATH"
