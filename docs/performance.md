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

## The log

Measured on 2026-10-13, serQ `92d9c11` (#602, tagged in v0.1.6-alpha.1), Node 22,
`node scripts/bench.mjs H FILE.sq`: a run with the log (`run_logged`, no
cap) against one without, the JSON's size, and `JSON.parse` of it.

| program | horizon | `run` | `run_logged` | parse | log | events |
|---|---:|---:|---:|---:|---:|---:|
| multi-turn/vllm | 120 s | 52 ms | 70 ms | 32 ms | 4.6 MB | 50 067 |
| pd-disaggregation/llmd_nixl_pull | 120 s | 149 ms | 235 ms | 124 ms | 10.8 MB | 118 482 |
| multi-turn/replica | 120 s | 125 ms | 220 ms | 206 ms | 14.5 MB | 161 528 |
| multi-turn/vllm | 3600 s | 1.4 s | 2.7 s | 2.2 s | 178 MB | 1 912 340 |
| pd-disaggregation/llmd_nixl_pull | 3600 s | 5.0 s | 8.4 s | 4.4 s | 356 MB | 3 846 806 |
| engines/sglang | 3600 s | 3.4 s | 4.7 s | 1.6 s | 177 MB | 1 810 668 |

With the `series` the metrics board reads (every sample of the client
metrics and observes, every gauge's change point, added to `run_logged`'s
JSON by `crates/serq-wasm`), measured on 2026-10-14, serQ `6666dc4`
(v0.1.6-alpha.1 and one commit), the same command at 120 s: `vllm` logged
73 ms, 4.6 MB; `llmd_nixl_pull` logged 261 ms, 11.4 MB. The series is
about a tenth of the log; the wasm grew 1.4 % (1 748 166 bytes, 580 771
gzipped).

The log costs about as much as the run again, most of it writing JSON, and
the events are almost all iterations (`iter`, one per engine step, with its
batch). A replay plays tens of seconds, not an hour: at 120 s the page has
its log in a quarter of a second. The cap (400 000 events, `LOG_CAP` in
`web/src/main.ts`) keeps a long horizon from handing the page a 300 MB
string; a columnar encoding (U5 in [upstream.md](upstream.md)) would cut
both the size and the parse.
