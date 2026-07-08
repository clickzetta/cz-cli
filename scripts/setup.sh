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

# Portable musl install: when this archive carries the musl runtime (bin/lib/)
# AND the system lacks the musl loader (old-glibc distros like CentOS/RHEL 7),
# install the real binary under libexec, point its ELF interpreter at a per-user
# loader via an in-place edit (no file growth -> bun's appended payload stays
# intact), and put a small wrapper on PATH. On Alpine the loader already exists,
# so we fall through to the plain copy below.
MUSL_LOADER_SRC="${SCRIPT_DIR}/lib/ld-musl-x86_64.so.1"
if [ -f "$MUSL_LOADER_SRC" ] && [ ! -e "/lib/ld-musl-x86_64.so.1" ]; then
  LIBEXEC="$(dirname "$INSTALL_DIR")/libexec/cz-cli"
  mkdir -p "$LIBEXEC"
  cp -f "$SOURCE_BINARY" "$LIBEXEC/cz-cli.real"
  chmod +x "$LIBEXEC/cz-cli.real"
  rm -rf "$LIBEXEC/lib"; cp -rf "${SCRIPT_DIR}/lib" "$LIBEXEC/lib"

  OLD="/lib/ld-musl-x86_64.so.1"   # original ELF interpreter, 24 chars
  INTERP=""
  for p in "$HOME/.ld.so" "$HOME/.cz-ld.so" "/tmp/ld-musl-x86_64.so.1"; do
    [ "${#p}" -le 24 ] || continue
    d=$(dirname "$p"); [ -d "$d" ] && [ -w "$d" ] || continue
    INTERP="$p"; break
  done
  [ -n "$INTERP" ] || { print_error "no writable loader path <=24 chars (\$HOME too long?)"; exit 1; }
  echo "ELF interpreter -> $INTERP (${#INTERP} chars)"

  # In-place patch .interp. PT_INTERP lives at a build-fixed offset (568) in the
  # ELF header region; we do NOT scan the whole ~140MB binary. Verify the slot by
  # reading it back; only on mismatch scan the first 64 KiB (headers live at the
  # start). Every write is guarded by a read-back so a wrong offset aborts rather
  # than corrupts.
  BIN="$LIBEXEC/cz-cli.real"
  read_slot() { dd if="$BIN" bs=1 skip="$1" count=24 2>/dev/null; }
  OFF=""
  if [ "$(read_slot 568)" = "$OLD" ]; then
    OFF=568
  else
    HEAD=$(mktemp)
    dd if="$BIN" bs=4096 count=16 of="$HEAD" 2>/dev/null   # first 64 KiB only
    M=$(grep -aboF -- "$OLD" "$HEAD" 2>/dev/null || true); OFF=${M%%:*}
    rm -f "$HEAD"
  fi
  case "$OFF" in
    ''|*[!0-9]*) print_error "musl interpreter string not found in binary"; exit 1 ;;
  esac
  [ "$(read_slot "$OFF")" = "$OLD" ] || { print_error "unexpected bytes at interp offset $OFF"; exit 1; }
  dd if=/dev/zero of="$BIN" bs=1 seek="$OFF" count=24 conv=notrunc 2>/dev/null
  printf '%s' "$INTERP" | dd of="$BIN" bs=1 seek="$OFF" conv=notrunc 2>/dev/null
  [ "$(read_slot "$OFF" | tr -d '\0')" = "$INTERP" ] || { print_error "interp patch verification failed"; exit 1; }

  # Wrapper on PATH: ensure the loader is present, set the lib path, exec the real
  # binary. This becomes $TARGET_BINARY so cz-agent and callers work unchanged.
  cat > "$TARGET_BINARY" <<EOF
#!/bin/sh
LIBEXEC="$LIBEXEC"
INTERP="$INTERP"
[ -f "\$INTERP" ] || cp -f "\$LIBEXEC/lib/ld-musl-x86_64.so.1" "\$INTERP"
export LD_LIBRARY_PATH="\$LIBEXEC/lib\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
exec "\$LIBEXEC/cz-cli.real" "\$@"
EOF
  chmod +x "$TARGET_BINARY"

  # Seed the loader now so the first run is clean, then smoke-test. A failure here
  # is almost always a missing-AVX2 CPU (SIGILL) — surface it at install time.
  [ -f "$INTERP" ] || cp -f "$LIBEXEC/lib/ld-musl-x86_64.so.1" "$INTERP"
  if ! "$TARGET_BINARY" --version >/dev/null 2>&1; then
    print_error "installed binary failed to run (musl portable)."
    print_error "If this CPU lacks AVX2 (grep -c avx2 /proc/cpuinfo == 0) a baseline build is required."
    exit 1
  fi
else
  cp "$SOURCE_BINARY" "$TARGET_BINARY"
  chmod +x "$TARGET_BINARY"

  case "$(uname -s)" in
    Darwin)
      xattr -dr com.apple.quarantine "$TARGET_BINARY" 2>/dev/null || true
      codesign --force --sign - "$TARGET_BINARY" 2>/dev/null || true
      codesign -v --verbose=4 "$TARGET_BINARY" 2>/dev/null || true
      ;;
  esac
fi

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

# Register the cz-cli skill into external agent skill directories so that
# Claude Code / Kiro / Codex / Cursor etc. can call cz-cli directly. Uses
# delete-then-install semantics; the builtin install above is unchanged.
for agent_dir in \
    "$HOME/.claude/skills" \
    "$HOME/.kiro/skills" \
    "$HOME/.cursor/skills" \
    "$HOME/.codex/skills" \
    "$HOME/.openclaw/workspace/skills" \
    "$HOME/.singclaw/workspace/skills"; do
  # Clean up deprecated skill aliases (do not reinstall — folded into cz-cli).
  for legacy in czagent czcli cz-cli-v2; do
    rm -rf "${agent_dir}/${legacy}" 2>/dev/null || true
  done
  # Delete-then-install the cz-cli skill.
  if [ -d "$SKILLS_SRC/cz-cli" ]; then
    mkdir -p "$agent_dir" 2>/dev/null || true
    rm -rf "${agent_dir}/cz-cli" 2>/dev/null || true
    cp -r "$SKILLS_SRC/cz-cli" "${agent_dir}/cz-cli" 2>/dev/null || true
  fi
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
