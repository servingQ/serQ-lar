# What serq-lar needs from serQ

serq-lar builds against serQ as it is (a tag, as a Cargo git dependency), with no fork. These are the
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
  now it is an error at its declaration. The page keeps a palette's engine
  as a draft until an arrow reaches it (`scripts/edits.test.ts`, "an engine
  nothing reaches").
- **Every station has an arrow in and one out** — landed, serQ
  [#624](https://github.com/servingQ/serQ/issues/624),
  [#625](https://github.com/servingQ/serQ/pull/625), in v0.1.6-alpha.4.
  Reaching a station was not enough for the figure: a copy whose NICs are
  in no instance (`vllm_nixl_push.sq`) was a bracket with no arrow, so the
  source's NIC had none out and the reader's none in. An arrow now goes
  under the bracket, carrying the copy's mark, and serQ's
  `tests/draw.rs` checks the arrows in and out of every station of every
  example and tutorial figure. The Edit view reads those arrows, so every
  engine and NIC there has a way in and a way out. Since serQ
  [#626](https://github.com/servingQ/serQ/issues/626),
  [#627](https://github.com/servingQ/serQ/pull/627) (v0.1.6-alpha.5),
  `serq check` and `serq draw` hold every program to it, not only serQ's
  examples (`deployment::checked_figure`), and so does the page's `draw`: a
  figure that would cut a station off is serQ's diagnostic, naming it.
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
the serQ tag `Cargo.lock` pins (or `git describe --tags` of `SERQ_DIR`),
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

## U12. Completing the language's words — landed

serQ [#622](https://github.com/servingQ/serQ/issues/622),
[#623](https://github.com/servingQ/serQ/pull/623): the words the editor
completes are every word the language gives a program, with the role it
is coloured by. serQ kept them in a dozen tables (`STRUCTURE`,
`CONTEXT_VARS`, `ENGINE_VALUES`, `Fun`, …), and the distributions' names
could not be read from outside at all; gathering them here would have been
a second list. `serq::frontend::highlight::vocabulary` gathers them, and
`vocabulary()` in `crates/serq-wasm` hands them to the editor
(`web/src/editor.ts`), which adds the program's own names from the
`name` pieces of `tokens()` and labels them by the outline. In serQ
v0.1.6-alpha.4.

## U13. serQ from crates.io

serq-lar takes serQ as a Cargo git dependency on a tag
(`serq = { git = "https://github.com/servingQ/serQ", tag = "v0.1.6-alpha.4" }`).
It works, but the version is a git ref rather than a version: `cargo update`
and `cargo tree` cannot say what is newer, and every build clones serQ's
whole history. The release already packages the crate (`cargo package` in
`release.yml`); it is not published. Depends on U11: crates.io takes a
version once, so a pre-release has to carry its own. Issue draft:

> **serq crate을 crates.io에 배포하기 (pre-release 포함)**
>
> 지금 serQ를 쓰는 Rust 쪽(serq-lar의 `serq-wasm`)은 git 태그로만 고정할 수 있다. `release.yml`이 `.crate`를 만들어 GitHub release에 붙이지만 crates.io에는 올리지 않아, 버전 범위·`cargo update`·`cargo tree`가 serQ에는 통하지 않고, 빌드마다 저장소 전체를 clone한다.
>
> Before (`crates/serq-wasm/Cargo.toml`):
> ```toml
> serq = { git = "https://github.com/servingQ/serQ", tag = "v0.1.6-alpha.4" }
> ```
> After:
> ```toml
> serq = "=0.1.6-alpha.4"
> ```
> 1. pre-release 태그에도 `workspace.package.version`을 태그와 같게 올린다(U11, `scripts/version.py`가 `X.Y.Z-alpha.N`을 받도록).
> 2. `release.yml`이 `v*` 태그(pre-release 포함)에서 `cargo publish -p serq`를 한다(crates.io trusted publishing 또는 `CARGO_REGISTRY_TOKEN`). pyserq가 PyPI에 가는 것과 같은 자리.
> 3. dev 버전(`0.1.6-dev.N`)은 crates.io에 올리지 않는다(버전을 한 번만 쓸 수 있으므로 태그만).

## U15. The nodes of an instance's panel

The Edit view draws each instance serQ draws as a panel (the engine and
NIC one `choose` variable indexes) as a box holding its members. The
SVG's panel is `<rect class="instance">` and names no node, unlike a
copy's bracket (`data-role="bracket" data-nodes="P.nic D.nic"`). Stopgap:
`web/src/flow/graph.ts` (`instancesOf`) takes a node as a member when its
centre is inside the panel, a queue's NIC (`P.nic`) as its queue's
member wherever it stands, and the panel's words by their place (7 above
its top left). The NIC rule is there because the figure of a push draws
the bracket of both NICs inside the decoder's panel: with
`examples/pd-disaggregation/vllm_nixl_push.sq` made two instances (`P[1]`,
`D[1]`), `P.nic` stands in `decode instance D[m]`.
Issue draft:

> **배포 그림의 instance 패널이 자기 노드를 SVG에 적기**
>
> 배포 그림은 `choose` 변수 하나가 가리키는 엔진·NIC·풀을 instance 패널로 묶어 그리지만, SVG의 패널은 `<rect class="instance">`일 뿐 어느 노드를 묶는지 적지 않는다. 같은 그림의 KV copy 브래킷은 `data-nodes`로 묶는 노드를 적는다. 그래서 그림을 읽는 쪽(serq-lar의 Edit view)은 패널 안에 중심이 든 노드를 기하로 골라야 한다.
>
> Before (`serq draw examples/pd-disaggregation/llmd_nixl_pull.sq`):
> ```
> <rect class="instance" fill="#f5f7f9" … x="…" y="…" width="545" height="224" rx="10"/>
> ```
> After:
> ```
> <rect class="instance" data-role="instance" data-nodes="P P.nic" … />
> ```
> `src/view/deployment.rs`의 `BoxStyle::Instance` 항목에 `nodes`(패널의 노드 이름, 화살표의 `data-from`/`data-to`와 같은 이름)를 채우고, `src/view/svg.rs`가 브래킷과 같은 방식으로 `data-nodes`를 쓰되 역할은 `data-role="instance"`로 적는다(지금은 `nodes`가 있으면 무조건 `bracket`). `tests/draw.rs`에 예제마다 패널의 `data-nodes`가 그림의 노드인지 확인하는 검사를 둔다.

## U16. The figure's dark colours, on the page's word — moot

The page no longer shows serQ's figure (it is laid out off the page, and
the Flow view draws serQ's graph), so its theme no longer matters here;
`themeFigure()` is gone. The issue stands for any page that inlines the
SVG.

serQ's SVG carries its own dark palette under
`@media (prefers-color-scheme: dark)` (`src/view/svg.rs`, `stylesheet()`),
so the figure follows the system's theme and nothing else. serq-lar now has
a theme button (system, light, dark): with the page forced to light on a
dark system, or dark on a light one, the figure stayed in the system's.
Stopgap: `themeFigure()` in `web/src/main.ts` rewrites that one media query
of the inline SVG's `<style>` to `all` or `not all` while a theme is forced,
and back when it follows the system again; serQ's colours stay serQ's.
Issue draft:

> **SVG figure의 dark 팔레트를 문서 쪽에서 고를 수 있게 하기**
>
> `view::svg::stylesheet()`의 dark 색은 `@media (prefers-color-scheme: dark)`에만 걸려 있어서, 그림을 inline으로 넣은 페이지가 자기 테마(라이트/다크 토글)를 따로 가지면 그림만 시스템 테마로 남는다.
>
> Before:
> ```css
> @media (prefers-color-scheme: dark) { text { fill: #e8e6e3; } .bg { fill:#14171a } … }
> ```
> After:
> ```css
> @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) svg.serq text { … } … }
> :root[data-theme="dark"] svg.serq text { … } …
> ```
> 1. dark 규칙을 두 번 쓴다: 시스템 dark이면서 `data-theme="light"`가 아닐 때, 그리고 `data-theme="dark"`일 때. 독립 SVG 파일에서는 `:root`가 `<svg>`라 지금과 같이 동작한다.
> 2. 선택자를 그림의 루트 클래스(`svg.serq`)로 좁혀, inline으로 넣은 문서의 다른 요소(`text`, `.bg`, `.flow` …)에 새지 않게 한다. 지금은 `.flow` 같은 클래스 이름이 페이지 전체에 걸린다.

## U17. The server's request interface, owned by the deployment — landed

serQ [#630](https://github.com/servingQ/serQ/issues/630),
[#631](https://github.com/servingQ/serQ/pull/631),
[#633](https://github.com/servingQ/serQ/pull/633): the workload and the
deployment shared one namespace, so a deployment was bound to its
workload's variable names (every vLLM server read the client's `K`). Now
the deployment owns the interface: `server (input, hidden output) reply
(produced) { … }`, the workload binds it with `send (input: K + n, output:
o);` (`send (s)` for an attribute as it is) and reads `reply.produced` after
`turn;`. The server, its routes and the scheduler read only the
parameters; the workload reads only its own, what it sends as it is,
`serial` and the reply. A bare `server { … }` takes nothing; the workload's
`hidden` is a parameter's. No IR change; every example's report is the
same (serQ `docs/design/request-interface.md`). This is what lets U18 pair
a workload with a deployment by the signature alone.

## U18. Workload and deployment in separate files — landed

serQ [#638](https://github.com/servingQ/serQ/issues/638),
[#639](https://github.com/servingQ/serQ/pull/639), in v0.1.6-alpha.8: a
deployment file and a workload file (no `fn main()`), paired by the tool
(`serq run D --workload W`, `serq::compile_paired`, `outline_paired`).
They meet only at the server's signature; each file's names are its own,
and serQ's messages name their file (`workload: 1:5: …`).
`crates/serq-wasm` takes an optional workload text on `ir`, `draw`,
`outline` and `run`.

serQ [#648](https://github.com/servingQ/serQ/issues/648),
[#649](https://github.com/servingQ/serQ/pull/649), in v0.1.6-alpha.10: a
program is the deployment, and the workload only a file given when it
runs; a `workload` in `fn main` does not link. Every serQ example is a
deployment and a workload (`examples/workloads/`), and
`examples/pairs.json` says which workload each runs. The page lists the
examples as deployments (`scripts/sync-examples.sh` copies them, the
workloads that read no trace, and each one's workload as
`web/src/examples/pairs.json`); switching to one picks its workload. The
Code tab shows the two files side by side (stacked on a phone), each in
its own editor and undo history. Flow edits the deployment; a diagnostic
opens the file it names. Not yet: marking a workload that does not fit a
deployment's signature before it is run (serQ's error says so after).

## U19. The figure's words, on what they label

The Flow view writes serQ's words on its cards and arrows: a station's
name over it (`P[i]`) and note under it (`tokens cap 8192`, a NIC's rate,
a delay's `~exp(3)`), a pool's lines beside its drum, a branch's condition
(`remote_prefill`, `else`), an exit's (`out (K + n >= 16384)`), a copy's
way and latency, the arrival's process. In the SVG each is a bare
`<text>` at a place: nothing says what it labels. Stopgap: `wordsOf` in
`web/src/flow/graph.ts` takes each by where serQ's writer puts it
(`src/view/deployment.rs`): a node's name and note on its centre line,
just over and under it; a pool's lines just right of its drum; the rest,
the nearest arrow's. A change to the writer's spacing would move a word
to the wrong place without an error. Issue draft:

> **배포 그림의 글자가 무엇을 가리키는지 SVG에 적기**
>
> 배포 그림의 글자(노드 이름·주석, 풀 설명, 분기 조건, exit 조건, copy 경로·latency, 도착 과정)는 SVG에서 좌표만 가진 `<text>`라, 그림을 읽는 쪽(serq-lar의 Flow view)은 위치로 짝을 찾는다. drum은 `data-pool`, 화살표는 `data-from`/`data-to`를 적는데 그 옆 글자는 적지 않는다.
>
> Before (`serq draw examples/pd-disaggregation/llmd_nixl_pull.sq`):
> ```
> <text x="475.2" y="133" … >P[i]</text>
> <text x="475.2" y="206" … class="dim">tokens cap 8192</text>
> <text x="376" y="272" … class="dim">cap 160000 · block 16 · evict lru · preempt lifo</text>
> <text x="252" y="159" … class="dim">remote_prefill</text>
> ```
> After:
> ```
> <text x="475.2" y="133" … data-for="P" data-role="name">P[i]</text>
> <text x="475.2" y="206" … class="dim" data-for="P" data-role="note">tokens cap 8192</text>
> <text x="376" y="272" … class="dim" data-pool="P.kv" data-role="note">cap 160000 · block 16 · evict lru · preempt lifo</text>
> <text x="252" y="159" … class="dim" data-from="#0" data-to="P" data-role="label">remote_prefill</text>
> ```
> `figure::Item::Text`에 무엇의 글자인지(노드, 풀, 화살표, 인스턴스, 도착)와 역할(name, note, label)을 담는 필드를 두고, `deployment.rs`의 `f.text`/`f.note` 호출(20곳)이 채우며, `svg.rs`가 drum·화살표와 같은 이름의 `data-*`로 적는다. U15(인스턴스 패널의 `data-nodes`)와 함께 하면 Flow view가 그림을 위치로 읽는 곳이 없어진다. `tests/draw.rs`에 예제마다 모든 `<text>`가 그림의 노드·풀·화살표를 가리키는지 확인하는 검사를 둔다.

## U20. The client and the server in the deployment view

The Flow view draws the workload as one client and the deployment as one
server, since serQ takes one `workload` and one `server` a program
(`duplicate workload`, `duplicate server`). serQ's figure draws the
arrival arrow from the page's edge and each exit to an `out` of its own,
and nothing around the server. Stopgaps in `web/src/flow/graph.ts`
(`CLIENT`: the arrival and the exits joined in one node, each exit a
reply back into it) and `web/src/flow/EditView.tsx` (`ServerNode`: a
frame around all but the client). Extends U3's "no source and sink".
Issue draft:

> **배포 그림에 client와 server를 그리기**
>
> 배포 그림은 도착 화살표를 그림 가장자리에서 시작하고, exit마다 `out`으로 끝낸다. 워크로드(client)도, server의 경계도 그리지 않는다. 그런데 serQ는 프로그램마다 `workload`와 `server`를 하나씩만 받으므로(`duplicate workload`, `duplicate server`) 둘 다 그림의 한 자리로 그릴 수 있다.
>
> Before: `<path data-role="arrival" data-to="#0">`, `<path data-role="exit" data-from="D">` … `out`
> After: `<g data-node="client" data-role="client">`(도착은 client에서 나가고, exit는 응답으로 client에 돌아온다: `data-to="client"`), `<rect data-role="server">`(client를 뺀 전부를 감싸는 틀). tool 시간과 think 시간은 client에 있다.

## U21. A router's choice and the workload's statements in the outline — landed

The inspector edits a router's keys and the client's properties where
the text writes them. serQ
[#640](https://github.com/servingQ/serQ/issues/640),
[#641](https://github.com/servingQ/serQ/pull/641) (in v0.1.6-alpha.8)
add `chooses` (a `choose`'s variable, count, each key, its block) and
`workload_items` (`arrive`, `set`, `send`, `tool`, … with their values).
For a pair, `Outline::split` left the workload's statements in the
deployment's outline, at the joined text's offsets: serQ
[#650](https://github.com/servingQ/serQ/issues/650),
[#651](https://github.com/servingQ/serQ/pull/651) move them into the
workload file's. `crates/serq-wasm` hands the workload file's outline
under `workload_file` (v0.1.6-alpha.10 has #651): the client's inspector
edits the workload file, the router's the deployment.

## U22. The rules serq-lar knows in serQ's place

The Flow view's edits know rules of serQ's that serQ says only by
refusing the result, or not at all: a NIC carries a copy, a copy's ends
are both families or both plain, one KV pool a device, a pool takes a
capacity, a push forks the source's call, a reader's connector, what an
instance is, which keys a `choose` takes, where a pool admits. serQ
[#645](https://github.com/servingQ/serQ/issues/645) asks serQ to own
them: a code and a fix-it on each diagnostic, and queries in the outline
(instances, a device's KV pool, capacities, what each stage takes, role
templates, a `choose`'s keys). serq-lar keeps only how each is shown.

Landed so far: the router's keys are serQ's functions
([#669](https://github.com/servingQ/serQ/pull/669),
`highlight::functions`, which `crates/serq-wasm` hands as `functions()`):
the inspector offers each whose one parameter is a stage or a pool, on
the chosen member, and no longer knows which pool is KV. A push needs no
fork after all ([#660](https://github.com/servingQ/serQ/pull/660)), and a
copy's ends need not both be families
([#664](https://github.com/servingQ/serQ/pull/664)): serq-lar's edits
still write both, and can stop.
