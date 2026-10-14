#!/usr/bin/env bash
# The figure's edits on serQ's examples (scripts/edits.test.ts), in Node with
# serQ's wasm: each leaves text serQ links and draws. Needs build-wasm.sh and
# sync-examples.sh first, and web/node_modules (esbuild comes with vite).
set -euo pipefail
cd "$(dirname "$0")/.."
out=scripts/.edits.test.mjs

web/node_modules/.bin/esbuild scripts/edits.test.ts --bundle --platform=node --format=esm --log-level=warning \
  --outfile="$out"
# beside the test, so that its paths to the wasm and the examples hold
node "$out"
