# serq-lar

A static web app that animates requests through serQ's deployment view.
serQ (`servingQ/serQ`, a Cargo git dependency) is compiled to wasm and runs in the browser; there is no
server, and the site must stay deployable to GitHub Pages.

## The rules

- **serQ is the source of truth.** The figure, the IR, the reports come from
  serQ through `crates/serq-wasm`. Do not re-implement serQ logic in
  TypeScript. Where the app needs something serQ does not provide, the
  stopgap lives here, is marked as one, and the real change is written up in
  `docs/upstream.md` (as a serQ issue: Korean, Before/After, per serQ's
  CLAUDE.md).
- **No fork of serQ.** `serq-wasm` depends on serQ by git tag
  (`crates/serq-wasm/Cargo.toml`, `tag = "v0.1.6-alpha.5"`); `Cargo.lock`
  pins its commit. Bump the tag, and the lock with it (`cargo metadata`),
  in the change that needs the newer serQ. It is a serQ tag, never a
  `rev`: a change that needs an untagged serQ waits for the tag, or asks
  for one. `SERQ_DIR=<serQ checkout>` builds against local serQ work
  (`scripts/build-wasm.sh` patches the dependency and keeps the lock);
  set it for `npm run build` too, so the header names that checkout.
- **The replay is serQ's log, whole or cut.** The page replays the log of
  the run it made (`run_logged`), never a made-up one; when the event cap
  cut the log short, the banner says so.
- **Light, and not hand-made where a library fits.** A focused library for
  a hard widget is welcome rather than one built by hand: CodeMirror is
  the text, React Flow the Edit view (the Flow tab), libavoid its arrows'
  routes, Tailwind the page's styles. React and libavoid are the Edit
  view's alone, loaded when it is opened; the rest of the page has no UI
  framework. The deployment has one view, the Flow tab: React Flow draws
  serQ's graph (its nodes, arrows, layout and words read off serQ's
  figure, which is laid out off the page), never one of its own; the run
  replays over it, and every arrow drawn there goes into the text. The wasm is the
  budget. Report the size (`scripts/build-wasm.sh` prints it) when it
  moves by more than 10 %.
- **Numbers in docs are measured**, with the date, the serQ commit and the
  command (`scripts/bench.mjs`).

## Checks

```
./scripts/build-wasm.sh && ./scripts/sync-examples.sh
./scripts/check-edits.sh            # every figure edit on serQ's examples links and draws
cd web && npm run build          # tsc --noEmit + vite build
```

Environment notes: the wasm build needs `RUSTFLAGS='--cfg
getrandom_backend="wasm_js"'`, which `.cargo/config.toml` sets when cargo runs
from this repository. Headless Chromium needs system libraries this dev box
lacks. Without sudo: `apt-get download` the missing ones (`ldd` on
`~/.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell`
names them), `dpkg -x` them into the scratchpad, set `LD_LIBRARY_PATH` to
their `usr/lib/x86_64-linux-gnu`, and launch `playwright-core` with that
`executablePath` against `npx vite preview`. Check light, dark and a 390 px
phone; a page error or a stuck "running…" status is a failure.
