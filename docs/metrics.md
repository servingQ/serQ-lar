# What the metrics board shows

Under the figure, the page lays out the run the way a Prometheus dashboard
lays out a server: a row of the run's numbers, then panels over the run's
time, each one value per window. Every number is serQ's, or counted from
serQ's log; the page only chooses the window. This document lists what is
collected, where each number comes from, and what serQ does not give yet.

## Where the numbers come from

| Source | What it holds | How the page gets it |
|---|---|---|
| **The report** (`serq run --json`, serQ's `docs/reference/cli.md`) | Whole-run statistics: `client.{ttft,tpot,response}` (count, mean, CI, cv², p99), `stages[]` (utilization, prefill/decode/mixed time fractions, iterations, decode batch, inter-token gaps), `pools[]` (mean used, mean queue, mean wait, admissions, preemptions, rejections, evictions), `gauges` (time average, min, max) | `run_logged` in `crates/serq-wasm` |
| **The series** (`series` in `run_logged`'s JSON) | What `--dump` writes and `--json` leaves out: every sample of each client metric and `observe` with its time, session and turn; each gauge's change points | `crates/serq-wasm` reads them off serQ's `Report` (`ObserveReport.records`, `GaugeReport.points`); `web/src/series.ts` mirrors the shape |
| **The log** (`serq run --log`, serQ's `docs/reference/log.md`) | What each session did, when, and each engine iteration with its batch | `web/src/metrics.ts` replays the log's state once, as the player does, and keeps each signal's change points |

## The row of numbers

| Tile | Value | Source |
|---|---|---|
| TTFT, TPOT, Response | the mean; p50, p90, p99 and the count under it | serQ's `client.*` mean, count and p99; **p50 and p90 are the page's**, nearest rank over serQ's samples (serQ reports p99 only, [U6](upstream.md)) |
| Requests | turns answered per second; sessions arrived and ended | the report's `turns`, `arrivals`, `ended` over `end − warmup` |
| Tokens scheduled | tokens per second over every engine iteration | the log's `iter.tokens`, summed; says so when the event cap cut the log |
| Preemptions | preemptions; rejections and cache evictions | the report's `pools[]` counters, summed |
| *engine* busy | utilization; prefill-only, decode-only and mixed time fractions, iterations | the report's `stages[]` row of each step stage (at most four) |

## The panels

One time axis, `[0, horizon]`, cut into windows (the **window** control;
*auto* is about 40 windows, snapped to a round number of seconds). A
sample-based signal shows the samples' quantiles or mean in each window,
with the samples themselves as faint dots behind; a state signal shows the
time-weighted mean of the state over each window, as a scrape interval
would. Hover for every series at a window, click to seek the replay there,
and **table** for the same values as text. The playhead is the replay's
clock.

| Panel | Series | Source | Unit |
|---|---|---|---|
| Time to first token | p50, p90, p99 per window; each turn | serQ's `client.ttft` samples | s |
| Time per output token | the same | `client.tpot` | s |
| Response time | the same | `client.response` | s |
| Requests | arrived, answered, ended, per second | the log's `arrive` and `end` (a session's, not a leg's); `client.response` sample times for *answered* | /s |
| Tokens scheduled | per engine, tokens per second | the log's `iter.tokens`, summed per window | tok/s |
| Batch size | per engine, requests per iteration | the log's `iter.reqs`, mean per window | count |
| Iteration time | per engine | the log's `iter.dur`, mean per window | s |
| Running on *engine* | prefill, decode residents | the log's `run` (with its `mode`) and `done`, time-weighted | count |
| On other stages | per stage: a NIC, a tool | the log's `run` and `done` on non-step stages | count |
| Waiting | per pool, sessions in its queue | the log's `wait` and `admit` (`refuse` and `end` leave the queue too), time-weighted | count |
| Queue wait | per pool, mean wait per admission; each admission | the log: each session's `admit` time less its `wait` time | s |
| Preemptions and refusals | per second | the log's `preempt` and `refuse` | /s |
| Pool usage | per pool, `used / cap` | serQ's gauges named `used_<pool>` (below) and the IR's `cap` | % |
| *gauge name* | the gauge's value | serQ's gauge change points, time-weighted | its own |
| The program's observes | mean per window; each sample | serQ's `observes` samples, one panel per `observe`, folded away | its own |

Pools and stages take the eight categorical colours in the IR's order;
prefill and decode keep the figure's orange and blue; p50 < p90 < p99 is a
light-to-dark ramp of one hue. The colours are validated for colour-vision
deficiency in both themes (the dataviz skill's `validate_palette.js`,
2026-10-14); a legend names every series when there are two or more.

## KV cache and slot usage: a gauge in the program

The log does not carry the units a hold takes (`log.md`, *Not in version
0*), and the report gives a pool's `mean_used` only, so usage over time
exists only where the program declares a `gauge` of it. `llmd_nixl_pull.sq`
declares `kv_usage_max` and `kv_usage_mean`; `vllm.sq` declares none.

For a program that declares none, the board offers **Add pool gauges**: it
appends to the program, where the viewer sees it, one line per pool of
finite capacity,

```serq
  // serq-lar: pool usage, one gauge per pool
  gauge used_kv = used(kv);
  gauge used_reqs = used(reqs);
```

and runs it again. A pool of an array member is named as serQ's aggregate
would write it (`used(D[0].kv)`); the lines were checked against every
program the page offers (serQ v0.1.6-alpha.1, 2026-10-14). A gauge reads
the state and changes nothing (`language.md`, *Gauges*), so the run is the
same with it. This is a stopgap: [U7](upstream.md) asks serQ for a pool's
`used` over time without a declaration.

## What is the page's, and what serQ does not give yet

The page's own computations, each marked here and in the code:

- **The windows** and the time-weighted mean of a state per window
  (`web/src/metrics.ts`), a presentation choice like a scrape interval.
- **p50 and p90**, per window and whole-run, by nearest rank over serQ's
  samples. serQ's `p99` is the report's; the two agree to the rank rule's
  rounding. [U6](upstream.md) asks for `p50` and `p90` in the report.
- **The gauge lines** above.

Not collectable yet, each written up in [upstream.md](upstream.md):

| Wanted | Why not | Ask |
|---|---|---|
| KV usage without editing the program | the log has no units, the report no change points | U7 |
| Prefix-cache fill (`cached` units) over time | no `cached(p)` observable for a gauge; `mean_cached` only | U7 |
| Inter-token latency over time | the report's `mean_itl`, `itl_p50`, `itl_p99` are whole-run; the gaps' rule (across stages, over a preemption) is serQ's to apply | U8 |
| Per-request tokens in an iteration (a chunked prefill's progress) | the log's `iter` has the batch's total | U5 |
| Budget use per iteration (`tokens / tokens cap`) | the IR has the cap as an expression, not a number | U5 |
