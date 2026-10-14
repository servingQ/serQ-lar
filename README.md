# serq-lar

A [serQ](https://github.com/servingQ/serQ) run, replayed over its deployment
view.

serQ runs the program in the browser (compiled to WebAssembly, no server) and
keeps the log of the run: what each session did, when. The page replays that
log over the figure serQ draws. Each session is a circle: hollow while it
waits in a pool's queue, filled once admitted; **orange** in a prefill,
**blue** in a decode, **grey** on any other stage (a NIC transfer, a tool); a
green ring while the forward pass an engine is running covers it, and the
engine's budget bar fills with that pass's tokens. A red ring flashes at a
preemption. A session is where its latest run put it, a transfer over two
NICs staging at the first; a wait moves it to a queue only when its next
run is there (a reservation elsewhere, the decoder's KV before the pull,
leaves it standing, hollow). Between stations a session follows the
figure's arrows, through the router's decision and down the `else` lane
when that is its path, at a pace of its own: a hop takes half a second
whatever the playback speed, since in the simulation it takes none.
When no session is in any station or queue the clock skips to the next
event ("skip idle time"), so a tool call of seconds passes in a blink and an
iteration of milliseconds plays at the chosen speed; "Next event" steps.
Hover a session for its story, click to follow it. The report of the same
run is under the figure, a table a section with the unit in each header;
click a station or a drum (or its chip) to read one component's part of
it, field by field.

Under the figure, a metrics board lays the run out like a Prometheus
dashboard: TTFT, TPOT and response time as p50/p90/p99 over time, tokens
scheduled, batch size, iteration time, residents per engine, queue length
and wait per pool, preemptions, and the pools' usage where the program
declares a gauge of it (a button adds one per pool). The playhead is the
replay's clock; a click on a panel seeks it.
[docs/metrics.md](docs/metrics.md) lists every number and where it comes from.

The figure follows the text as you type: serQ draws it again on every
edit (a few milliseconds, in a worker of its own), and runs it once typing
pauses, stopping a run still going for older text. Text serQ refuses keeps
the last figure, dimmed, under serQ's diagnostic, which the editor
(CodeMirror) underlines where serQ points. The wheel or a pinch zooms the
figure about the pointer, a drag pans it, a double-click fits it; the
replay zooms with it.

The figure edits the text, too. + Prefill and + Decode make a draft
engine; in Connect mode an arrow dragged from the arrival or a station to
it writes the queue and its call into the program. Click a station for
its instances, a NIC, a pool, the KV copy's pull or push (serQ writes
which on the copy), a duplicate, or its removal. Every edit is text in
the program, one step to undo, and serQ says whether it is a program
([docs/editor.md](docs/editor.md)).

The figure, the IR, the report and the log are serQ's; the page adds only the
replay and the editing. It deploys to GitHub Pages.

## Layout

```
crates/serq-wasm/   serQ → wasm-bindgen: version, ir, draw, run, run_logged
web/                Vite + TypeScript, no framework
  src/worker.ts       serQ in a Web Worker
  src/serq.ts         the page's two workers: one draws, one runs and can be stopped
  src/camera.ts       zoom and pan: the SVG's viewBox, the canvas's transform
  src/editor.ts       the text in CodeMirror: coloured by serQ's roles, its diagnostic, undo
  src/outline.ts      serQ's outline of the text (where things are written)
  src/edit.ts         an edit from the figure as text, where the outline says
  src/snippets.ts     the text the palette writes
  src/compose.ts      the palette, the drafts, the arrows, the inspector
  src/anchors.ts      where each stage, pool, arrival and exit is in the SVG
  src/events.ts       the run log's shape (serQ's docs/reference/log.md)
  src/player.ts       replays the log on a canvas over the SVG
  src/report.ts       the report (serQ's docs/reference/cli.md) as tables, whole or one component's
  src/series.ts       the report's shape, with the samples and gauge points
  src/metrics.ts      counts the log's state over time, per window
  src/charts.ts       a panel: lines, samples, crosshair, playhead, table
  src/dashboard.ts    the metrics board: tiles, panels, the pool gauges
scripts/            build-wasm.sh, sync-examples.sh, bench.mjs, check-edits.sh
docs/               metrics.md, performance.md, upstream.md, editor.md
SERQ_REF            the serQ commit (or tag) CI builds against
```

## Build

Needs serQ checked out next to this repository (`../serQ`) at `SERQ_REF`,
Rust (pinned in `rust-toolchain.toml`, with the `wasm32-unknown-unknown`
target), the `wasm-bindgen` CLI at the version in `Cargo.lock`, and Node 22.

```sh
cargo install wasm-bindgen-cli --version 0.2.x --locked   # match Cargo.lock
cd web
npm install
npm run wasm      # build serQ for the web, copy the example programs
npm run dev       # http://localhost:5173
npm run build     # web/dist, what Pages serves
```

`node scripts/bench.mjs 3600 ../serQ/examples/multi-turn/vllm.sq` times
serQ's wasm build, with and without the log ([docs/performance.md](docs/performance.md)).

## Deploy

`.github/workflows/pages.yml` builds serQ at `SERQ_REF` and the site on every
push to `main`. Enable Pages with source "GitHub Actions" in the repository
settings. If serQ is private, the second checkout needs a token with read
access to it.
