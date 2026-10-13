// Time serQ's wasm build on example programs, in Node (V8, the browser's
// engine), with and without the run log: node scripts/bench.mjs [horizon] FILE.sq...
import { readFileSync } from "node:fs";
import { initSync, run, run_logged, draw, version } from "../web/src/wasm/serq_wasm.js";

initSync({ module: readFileSync(new URL("../web/src/wasm/serq_wasm_bg.wasm", import.meta.url)) });
const [horizon, ...files] = process.argv.slice(2);
console.log(`serq ${version()} (wasm), horizon ${horizon}`);
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const name = f.split("/").slice(-2).join("/");
  try {
    let t = performance.now();
    draw(src);
    const drawMs = performance.now() - t;
    t = performance.now();
    const report = JSON.parse(run(src, Number(horizon), undefined));
    const runMs = performance.now() - t;
    t = performance.now();
    const text = run_logged(src, Number(horizon), undefined, Number.MAX_SAFE_INTEGER);
    const logMs = performance.now() - t;
    t = performance.now();
    const log = JSON.parse(text).log;
    const parseMs = performance.now() - t;
    console.log(
      `${name.padEnd(36)} draw ${drawMs.toFixed(1).padStart(7)} ms  run ${runMs.toFixed(0).padStart(7)} ms  ` +
        `logged ${logMs.toFixed(0).padStart(7)} ms  parse ${parseMs.toFixed(0).padStart(5)} ms  ` +
        `log ${(text.length / 1e6).toFixed(1).padStart(6)} MB ${String(log.events.length).padStart(8)} events  turns ${report.turns}`,
    );
  } catch (e) {
    console.log(`${name.padEnd(36)} error: ${String(e.message ?? e).split("\n")[0]}`);
  }
}
