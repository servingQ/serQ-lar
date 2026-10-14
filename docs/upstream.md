# What serq-lar needs from serQ

serq-lar builds against serQ as it is (`SERQ_REF`), with no fork. These are the
changes in serQ that turn its stopgaps into the real thing, in the order they
unblock the app. Each is a serQ issue with a Before/After (serQ's CLAUDE.md,
Issues). Each says whether it has landed.

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
- **A delay folded into a latency label has no station** — landed. serQ
  [#611](https://github.com/servingQ/serQ/issues/611),
  [#612](https://github.com/servingQ/serQ/pull/612): the wait before a
  copy is the transfer run's own `latency` (IR 14), not a delay stage
  `D.nic.latency` the kernel made. A session is on the two NICs for the
  whole copy, the wait included, so the packet travels the arrow for all
  of it; the report has one row per NIC, with the wait in its `wait`
  column; the figure writes `latency (2e-3)` on the read from the run.

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
- `--json` could carry what `--dump` writes (each observation's samples
  with their times, each gauge's change points), so that a JSON report is
  the whole measurement. `crates/serq-wasm` builds that object itself
  (`series`) from `Report`'s public fields, which is enough for the page.

## U6. p50 and p90 in the report

The metrics board ([metrics.md](metrics.md)) shows p50, p90 and p99 of
TTFT, TPOT and the response time; serQ's observe statistics have `p99`
only, so the page computes the other two from the samples. A dashboard's
reader expects the three from one source. Issue draft:

> **observe 통계에 p50, p90 추가**
>
> 보고서의 observe 통계(`count mean ci cv2 p99`)에는 p99만 있어, 서빙 대시보드가 늘 같이 보는 p50(중앙값)과 p90을 serq-lar가 샘플에서 따로 계산한다. 같은 분포의 세 분위수가 두 곳에서 나오면 반올림 규칙이 달라 어긋날 수 있다(serQ의 p99는 0.5 % 이내 근사, 페이지는 nearest rank). 스테이지의 ITL에는 이미 `itl_p50`이 있다.
>
> Before (`serq run examples/multi-turn/vllm.sq --horizon 30 --json | jq .client.ttft`):
> ```json
> {"count":19,"mean":0.017764404358906388,"ci":null,"cv2":0.7742012442628255,"p99":0.05352000000000068}
> ```
> After:
> ```json
> {"count":19,"mean":0.017764404358906388,"ci":null,"cv2":0.7742012442628255,"p50":0.012139999999998707,"p90":0.040859999999998564,"p99":0.05352000000000068}
> ```
> (After의 p50, p90은 같은 샘플을 nearest rank로 잰 값이다; serQ의 분위수 추정 규칙으로 바뀔 수 있다.) 텍스트 보고서의 observe 표에도 같은 두 열. `REPORT_VERSION`은 필드 추가라 그대로.

## U7. A pool's `used` over time, without a gauge

KV cache usage over time is the metric a serving dashboard leads with, and
the page can show it only when the program declares a `gauge` of `used`:
the log carries no units (`log.md`, *Not in version 0*) and the report a
pool's `mean_used`. The board's stopgap appends `gauge used_kv = used(kv);`
lines to the program (visible, checked against every example). The
interpreter integrates `used` over time for `mean_used` already, so it has
the change points. Issue draft:

> **pool의 `used` 변화를 보고서가 그대로 내놓기**
>
> `mean_used`를 적분하느라 인터프리터는 pool의 `used`가 바뀌는 시점을 모두 지나가지만 보고서에는 시간 평균만 남는다. KV 캐시 사용량의 시간 변화는 프로그램이 `gauge used_kv = used(kv);`를 선언해야만 나오고, serq-lar는 그 줄을 프로그램에 덧붙여 다시 돌린다.
>
> Before (serq-lar가 `examples/multi-turn/vllm.sq`에 덧붙이는 줄):
> ```serq
>   // serq-lar: pool usage, one gauge per pool
>   gauge used_kv = used(kv);
>   gauge used_reqs = used(reqs);
> ```
> After: 선언 없이 `Report::pools[i].used: Vec<(f64, f64)>`(gauge의 `points`와 같은 꼴), `--dump DIR`이 `pool/kv.used.csv`(`time,value`)를 쓴다. `cached`도 같은 자리에서 같이(`cached(p)` 관측 함수가 없어 gauge로는 못 잰다). 보고서 JSON과 텍스트는 그대로.

## U8. Inter-token gaps with their times

The report has a stage's `mean_itl`, `itl_p50` and `itl_p99` over the whole
run; the board cannot chart ITL over time, and the gaps' rule (one session
and turn, across stages, a prefill's end after a decode or a preemption)
is serQ's to apply, not the page's to repeat from the log. Issue draft:

> **ITL 샘플을 시각과 함께 `Report`에 남기기**
>
> 스테이지 통계의 `mean_itl`, `itl_p50`, `itl_p99`는 전체 구간의 값이고, 토큰 간격 샘플 자체는 집계 뒤 버려진다. 시간에 따른 ITL(부하가 몰릴 때 간격이 벌어지는 모습)을 그리려면 샘플과 시각이 필요하다.
>
> Before (`src/engine/report.rs`):
> ```rust
>     pub mean_itl: f64,
> ```
> After:
> ```rust
>     pub mean_itl: f64,
>     /// `(time, gap)` of every inter-token gap ending on this stage after warm-up.
>     pub itl: Vec<(f64, f64)>,
> ```
> `--dump DIR`이 `stage/<name>.itl.csv`를 쓴다. JSON은 그대로(샘플은 `--dump`의 몫, U5의 둘째 항목과 같은 선).

## U9. The program's colours — landed

serQ [#620](https://github.com/servingQ/serQ/issues/620),
[#621](https://github.com/servingQ/serQ/pull/621): the four roles serQ's
docs colour a program by (structure, statements, options, what a program
reads, and the `~` of a draw) lived only in the Pygments lexer
(`docs/hooks/serq_lexer.py`), which wasm cannot read, and `lex` dropped
everything on a string not closed yet. `serq::frontend::highlight` now
holds them over the lexer's tokens, and `lexer::lex_partial` keeps what
it read before an error. `tokens()` in `crates/serq-wasm` returns its
pieces and the editor colours them (`web/src/main.ts`, `.code` in
`web/src/style.css`). In serQ v0.1.6-alpha.3.
## U10. Editing the deployment from the figure

[editor.md](editor.md) is the plan. Three serQ changes make it possible
without the page reading a program's meaning from its text:

- **A station no request reaches does not link** — landed, serQ
  [#616](https://github.com/servingQ/serQ/issues/616),
  [#617](https://github.com/servingQ/serQ/pull/617). An engine, a `stage`
  or a NIC that no run uses linked, and the figure silently left it out;
  now it is an error at its declaration. So every station in the figure
  has an arrow in and one out, and the page keeps a palette's engine as a
  draft until an arrow reaches it (`scripts/edits.test.ts`, "an engine
  nothing reaches").
- **A NIXL copy says who posts it** — landed, serQ
  [#618](https://github.com/servingQ/serQ/issues/618),
  [#619](https://github.com/servingQ/serQ/pull/619). `Run.poster` in the
  IR; the figure writes `pull ·` or `push ·` on the copy, dots the
  poster's NIC, and marks the arrow and bracket `data-copy`,
  `data-poster`, which the page clicks through to the toggle.
- **An outline of the text** — serQ
  [#614](https://github.com/servingQ/serQ/issues/614),
  [#615](https://github.com/servingQ/serQ/pull/615). `serq::outline(src)`:
  where each queue, member, relation, call and `use` is written, as byte
  ranges, from a parse alone. `web/src/edit.ts` places every edit there.

What the page still decides itself, as text edits next to serQ's rules
rather than copies of them: a push wraps the source's call in `fork { … }`
(serQ refuses a push no leg dispatches), and a copy adds the reader's
`connector` (serQ runs no copy without one). Both are written in
`edit.ts` with the serQ message that asks for them.

## U11. The version a pre-release tag says

The page named its serQ by `serq::VERSION` (Cargo's version). serQ's
pre-release tags do not bump it: at `v0.1.6-alpha.3` the workspace says
`0.1.5`, so the page, `serq --version` and the report's `serq_version` all
said 0.1.5. Stopgap: `web/vite.config.ts` names the build by
`git describe --tags` of the serQ checkout (falling back to `SERQ_REF`),
and the header links to that tag on GitHub. Issue draft:

> **pre-release 태그에 Cargo 버전을 맞추기**
>
> `v0.1.6-alpha.N` 태그를 찍어도 `Cargo.toml`의 `workspace.package.version`은 `0.1.5`로 남아, `serq --version`, 보고서의 `serq_version`, serq-lar 페이지가 모두 0.1.5라고 말한다. 태그로 고정한 빌드가 자기가 어느 태그인지 모른다.
>
> Before (`git checkout v0.1.6-alpha.3 && serq --version`):
> ```
> serq 0.1.5
> ```
> After:
> ```
> serq 0.1.6-alpha.3
> ```
> pre-release 태그를 찍는 커밋에서 `version = "0.1.6-alpha.3"`으로 올린다(SemVer pre-release라 Cargo가 받는다). 그러면 serq-lar는 다시 `serq::VERSION`을 쓴다.
