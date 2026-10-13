# serq-lar

Requests moving through a [serQ](https://github.com/servingQ/serQ) deployment.

Each request is a circle on serQ's deployment view: **orange** in prefill,
**blue** in decode; hollow while it waits in a queue, filled while resident
in an engine, ringed while a forward pass runs over it. A bar across the
engine shows the pass's progress.

serQ itself runs in the browser, compiled to WebAssembly: the page edits,
draws and runs `.sq` programs with no server, so it deploys to GitHub Pages.

> **Status.** The deployment view and the reports are serQ's. The request
> animation plays a **synthetic** trace until serQ emits request events
> ([docs/upstream.md](docs/upstream.md), U1).

## Layout

```
crates/serq-wasm/   serQ → wasm-bindgen: version, ir, draw, run
web/                Vite + TypeScript, no framework
  src/worker.ts       serQ in a Web Worker
  src/anchors.ts      where each stage is in the SVG
  src/player.ts       replays a trace on a canvas over the SVG
  src/events.ts       the trace format (docs/trace-format.md)
  src/synthetic.ts    a made-up trace, until serQ emits one
scripts/            build-wasm.sh, sync-examples.sh, bench.mjs
docs/               performance.md, upstream.md, trace-format.md
SERQ_REF            the serQ commit CI builds against
```

## Build

Needs serQ checked out next to this repository (`../serQ`), Rust (pinned in
`rust-toolchain.toml`, with the `wasm32-unknown-unknown` target), the
`wasm-bindgen` CLI at the version in `Cargo.lock`, and Node 22.

```sh
cargo install wasm-bindgen-cli --version 0.2.x --locked   # match Cargo.lock
cd web
npm install
npm run wasm      # build serQ for the web, copy the example programs
npm run dev       # http://localhost:5173
npm run build     # web/dist, what Pages serves
```

`node scripts/bench.mjs 3600 ../serQ/examples/multi-turn/vllm.sq` times
serQ's wasm build ([docs/performance.md](docs/performance.md)).

## Deploy

`.github/workflows/pages.yml` builds serQ at `SERQ_REF` and the site on every
push to `main`. Enable Pages with source "GitHub Actions" in the repository
settings. If serQ is private, the second checkout needs a token with read
access to it.
