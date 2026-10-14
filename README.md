# serq-lar

A [serQ](https://github.com/servingQ/serQ) run, replayed over its deployment
view.

serQ runs the program in the browser (compiled to WebAssembly, no server) and
keeps the log of the run: what each session did, when. The Flow tab draws
serQ's deployment as cards and arrows (React Flow), with serQ's words on
them: a station's name and note (`P[i]`, `tokens cap 8192`, a NIC's rate),
its memory pools with their capacity and policy (`block 16 · evict lru ·
preempt lifo`), an instance's `choose i of 2`, the arrival's process, a
branch's condition (`remote_prefill`, `else`), an exit's, a KV copy's way
and latency. The page replays the log over it. Each session is a circle in
its station's lane on the card, waiting in a line left of the card: hollow
while it waits in a pool's queue, filled once admitted; **orange** in a
prefill, **blue** in a decode, **grey** on any other stage (a NIC transfer,
a tool); a green ring while the forward pass an engine is running covers
it, and the engine's bar fills with that pass's tokens, a line running
under it as the pass goes. Each card counts the sessions in it and waiting
at it. A red ring flashes at a preemption. A session is where its latest run put it, a transfer over two
NICs staging at the first; a wait moves it to a queue only when its next
run is there (a reservation elsewhere, the decoder's KV before the pull,
leaves it standing, hollow). Between stations a session follows the
arrows as drawn (and follows a card dragged), through the router's decision and down the `else` lane
when that is its path, at a pace of its own: a hop takes half a second
whatever the playback speed, since in the simulation it takes none.
When no session is in any station or queue the clock skips to the next
event ("skip idle time"), so a tool call of seconds passes in a blink and an
iteration of milliseconds plays at the chosen speed; "Next event" steps.
Hover a session for its story, click to follow it. Click a station or a
pool for its part of the run's report under the view, field by field
(its chip again closes it); the whole report, a table a section with the
unit in each header, is the Metrics tab's.

The Metrics tab lays the run out like a Prometheus
dashboard: TTFT, TPOT and response time as p50/p90/p99 over time, tokens
scheduled, batch size, iteration time, residents per engine, queue length
and wait per pool, preemptions, and the pools' usage where the program
declares a gauge of it (a button adds one per pool). The playhead is the
replay's clock; a click on a panel seeks it.
[docs/metrics.md](docs/metrics.md) lists every number and where it comes from.

The figure follows the text as you type: serQ draws it again on every
edit (a few milliseconds, in a worker of its own), and runs it once typing
pauses, stopping a run still going for older text. Text serQ refuses keeps
the last deployment, dimmed, under serQ's diagnostic, which the editor
(CodeMirror, with indent guides) underlines where serQ points. The wheel
or a pinch zooms the deployment, a drag on the canvas pans it; the
replay goes with it.

The Flow tab edits the text, too. It shows the deployment as nodes to
drag and wire (React Flow), with a sidebar of parts beside them, each
dragged and dropped (a click does nothing): Engines (an engine, a delay)
onto the canvas as drafts, or onto a station, which then calls them;
Memory pools (KV blocks, request slots) onto an engine; an Arrow (a
call) or a KV transfer onto a station, then a click on its other end.
Nothing sits above the canvas: an engine clicked is made aggregated
(serQ's `agg`, as it starts), a prefiller or a decoder, a KV transfer
clicked a pull or a push.
An arrow from the arrival or a station to a draft writes the queue and
its call into the program. Its nodes are serQ's stations
and arrows, where serQ placed them, each with an input on its left and an
output on its right; an instance serQ draws as a panel (an engine with its
NIC) is a box holding its members, dragged as one, one per member of the
pool the router chooses from (`P[0]`, `P[1]` for `NP = 2`); each station lists its
memory pools (a declared pool no hold takes yet, dashed); a chosen engine
has Prefill ⇄ Decode and Make instance (its queue a family its calls
choose a member of) on a toolbar, a chosen KV copy pull ⇄ push (serQ
writes which on the copy), and any station chosen has Code,
which opens the Code tab where it is written; the arrows are routed around the
nodes (libavoid), none on top of another; an arrow drawn from one handle to another is written
into the program, a node dragged stays where it was put (in this browser
only), and Delete removes a station. Every edit is text in
the program, one step to undo (Ctrl+Z, in Flow as in the text), and serQ
says whether it is a program ([docs/editor.md](docs/editor.md)).

The bar at the top switches the stage between Flow (the deployment, the
replay, the edits), Code (the program alone, the width of the page) and
Metrics; the example, Run again, horizon and seed sit in a bar above
Flow and Metrics. The theme follows the system, or the button
beside it.

The figure, the IR, the report and the log are serQ's; the page adds only the
replay and the editing. It deploys to GitHub Pages.

## Layout

```
crates/serq-wasm/   serQ → wasm-bindgen: version, ir, draw, run, run_logged
web/                Vite + TypeScript, no framework
  src/worker.ts       serQ in a Web Worker
  src/serq.ts         the page's two workers: one draws, one runs and can be stopped
  src/editor.ts       the text in CodeMirror: coloured by serQ's roles, its diagnostic, undo
  src/outline.ts      serQ's outline of the text (where things are written)
  src/edit.ts         an edit from the figure as text, where the outline says
  src/snippets.ts     the text the palette writes
  src/compose.ts      the palette, the drafts, the arrows, roles and modes
  src/flow/graph.ts   serQ's figure as a graph: its nodes, arrows, layout and words
  src/flow/EditView.tsx  the Edit view in React Flow, loaded when opened
  src/flow/route.ts   the Edit view's arrows, routed around the nodes by libavoid
  src/flow/replay.ts  the replay's places on the Flow view: lanes, edges as drawn, budget bars
  src/anchors.ts      the replay's places; what serQ's figure has that Flow does not draw
  src/events.ts       the run log's shape (serQ's docs/reference/log.md)
  src/player.ts       replays the log on a canvas over the Flow view
  src/report.ts       the report (serQ's docs/reference/cli.md) as tables, whole or one component's
  src/series.ts       the report's shape, with the samples and gauge points
  src/metrics.ts      counts the log's state over time, per window
  src/charts.ts       a panel: lines, samples, crosshair, playhead, table
  src/dashboard.ts    the metrics board: tiles, panels, the pool gauges
scripts/            build-wasm.sh, sync-examples.sh, bench.mjs, check-edits.sh
docs/               metrics.md, performance.md, upstream.md, editor.md
```

## Build

serQ comes through Cargo: `crates/serq-wasm/Cargo.toml` names the serQ tag,
`Cargo.lock` its commit, and `scripts/serq-dir.sh` prints where Cargo checked
it out (the example programs are copied from there). To build against a serQ
checkout instead, set `SERQ_DIR` to it for every step below. Needs Rust (pinned in `rust-toolchain.toml`, with the `wasm32-unknown-unknown`
target), the `wasm-bindgen` CLI at the version in `Cargo.lock`, and Node 22.

```sh
cargo install wasm-bindgen-cli --version 0.2.x --locked   # match Cargo.lock
cd web
npm install
npm run wasm      # build serQ for the web, copy the example programs
npm run dev       # http://localhost:5173
npm run build     # web/dist, what Pages serves
```

`node scripts/bench.mjs 3600 "$(scripts/serq-dir.sh)/examples/multi-turn/vllm.sq"` times
serQ's wasm build, with and without the log ([docs/performance.md](docs/performance.md)).

## Deploy

`.github/workflows/pages.yml` builds serQ at its tag and the site on every
push to `main`. Enable Pages with source "GitHub Actions" in the repository
settings. If serQ turns private, Cargo needs a credential to fetch it
(`CARGO_NET_GIT_FETCH_WITH_CLI=true` and a token for git).
