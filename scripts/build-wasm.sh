#!/usr/bin/env bash
# Build serQ for the browser: crates/serq-wasm -> web/src/wasm/.
# serQ is the tag crates/serq-wasm/Cargo.toml names. With SERQ_DIR set, it is
# that checkout instead (local work on serQ): Cargo patches the git
# dependency with the path, and the committed Cargo.lock is put back after.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
if [ -n "${SERQ_DIR:-}" ]; then
  serq="$(cd "$SERQ_DIR" && pwd)"
  lock="$(mktemp)"
  cp Cargo.lock "$lock"
  trap 'cp "$lock" Cargo.lock; rm -f "$lock"' EXIT
  cargo build --release --target wasm32-unknown-unknown -p serq-wasm \
    --config "patch.\"https://github.com/servingQ/serQ\".serq.path=\"$serq\""
  echo "built against $serq"
else
  cargo build --release --target wasm32-unknown-unknown -p serq-wasm --locked
fi
wasm-bindgen --target web --out-dir web/src/wasm \
  target/wasm32-unknown-unknown/release/serq_wasm.wasm
wasm="web/src/wasm/serq_wasm_bg.wasm"
echo "serq_wasm_bg.wasm: $(wc -c <"$wasm") bytes, $(gzip -9 -c "$wasm" | wc -c) gzipped"
