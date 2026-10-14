# serq-lar

A static web app that animates requests through serQ's deployment view.
serQ (`../serQ`) is compiled to wasm and runs in the browser; there is no
server, and the site must stay deployable to GitHub Pages.

## The rules

- **serQ is the source of truth.** The figure, the IR, the reports come from
  serQ through `crates/serq-wasm`. Do not re-implement serQ logic in
  TypeScript. Where the app needs something serQ does not provide, the
  stopgap lives here, is marked as one, and the real change is written up in
  `docs/upstream.md` (as a serQ issue: Korean, Before/After, per serQ's
  CLAUDE.md).
- **No fork of serQ.** `serq-wasm` depends on `../serQ` by path; CI checks
  out `SERQ_REF`. Bump `SERQ_REF` in the change that needs the newer serQ.
  `SERQ_REF` is a serQ tag (`v0.1.6-alpha.2`), never a commit sha: a change
  that needs an untagged serQ waits for the tag, or asks for one.
- **The replay is serQ's log, whole or cut.** The page replays the log of
  the run it made (`run_logged`), never a made-up one; when the event cap
  cut the log short, the banner says so.
- **Light.** No UI framework; the wasm is the budget. Report the size
  (`scripts/build-wasm.sh` prints it) when it moves by more than 10 %.
- **Numbers in docs are measured**, with the date, the serQ commit and the
  command (`scripts/bench.mjs`).

## Checks

```
./scripts/build-wasm.sh && ./scripts/sync-examples.sh
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
