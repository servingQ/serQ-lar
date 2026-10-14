# What serq-lar needs from serQ

serq-lar builds against serQ as it is (`SERQ_REF`), with no fork. These are the
changes in serQ that turn its stopgaps into the real thing, in the order they
unblock the app. Each is a serQ issue with a Before/After (serQ's CLAUDE.md,
Issues). The first two have landed; the rest are open.

## U1. A request trace from the engine — landed

serQ [#601](https://github.com/servingQ/serQ/issues/601),
[#602](https://github.com/servingQ/serQ/pull/602): `serq run --log FILE` and
`serq::run_ir_logged(&p, base, cap)` keep the log of the run, what each
session did and when, in the shape of serQ's `docs/reference/log.md`
(version 0). Off by default and costing one branch per event when off; the
report is the same with it. The page runs every program with the log
(`run_logged` in `crates/serq-wasm`) and replays it: `web/src/events.ts`
mirrors the shape, `web/src/player.ts` plays it. The synthetic trace is gone.

## U2. Stage ids in the deployment view — landed

serQ [#603](https://github.com/servingQ/serQ/issues/603),
[#604](https://github.com/servingQ/serQ/pull/604): the SVG groups each
station's shapes under `<g data-stage="P">`, a queue glyph and a drum under
`<g data-pool="P.reqs" data-role="queue|drum">`, and marks the arrival and
exit arrows and the engine's budget bar with `data-role`. Then
[#606](https://github.com/servingQ/serQ/issues/606),
[#607](https://github.com/servingQ/serQ/pull/607): every arrow names the
nodes it joins (`data-from`, `data-to`; a decision is `#0`), so the page
walks a session along the arrows from one station to the next, through
the router's decision, and out and in again for a new turn.
`web/src/anchors.ts` reads them; the label-matching heuristic is gone.

The question of whether to keep using serQ's SVG was settled there too: a
figure-as-JSON that the page draws itself (U5) would re-implement serQ's
writer in TypeScript, which the rules forbid. The SVG is already a DOM; with
ids the page draws over it (the canvas) and moves what it has to (the budget
bar's width). One figure, the same in the docs and the app.

## U3. Deployment view improvements the animation exposes

Found while placing requests on the figure; each is a view change in serQ.

- **Queues are not drawn where requests wait.** "A frame draws none: its
  pools are taken at its entrance" (`docs/visualization/deployment.md`):
  `vllm.sq` has a `queue fifo` on `reqs` and the figure shows no queue
  glyph. The page puts a waiting request at the entrance of the stage the
  pool admits for (`admit_via`, or the engine whose memory it is, read from
  the IR), which is a guess the figure should make instead: a queue glyph
  ahead of a frame, named by its pool.
- **A step engine has no room for its residents.** The budget bar is the
  only thing inside; resident requests are drawn over the glyph under a veil.
  A row of slots sized by `reqs cap` would show occupancy statically too.
- **No source and sink.** The arrival arrow starts at the page edge, and the
  page parks sessions away at a tool (a stage the figure omits) past the
  exit. A source glyph, the `out` sink, and a place for the workload's own
  time (the tool, the think time) would give them a home.
- **A delay folded into a latency label has no station.** `D.nic.latency`
  is a label on the transfer arrow, so a session in it is drawn nowhere
  for 2 ms. Fine at this scale; worth a glyph when the latency is the point.

## U4. Speed

See [performance.md](performance.md): a one-hour report must take under
100 ms in the browser for parameter sweeps to be interactive; it takes
1.4–16 s. The log is cheap next to the run (the table there), but a
one-hour log is ~10⁶ iterations: the page caps it at 400 000 events and
says when it did.

## U5. Small API conveniences

- `rand` with `default-features = false, features = ["std"]` in serQ's
  `Cargo.toml`: serQ seeds its streams itself and never reads the OS, and
  that would drop `getrandom` from the wasm build
  (`crates/serq-wasm/Cargo.toml` names a backend to work around it).
- The log's `iter` could carry each request's token count, not only the
  batch's total: then a chunked prefill would show its progress, and the
  budget bar could be scaled by `tokens cap` instead of the run's peak.
