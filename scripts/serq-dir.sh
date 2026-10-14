#!/usr/bin/env bash
# Print where the serQ this repository builds against lives: $SERQ_DIR when
# set (local work against a serQ checkout, build-wasm.sh), else Cargo's
# checkout of the tag in crates/serq-wasm/Cargo.toml.
set -euo pipefail
if [ -n "${SERQ_DIR:-}" ]; then
  cd "$SERQ_DIR" && pwd
  exit
fi
cd "$(dirname "$0")/.."
cargo metadata --format-version 1 --locked |
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const p = JSON.parse(s).packages.find((p) => p.name === "serq");
    console.log(require("node:path").dirname(p.manifest_path));
  });'
