#!/usr/bin/env bash
# Copy the serQ examples the app offers into web/src/examples/: each a
# deployment (deployments/), the workloads it can run under (workloads/),
# and which workload each deployment starts under (pairs.json, from serQ's
# examples/pairs.json). A workload that reads a trace file cannot run in the
# browser, which has no file system.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
serq="$("$root/scripts/serq-dir.sh")"
out="$root/web/src/examples"
rm -rf "$out"
mkdir -p "$out/deployments" "$out/workloads"
programs=(
  multi-turn/vllm.sq multi-turn/replica.sq multi-turn/routing.sq
  multi-turn/thunderagent.sq pd-disaggregation/llmd_nixl_pull.sq
  engines/sglang.sq single-turn/mg1.sq
)
for f in "${programs[@]}"; do
  cp "$serq/examples/$f" "$out/deployments/$(basename "$f")"
done
for w in "$serq"/examples/workloads/*.sq; do
  grep -qE '^\s*trace\s' "$w" || cp "$w" "$out/workloads/"
done
# each deployment's workload, by file stem
node -e '
  const [pairs, out, ...programs] = process.argv.slice(1);
  const all = JSON.parse(require("fs").readFileSync(pairs, "utf8"));
  const stem = (p) => p.replace(/^.*\//, "").replace(/\.sq$/, "");
  const ours = {};
  for (const p of programs) {
    // one workload, or several, the first the one it starts with
    const listed = all[`examples/${p}`];
    const w = Array.isArray(listed) ? listed[0] : listed;
    if (!w) throw new Error(`examples/pairs.json pairs no workload with examples/${p}`);
    if (!require("fs").existsSync(`${out.replace(/pairs\.json$/, "")}workloads/${stem(w)}.sq`))
      throw new Error(`${w}, the workload of examples/${p}, reads a trace: the page cannot run it`);
    ours[stem(p)] = stem(w);
  }
  require("fs").writeFileSync(out, JSON.stringify(ours, null, 2) + "\n");
' "$serq/examples/pairs.json" "$out/pairs.json" "${programs[@]}"
echo "copied $(ls "$out"/deployments | wc -l) deployments and $(ls "$out"/workloads | wc -l) workloads from $serq"
