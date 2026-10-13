# What serq-lar needs from serQ

serq-lar builds against serQ as it is (`SERQ_REF`), with no fork. These are the
changes in serQ that would turn its stopgaps into the real thing, in the order
they unblock the app. Each becomes a serQ issue with a Before/After (serQ's
CLAUDE.md, Issues).

## U1. A request trace from the engine

**Now:** `Report` holds aggregates and per-turn observations
(`--dump`: `time,session,turn,value`). Nothing records where a request is
over time, so the animation plays a synthetic trace (`web/src/synthetic.ts`).

**Wanted:** an opt-in event log from `Interp` in the shape of
[trace-format.md](trace-format.md): a request arriving, waiting in a pool's
queue ahead of a stage, admitted, its prefill ending, each forward pass with
the requests in its batch, a preemption, leaving. Off by default and costing
nothing when off (a `Option<Vec<Event>>` the hot path checks once); bounded
by a horizon or event cap when on, since a one-hour run is ~10⁶ iterations.

This is a report change, not an IR change: no `IR_VERSION` bump, no Lean.
The points to emit it are where `Phase` changes in `src/engine/interp.rs`
(`Admitted`, `Prefill`, `Decode`, …) and at `Ev::IterEnd`.

## U2. Stage ids in the deployment view

**Now:** `Item::Station` carries a rect, a kind and a text; the stage it
draws is dropped (`deployment::Node::stage` is not passed on). serq-lar finds
a station by matching a label 8 points above a `.station` shape
(`web/src/anchors.ts`): it breaks the day the layout moves the label.

**Wanted:** `Item::Station { stage: Option<String>, … }`, written by the SVG
writer as `data-stage="…"` on the station's shape, and likewise
`data-pool="…"` on a pool's drum and the queue glyph ahead of a hold. A
figure that is still a picture, now also addressable. The TikZ writer
ignores them. `make draw-golden` moves.

## U3. Deployment view improvements the animation exposes

Found while placing requests on the figure; each is a view change in serQ.

- **Queues are not drawn where requests wait.** "A frame draws none: its
  pools are taken at its entrance" (`docs/visualization/deployment.md`):
  `vllm.sq` has a `queue fifo` on `reqs` and the figure shows no queue
  glyph. An animated request needs somewhere to wait; the figure should have
  it too.
- **A step engine has no room for its residents.** The budget bar is the
  only thing inside; resident requests are drawn over the glyph under a veil.
  A row of slots sized by `reqs cap` would show occupancy statically too.
- **No source and sink.** The arrival arrow starts at the page edge. A
  source glyph (and the `out` sink) gives arriving and leaving requests a
  place.

## U4. Speed

See [performance.md](performance.md): a one-hour report must take under
100 ms in the browser for parameter sweeps to be interactive; it takes
1.4–16 s.

## U5. Small API conveniences

- `serq::view::render` with a figure-to-JSON format, so the page could draw
  the figure itself (and animate pools, not just stations).
- `rand` with `default-features = false, features = ["std"]` in serQ's
  `Cargo.toml`: serQ seeds its streams itself and never reads the OS, and
  that would drop `getrandom` from the wasm build
  (`crates/serq-wasm/Cargo.toml` names a backend to work around it).
