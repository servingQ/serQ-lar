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
preemption. Hover a session for its story, click to follow it. The report of
the same run is beside the program.

The figure, the IR, the report and the log are serQ's; the page adds only the
replay. It deploys to GitHub Pages.

## Layout

```
crates/serq-wasm/   serQ → wasm-bindgen: version, ir, draw, run, run_logged
web/                Vite + TypeScript, no framework
  src/worker.ts       serQ in a Web Worker
  src/anchors.ts      where each stage, pool, arrival and exit is in the SVG
  src/events.ts       the run log's shape (serQ's docs/reference/log.md)
  src/player.ts       replays the log on a canvas over the SVG
scripts/            build-wasm.sh, sync-examples.sh, bench.mjs
docs/               performance.md, upstream.md
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
