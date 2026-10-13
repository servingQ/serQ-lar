// serQ runs here, off the page's thread: a run of an hour's horizon takes
// seconds (docs/performance.md), and the page must keep animating.

import init, { draw, ir, run, stages, version } from "./wasm/serq_wasm.js";
import wasmUrl from "./wasm/serq_wasm_bg.wasm?url";

export type Request =
  | { id: number; cmd: "version" }
  | { id: number; cmd: "draw" | "ir" | "stages"; src: string }
  | { id: number; cmd: "run"; src: string; horizon?: number; seed?: number };

export type Response = { id: number; ok: true; value: string; ms: number } | { id: number; ok: false; error: string };

const ready = init({ module_or_path: wasmUrl });

self.onmessage = async (m: MessageEvent<Request>) => {
  const q = m.data;
  await ready;
  const t0 = performance.now();
  try {
    let value: string;
    switch (q.cmd) {
      case "version":
        value = version();
        break;
      case "draw":
        value = draw(q.src);
        break;
      case "stages":
        value = stages(q.src);
        break;
      case "ir":
        value = ir(q.src);
        break;
      case "run":
        value = run(q.src, q.horizon, q.seed === undefined ? undefined : BigInt(q.seed));
        break;
    }
    self.postMessage({ id: q.id, ok: true, value, ms: performance.now() - t0 } satisfies Response);
  } catch (e) {
    self.postMessage({ id: q.id, ok: false, error: String((e as Error).message ?? e) } satisfies Response);
  }
};
