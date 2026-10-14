// serQ runs here, off the page's thread: a run of an hour's horizon takes
// seconds (docs/performance.md), and the page must keep animating.

import init, { draw, ir, outline, run, run_logged, tokens, vocabulary } from "./wasm/serq_wasm.js";
import wasmUrl from "./wasm/serq_wasm_bg.wasm?url";

export type Request =
  | { id: number; cmd: "vocabulary" }
  /** `workload`: the program is a deployment the tool pairs with this workload file. */
  | { id: number; cmd: "draw" | "ir" | "outline"; src: string; workload?: string }
  | { id: number; cmd: "tokens"; src: string }
  /** `log`: keep the run's log, at most that many events (the report's `log`). */
  | { id: number; cmd: "run"; src: string; workload?: string; horizon?: number; seed?: number; log?: number };

export type Response = { id: number; ok: true; value: string; ms: number } | { id: number; ok: false; error: string };

const ready = init({ module_or_path: wasmUrl });

self.onmessage = async (m: MessageEvent<Request>) => {
  const q = m.data;
  await ready;
  const t0 = performance.now();
  try {
    let value: string;
    switch (q.cmd) {
      case "vocabulary":
        value = vocabulary();
        break;
      case "tokens":
        value = tokens(q.src);
        break;
      case "draw":
        value = draw(q.src, q.workload);
        break;
      case "ir":
        value = ir(q.src, q.workload);
        break;
      case "outline":
        value = outline(q.src, q.workload);
        break;
      case "run": {
        const seed = q.seed === undefined ? undefined : BigInt(q.seed);
        value = q.log === undefined ? run(q.src, q.workload, q.horizon, seed) : run_logged(q.src, q.workload, q.horizon, seed, q.log);
        break;
      }
    }
    self.postMessage({ id: q.id, ok: true, value, ms: performance.now() - t0 } satisfies Response);
  } catch (e) {
    self.postMessage({ id: q.id, ok: false, error: String((e as Error).message ?? e) } satisfies Response);
  }
};
