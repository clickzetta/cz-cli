#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Keep PyInstaller cache inside workspace to avoid host permission issues.
export PYINSTALLER_CONFIG_DIR="${ROOT_DIR}/.pyinstaller-cache"
mkdir -p "${PYINSTALLER_CONFIG_DIR}"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Python is not installed in PATH."
  exit 1
fi

if ! "${PYTHON_BIN}" -m PyInstaller --version >/dev/null 2>&1; then
  echo "PyInstaller is not installed. Run: pip install pyinstaller"
  exit 1
fi

read_current_version() {
  "${PYTHON_BIN}" - <<'PY'
from cz_cli.version import __version__
print(__version__)
PY
}

set_version() {
  local new_version="$1"
  "${PYTHON_BIN}" - "$new_version" <<'PY'
import pathlib
import re
import sys

new_version = sys.argv[1]
version_file = pathlib.Path("cz_cli/version.py")
content = version_file.read_text(encoding="utf-8")
pattern = r'__version__\s*=\s*["\'][^"\']+["\']'
if not re.search(pattern, content):
    raise SystemExit("Failed to update cz_cli/version.py")
updated = re.sub(pattern, f'__version__ = "{new_version}"', content, count=1)
if content != updated:
    version_file.write_text(updated, encoding="utf-8")
PY
}

split_versions() {
  local raw="$1"
  raw="${raw//,/ }"
  # shellcheck disable=SC2206
  local arr=($raw)
  printf "%s\n" "${arr[@]}"
}

ORIGINAL_VERSION="$(read_current_version)"
VERSIONS_RAW="${CZ_VERSIONS:-$ORIGINAL_VERSION}"
VERSIONS=()
for version_item in $(split_versions "$VERSIONS_RAW"); do
  VERSIONS+=("$version_item")
done

if [[ ${#VERSIONS[@]} -eq 0 ]]; then
  echo "No versions provided. Set CZ_VERSIONS, e.g. CZ_VERSIONS='0.1.0 0.1.1'"
  exit 1
fi

restore_original_version() {
  set_version "$ORIGINAL_VERSION" >/dev/null 2>&1 || true
}
trap restore_original_version EXIT

OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"

case "$OS_NAME" in
  Darwin)
    PLATFORM_TAG="macos"
    BIN_EXT=""
    ;;
  Linux)
    PLATFORM_TAG="linux"
    BIN_EXT=""
    ;;
  MINGW* | MSYS* | CYGWIN*)
    PLATFORM_TAG="windows"
    BIN_EXT=".exe"
    ;;
  *)
    echo "Unsupported OS: $OS_NAME"
    exit 1
    ;;
esac

case "$ARCH_NAME" in
  x86_64 | amd64)
    ARCH_TAG="x86_64"
    ;;
  arm64 | aarch64)
    ARCH_TAG="arm64"
    ;;
  *)
    ARCH_TAG="$ARCH_NAME"
    ;;
esac

TARGET_DIR_NAME="${CZ_DIST_DIR:-${PLATFORM_TAG}-${ARCH_TAG}}"
LEGACY_BIN="dist/cz-cli-${PLATFORM_TAG}-${ARCH_TAG}${BIN_EXT}"

for version in "${VERSIONS[@]}"; do
  if [[ -z "$version" ]]; then
    continue
  fi

  echo "==> Building version: $version"
  set_version "$version"

  "${PYTHON_BIN}" -m PyInstaller --noconfirm --clean pyinstaller/cz-cli.spec

  SOURCE_BIN="dist/cz-cli${BIN_EXT}"
  VERSION_TAG="${version//\//-}"
  TARGET_DIR="dist/${VERSION_TAG}/${TARGET_DIR_NAME}"
  TARGET_BIN="${TARGET_DIR}/cz-cli${BIN_EXT}"

  if [[ ! -f "$SOURCE_BIN" ]]; then
    echo "Expected output file not found: $SOURCE_BIN"
    exit 1
  fi

  mkdir -p "$TARGET_DIR"
  rm -f "$TARGET_BIN"
  rm -f "$LEGACY_BIN"
  mv -f "$SOURCE_BIN" "$TARGET_BIN"
  echo "Built standalone binary: $TARGET_BIN"
done

echo "All requested versions built successfully."
