#!/bin/sh
# Check CLI startup and argument parsing, not TUI rendering or provider execution.
set -eu

BINARY="${1:?Usage: check-baseline.sh <linux-x64-binary>}"
export CLICKZETTA_DISABLE_AUTOUPDATE=1

# Prove this QEMU invocation rejects AVX before trusting the startup checks.
CONTROL_DIR=$(mktemp -d)
trap 'rm -rf "$CONTROL_DIR"' EXIT
ulimit -c 0
printf '%s\n' 'int main(void) { __asm__ volatile ("vzeroupper"); return 0; }' > "$CONTROL_DIR/avx.c"
cc "$CONTROL_DIR/avx.c" -o "$CONTROL_DIR/avx"
status=0
timeout 10 qemu-x86_64 -cpu Nehalem "$CONTROL_DIR/avx" > "$CONTROL_DIR/output" 2>&1 || status=$?
if [ "$status" -ne 132 ]; then
  cat "$CONTROL_DIR/output" >&2
  echo "AVX control must fail with SIGILL (132), got $status" >&2
  exit 1
fi
echo "AVX control rejected with SIGILL"

for command in version help; do
  timeout 120 qemu-x86_64 -cpu Nehalem "$BINARY" "--$command"
done
timeout 120 qemu-x86_64 -cpu Nehalem "$BINARY" agent --help
