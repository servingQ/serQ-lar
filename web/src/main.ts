import "./style.css";
import { anchors } from "./anchors";
import { Camera } from "./camera";
import { Compose } from "./compose";
import { Dashboard, withGauges } from "./dashboard";
import { Editor } from "./editor";
import type { Log } from "./events";
import { outline as readOutline, type Outline } from "./outline";
import { Player } from "./player";
import { render, type Report, type Selection } from "./report";
import { Serq } from "./serq";
import type { Ir, Report as RunReport } from "./series";

const programs = import.meta.glob<string>("./examples/*.sq", { query: "?raw", import: "default", eager: true });
const names = Object.keys(programs)
  .map((p) => p.replace(/^.*\//, "").replace(/\.sq$/, ""))
  .sort();

/** The most log events a run keeps: past it the replay stops early and says so. */
const LOG_CAP = 400_000;
/** After an edit: how long typing pauses before serQ draws, and before it runs. */
const DRAW_AFTER = 120;
const RUN_AFTER = 700;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>("program");
const view = $<HTMLDivElement>("view");
const canvas = $<HTMLCanvasElement>("overlay");
const tip = $<HTMLDivElement>("tip");
const diag = $<HTMLPreElement>("diag");
const zoomLevel = $<HTMLSpanElement>("zoom-level");
const status = $<HTMLSpanElement>("status");
const play = $<HTMLButtonElement>("play");
const step = $<HTMLButtonElement>("step");
const skip = $<HTMLInputElement>("skip");
const scrub = $<HTMLInputElement>("scrub");
const speed = $<HTMLSelectElement>("speed");
const horizon = $<HTMLSelectElement>("horizon");
const seed = $<HTMLInputElement>("seed");
const clock = $<HTMLSpanElement>("clock");
const counts = $<HTMLSpanElement>("counts");
const banner = $<HTMLDivElement>("banner");
const report = $<HTMLDivElement>("report");
const say = $<HTMLSpanElement>("say");
const metrics = document.querySelector<HTMLElement>("section.metrics")!;
const dashboard = new Dashboard({
  tiles: $("tiles"),
  panels: $("panels"),
  observes: $("observes"),
  observesBox: $<HTMLDetailsElement>("observes-box"),
  window: $<HTMLSelectElement>("window"),
  gauges: $<HTMLButtonElement>("gauges"),
  note: $("metrics-note"),
});

const editor = new Editor($<HTMLDivElement>("source"), () => {
  clearTimeout(drawTimer);
  drawTimer = window.setTimeout(() => redraw(), DRAW_AFTER);
});
let drawTimer = 0;

// ------------------------------------------------------------ serQ ----

/** Draws: answers each edit in milliseconds. */
const drawer = new Serq();
/** Runs: may take seconds, and is stopped when a newer edit wants the run. */
const runner = new Serq();

// ------------------------------------------------------------ view ----

const camera = new Camera(view);
camera.onChange = () => (zoomLevel.textContent = `${Math.round(camera.level * 100)}%`);
let player: Player | null = null;
/** Counts edits: an answer for an older one is dropped. */
let generation = 0;
/** What the figure on the page was drawn from, and the run replayed over it. */
let drawnFrom: { svg: string; ir: string } | null = null;
let ranFor: string | null = null;
/** The status's word on that run. */
let ranNote = "";
/** The report of the last run, and the component the viewer chose to read it for. */
let last: Report | null = null;
let selected: Selection = null;
let runTimer = 0;

/** serQ refused the text: the last figure stays, dimmed, under serQ's words. */
function fail(message: string) {
  status.textContent = "error";
  view.classList.add("stale");
  report.classList.add("stale");
  metrics.classList.add("stale");
  if (player) player.playing = false;
  play.textContent = "Play";
  diag.textContent = message;
  diag.hidden = false;
  editor.diagnose(message);
}

/** Draw the text as it is now; when it means something new, run it after a pause. */
async function redraw(runNow = false) {
  const gen = ++generation;
  const src = editor.text;
  const [drawn, irJson, outlined, cut] = await Promise.all([
    drawer.ask({ cmd: "draw", src }),
    drawer.ask({ cmd: "ir", src }),
    drawer.ask({ cmd: "outline", src }),
    drawer.ask({ cmd: "tokens", src }),
  ]);
  if (gen !== generation) return;
  // serQ's roles colour the text, whether or not it links
  if (cut.ok) editor.colour(JSON.parse(cut.value));
  // the outline needs the text to parse, not to link: an edit can follow a link error
  currentOutline = outlined.ok ? readOutline(outlined.value, src) : null;
  compose.refresh();
  if (!drawn.ok) return fail(drawn.error);
  if (!irJson.ok) return fail(irJson.error);
  diag.hidden = true;
  editor.diagnose(null);
  // a run is for the IR, the horizon and the seed; a comment or a space changes none
  const key = `${irJson.value}\u0000${horizon.value}\u0000${seed.value}`;
  view.classList.remove("stale");
  const same = drawnFrom !== null && drawnFrom.svg === drawn.value && drawnFrom.ir === irJson.value;
  if (!same) {
    drawnFrom = { svg: drawn.value, ir: irJson.value };
    view.querySelector("svg")?.remove();
    view.insertAdjacentHTML("afterbegin", drawn.value);
    const svg = view.querySelector("svg")!;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    const vb = svg.viewBox.baseVal;
    camera.figure(vb.width, vb.height);
    player?.stop();
    player = null;
    ranFor = null;
    markSelected();
  }
  status.textContent = `drawn in ${drawn.ms.toFixed(1)} ms` + (key === ranFor ? ranNote : "");
  if (key === ranFor) {
    view.classList.remove("stale");
    report.classList.remove("stale");
    metrics.classList.remove("stale");
    return;
  }
  report.classList.add("stale");
  metrics.classList.add("stale");
  clearTimeout(runTimer);
  runTimer = window.setTimeout(() => runIt(gen, key), runNow ? 0 : RUN_AFTER);
}

/** Run the text drawn at `gen` with the log, and replay the log over the figure. */
async function runIt(gen: number, key: string) {
  if (gen !== generation) return;
  const src = editor.text;
  const H = Number(horizon.value);
  const S = Number(seed.value) || 1;
  // a run still going is for older text: stop it rather than wait for it
  if (runner.busy) runner.kill();
  status.textContent += " · running…";
  const ran = await runner.ask({ cmd: "run", src, horizon: H, seed: S, log: LOG_CAP });
  if (gen !== generation) return;
  if (!ran.ok) return fail(ran.error);
  const svg = view.querySelector("svg");
  if (!svg || !drawnFrom) return;
  const j = JSON.parse(ran.value) as Report & { log: Log };
  const log = j.log;
  ranFor = key;
  last = j;
  dashboard.show(j as unknown as RunReport, JSON.parse(drawnFrom.ir) as Ir, H);
  report.classList.remove("stale");
  metrics.classList.remove("stale");
  showReport();
  const at = anchors(svg);
  ranNote = ` · ran ${H} s of simulated time in ${ran.ms.toFixed(0)} ms`;
  status.textContent = status.textContent.replace(" · running…", "") + ranNote;
  const n = log.events.length.toLocaleString("en");
  banner.innerHTML = `Replaying serQ's log of this run: <b>${n}</b> events over ${H} s, seed ${S}.` +
    (log.truncated ? ` The log stopped at the cap of ${LOG_CAP.toLocaleString("en")} events; the run went on.` : "") +
    (at.stations.size === 0 ? " No station in this figure: nothing to place the sessions on." : "");
  player?.stop();
  player = new Player(log, at, poolStages(JSON.parse(drawnFrom.ir)), canvas, H, camera);
  scrub.max = String(H);
  scrub.value = "0";
  player.speed = Number(speed.value);
  player.skipIdle = skip.checked;
  player.onTick = tick;
  player.playing = true;
  play.textContent = "Pause";
  tick(0);
}

/** Per pool (by index), the stage whose entrance its queue is at: the
 * stage it admits for (`admit_via`), or the engine whose memory it is. */
function poolStages(ir: { pools: { admit_via?: number | null }[]; stages: { name: string; kind: unknown }[] }): Map<number, string> {
  const out = new Map<number, string>();
  ir.pools.forEach((q, i) => {
    if (q.admit_via !== undefined && q.admit_via !== null) out.set(i, ir.stages[q.admit_via].name);
  });
  ir.stages.forEach((s) => {
    const step = (s.kind as { Step?: { memory?: number | null } }).Step;
    if (step && step.memory !== undefined && step.memory !== null && !out.has(step.memory)) out.set(step.memory, s.name);
  });
  return out;
}

function tick(t: number) {
  if (!player) return;
  scrub.value = String(t);
  clock.textContent = `t = ${t.toFixed(3)} s` + (player.skipping ? " ▸▸" : "");
  const c = player.counts();
  counts.textContent = `${c.queue} waiting · ${c.resident} in a station` + (c.away ? ` · ${c.away} at a tool` : "");
  if (!player.playing) play.textContent = "Play";
  dashboard.cursor(t);
}

// ------------------------------------------------------------ report ----

/** The report under the figure: all of it, or the chosen component's part, with that component lit in the figure. */
function showReport() {
  report.innerHTML = last ? render(last, selected) : "";
  markSelected();
}

function markSelected() {
  for (const g of view.querySelectorAll<SVGGElement>("svg g[data-stage], svg g[data-pool]")) {
    const kind = g.dataset.stage !== undefined ? "stage" : "pool";
    const name = kind === "stage" ? g.dataset.stage : g.dataset.pool;
    g.classList.toggle("selected", selected !== null && selected.kind === kind && selected.name === name);
  }
}

/** Choose a component to read the report for; choosing it again, or `null`, shows the whole report. */
function choose(c: Selection) {
  selected = c && selected && c.kind === selected.kind && c.name === selected.name ? null : c;
  showReport();
}

report.addEventListener("click", (e) => {
  const chip = (e.target as Element).closest<HTMLButtonElement>("button.chip");
  if (!chip) return;
  const kind = chip.dataset.kind;
  choose(kind === "stage" || kind === "pool" ? { kind, name: chip.dataset.name ?? "" } : null);
});

// ------------------------------------------------------------ the diagnostic ----

/** serQ's diagnostic starts `LINE:COL:`; clicking it puts the caret there. */
diag.addEventListener("click", () => editor.goTo(diag.textContent ?? ""));

// ------------------------------------------------------------ pointer ----

function showTip(e: PointerEvent) {
  const p = camera.toFigure(e.clientX, e.clientY);
  const hit = player ? player.hit(p.x, p.y) : null;
  if (!hit) {
    tip.hidden = true;
    return;
  }
  tip.textContent = hit.text;
  const r = view.getBoundingClientRect();
  tip.hidden = false;
  // to the right of the pointer, or to its left near the edge
  const x = e.clientX - r.left;
  const flip = x + 12 + tip.offsetWidth > r.width;
  tip.style.left = `${flip ? x - 12 - tip.offsetWidth : x + 12}px`;
  tip.style.top = `${Math.min(e.clientY - r.top + 12, r.height - tip.offsetHeight - 4)}px`;
}

/** A click on the figure: a session pins, a station or a drum chooses its component in the report. */
function click(e: PointerEvent) {
  const p = camera.toFigure(e.clientX, e.clientY);
  const hit = player ? player.hit(p.x, p.y) : null;
  if (player) player.pinned = hit && player.pinned !== hit.mover.key ? hit.mover.key : null;
  if (hit) return;
  // the press captured the pointer, so the event's target is the view: ask what is under it
  const under = document.elementFromPoint(e.clientX, e.clientY);
  // a KV copy (serQ marks its arrow and bracket `data-copy`): its poster's queue, whose inspector turns pull into push
  const copied = under?.closest<SVGElement>("[data-copy]");
  if (copied) return compose.choose(copied.dataset.poster ?? null);
  const g = under?.closest<SVGGElement>("g[data-stage], g[data-pool]");
  compose.choose(g?.dataset.stage ?? null);
  if (!g) return;
  choose(g.dataset.stage !== undefined ? { kind: "stage", name: g.dataset.stage } : { kind: "pool", name: g.dataset.pool ?? "" });
}

// Drag pans, two fingers pinch, the wheel zooms about the pointer; a press
// that does not move is a click.
const down = new Map<number, { x: number; y: number }>();
let moved = false;
let pinch = 0;
view.addEventListener("pointerdown", (e) => {
  if ((e.target as Element).closest(".zoom, .diag")) return;
  if (compose.down(e)) return;
  down.set(e.pointerId, { x: e.clientX, y: e.clientY });
  view.setPointerCapture(e.pointerId);
  moved = false;
  if (down.size === 2) {
    const [a, b] = [...down.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
view.addEventListener("pointermove", (e) => {
  const was = down.get(e.pointerId);
  if (!was) return showTip(e);
  const dx = e.clientX - was.x;
  const dy = e.clientY - was.y;
  if (!moved && Math.hypot(dx, dy) < 4) return;
  moved = true;
  tip.hidden = true;
  down.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (down.size === 2) {
    const [a, b] = [...down.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const r = view.getBoundingClientRect();
    if (pinch > 0) camera.zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch);
    pinch = d;
  } else camera.pan(dx, dy);
});
const lift = (e: PointerEvent) => {
  if (!down.delete(e.pointerId)) return;
  if (down.size < 2) pinch = 0;
  if (!moved && down.size === 0 && e.type === "pointerup") click(e);
};
view.addEventListener("pointerup", lift);
view.addEventListener("pointercancel", lift);
view.addEventListener("pointerleave", () => (tip.hidden = true));
view.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    camera.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * 0.0015));
  },
  { passive: false },
);
view.addEventListener("dblclick", (e) => {
  if (!(e.target as Element).closest(".zoom, .diag")) camera.fit();
});
$<HTMLButtonElement>("zoom-in").onclick = () => camera.zoom(1.25);
$<HTMLButtonElement>("zoom-out").onclick = () => camera.zoom(0.8);
$<HTMLButtonElement>("zoom-fit").onclick = () => camera.fit();

// ------------------------------------------------------------ wiring ----

// ------------------------------------------------------------ editing ----

let currentOutline: Outline | null = null;
let sayTimer = 0;
const compose = new Compose(
  {
    text: () => editor.text,
    outline: () => currentOutline,
    apply: (edits) => editor.apply(edits),
    reveal: (at) => {
      editor.view.dispatch({ selection: { anchor: at[0], head: at[1] }, scrollIntoView: true });
      editor.view.focus();
    },
    say: (m, bad) => {
      say.textContent = m;
      say.classList.toggle("bad", !!bad);
      clearTimeout(sayTimer);
      sayTimer = window.setTimeout(() => (say.textContent = ""), 9000);
    },
  },
  view,
  $<HTMLDivElement>("drafts"),
  $<HTMLDivElement>("inspector"),
);
const toolMove = $<HTMLButtonElement>("tool-move");
const toolLink = $<HTMLButtonElement>("tool-link");
const showMode = () => {
  toolMove.setAttribute("aria-pressed", String(!compose.connecting));
  toolLink.setAttribute("aria-pressed", String(compose.connecting));
  view.classList.toggle("connecting", compose.connecting);
};
compose.onMode = showMode;
toolMove.onclick = () => {
  compose.connecting = false;
  showMode();
};
toolLink.onclick = () => {
  compose.connecting = true;
  showMode();
};
$<HTMLButtonElement>("add-prefill").onclick = () => compose.add("prefill");
$<HTMLButtonElement>("add-decode").onclick = () => compose.add("decode");
$<HTMLButtonElement>("add-delay").onclick = () => compose.add("delay");
showMode();

for (const n of names) select.add(new Option(n, n));
select.value = names.includes("llmd_nixl_pull") ? "llmd_nixl_pull" : names[0];
const load = () => {
  editor.text = programs[`./examples/${select.value}.sq`];
  last = null;
  selected = null;
  report.innerHTML = "";
  camera.fitted = true;
  redraw(true);
};
select.onchange = load;
$<HTMLButtonElement>("draw").onclick = () => {
  ranFor = null;
  redraw(true);
};
horizon.onchange = () => redraw(true);
seed.onchange = () => redraw(true);
play.onclick = () => {
  if (!player) return;
  if (player.t >= Number(scrub.max)) player.seek(0);
  player.playing = !player.playing;
  play.textContent = player.playing ? "Pause" : "Play";
};
scrub.oninput = () => {
  player?.seek(Number(scrub.value));
  tick(Number(scrub.value));
};
speed.onchange = () => {
  if (player) player.speed = Number(speed.value);
};
skip.onchange = () => {
  if (player) player.skipIdle = skip.checked;
};
step.onclick = () => {
  if (!player) return;
  player.step();
  tick(player.t);
};
// a click on a panel seeks the replay to that time
dashboard.onSeek = (t) => {
  if (!player) return;
  player.seek(t);
  tick(t);
};
// the gauges the page offers go into the program, where the viewer sees them, and the run follows
dashboard.onAddGauges = (lines) => {
  editor.text = withGauges(editor.text, lines);
};
drawer.ask({ cmd: "version" }).then((r) => {
  if (r.ok) $<HTMLSpanElement>("version").textContent = `serQ ${r.value} · wasm`;
});
load();

// for the page checks (scripts/check-page.mjs): what is on the page, without reading the canvas
(window as unknown as { serqLar: unknown }).serqLar = {
  camera,
  editor,
  compose,
  outline: () => currentOutline,
  get generation() {
    return generation;
  },
};
