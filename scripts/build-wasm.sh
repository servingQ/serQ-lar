#!/usr/bin/env bash
# Build serQ for the browser: crates/serq-wasm -> web/src/wasm/.
# Expects serQ checked out next to this repository (../serQ), at SERQ_REF
# in CI; locally, whatever ../serQ holds.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
cargo build --release --target wasm32-unknown-unknown -p serq-wasm
wasm-bindgen --target web --out-dir web/src/wasm \
  target/wasm32-unknown-unknown/release/serq_wasm.wasm
wasm="web/src/wasm/serq_wasm_bg.wasm"
echo "serq_wasm_bg.wasm: $(wc -c <"$wasm") bytes, $(gzip -9 -c "$wasm" | wc -c) gzipped"
