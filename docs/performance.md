# Is serQ light enough for a static page?

serq-lar has no server: serQ is compiled to WebAssembly (`crates/serq-wasm`)
and runs in the visitor's browser, so the site can be served by GitHub Pages.
The question is whether that is fast enough. Measured on 2026-10-13, serQ
`8a57847` (v0.1.5), Node 22 (V8, Chrome's engine), one core of the dev box.

## Size

| | raw | gzip |
|---|---:|---:|
| `serq_wasm_bg.wasm` (opt-level 3, LTO) | 1.70 MB | 0.57 MB |
| the page's JS + CSS | 41 KB | 13 KB |

GitHub Pages serves gzip. Half a megabyte once, cached afterwards: no problem.
No `wasm-opt` pass yet; it typically takes another 10–20 %.

## Time

`node scripts/bench.mjs 3600 FILE.sq…` against `serq run --horizon 3600`:

| program | turns | `draw` (wasm) | `run` wasm | `run` native | wasm / native |
|---|---:|---:|---:|---:|---:|
| multi-turn/vllm | 9 798 | 12–25 ms | 1.4 s | 0.83 s | 1.7 |
| multi-turn/replica | 10 251 | 1 ms | 8.4 s | 5.4 s | 1.6 |
| pd-disaggregation/llmd_nixl_pull | 18 473 | 3–5 ms | 5.0 s | 3.2 s | 1.6 |
| engines/sglang | 16 948 | 1 ms | 3.3 s | 2.2 s | 1.5 |
| single-turn/fastertransformer | 7 700 | <1 ms | 16.5 s ¹ | 9.5 s | 1.7 |
| single-turn/vllm_single_turn | 10 703 | <1 ms | 2.3 s ¹ | 1.0 s | 2.3 |

¹ measured at opt-level "s"; the others at 3, which is ~1.5× faster.

In Playwright 1.55's headless Chromium (build 1187, same box), the page's
"Run report" on `vllm.sq` at a 600 s horizon: 209–232 ms, in the Web Worker,
while the animation kept playing.

## What it means

- **Drawing is free.** Milliseconds: the deployment view can redraw on every
  keystroke.
- **Animating is cheap.** A visualisation plays tens of seconds of simulated
  time, not an hour; at the rates above that is tens of milliseconds of
  simulation, ahead of playback.
- **Interactive sweeps are not.** A report at a one-hour horizon takes 1.4–16 s
  in the browser. Moving a slider and watching p99 TTFT follow it needs
  well under 100 ms. That is the gap.

The wasm overhead is a steady 1.5–1.7×, so the browser is not the problem:
the native engine is. `replica.sq` spends ~0.5 ms of native CPU per turn, and
`fastertransformer.sq` ~1.2 ms. A discrete-event simulation of a few
thousand requests an hour should be one to two orders of magnitude faster
than that. Where it goes is for a profile to say (`perf record` on
`serq run`), not this document; the suspects are the per-iteration work in
`src/engine/interp.rs` (6 000 lines, re-evaluating expression trees each
event) and allocation in the event loop.

**Target:** a one-hour `vllm.sq` report in under 100 ms in the browser, i.e.
~60 ms native, a 14× improvement. That is the number serq-lar asks of serQ.
