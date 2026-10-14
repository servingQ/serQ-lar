#!/usr/bin/env bash
# Copy the serQ programs the app offers into web/src/examples/.
# A program that reads a trace file cannot run in the browser.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
serq="$("$root/scripts/serq-dir.sh")"
out="$root/web/src/examples"
mkdir -p "$out"
for f in \
  multi-turn/vllm.sq multi-turn/replica.sq multi-turn/routing.sq \
  multi-turn/thunderagent.sq pd-disaggregation/llmd_nixl_pull.sq \
  engines/sglang.sq single-turn/mg1.sq single-turn/vllm_single_turn.sq; do
  cp "$serq/examples/$f" "$out/$(basename "$f")"
done
echo "copied $(ls "$out" | wc -l) programs from $serq"
