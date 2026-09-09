#!/bin/sh
# Exercise the shipped Linux x64 executable on a CPU model with SSE4.2 but no AVX.
set -eu

BINARY="${1:?Usage: check-baseline.sh <linux-x64-binary>}"
export CLICKZETTA_DISABLE_AUTOUPDATE=1

for command in version help; do
  timeout 120 qemu-x86_64 -cpu Nehalem "$BINARY" "--$command"
done
timeout 120 qemu-x86_64 -cpu Nehalem "$BINARY" agent --help
