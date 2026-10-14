import "./style.css";
import { EditorView } from "@codemirror/view";
import { anchors } from "./anchors";
import { Camera } from "./camera";
import { Compose } from "./compose";
import type { Draft, From, To } from "./edit";
import { Dashboard, withGauges } from "./dashboard";
import { Editor } from "./editor";
import { graphOf, SINK, SOURCE, draftId } from "./flow/graph";
import type { EditHost } from "./flow/EditView";
import type { Log } from "./events";
import { kinds, outline as readOutline, type Outline } from "./outline";
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
const root = document.documentElement;
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
const reportAll = $<HTMLDivElement>("report-all");
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
/** The report of the last run; the component chosen in the figure, whose
 * part of the report Replay shows under it; and the one chosen in Metrics,
 * where the report is whole until one is. */
let last: Report | null = null;
let selected: Selection = null;
let metricsSelected: Selection = null;
let runTimer = 0;

/** serQ's figure keys its dark colours on the system's theme alone; while the
 * page forces one, its media query is made to say so. Stopgap: docs/upstream.md U16. */
const SYSTEM_DARK = "(prefers-color-scheme: dark)";
function themeFigure() {
  const style = view.querySelector<SVGStyleElement>("svg style");
  if (!style) return;
  const media = { dark: "all", light: "not all" }[root.dataset.theme ?? ""] ?? SYSTEM_DARK;
  style.textContent = (style.textContent ?? "").replace(/@media (\(prefers-color-scheme: dark\)|all|not all) \{/, `@media ${media} {`);
}

/** serQ refused the text: the last figure stays, dimmed, under serQ's words. */
function fail(message: string) {
  status.textContent = "error";
  root.classList.remove("busy");
  root.classList.add("failed");
  view.classList.add("stale");
  report.classList.add("stale");
  metrics.classList.add("stale");
  // Flow has no text beside it: serQ's words go where its edits are answered
  if (tab === "flow") sayIt(message, true);
  if (player) player.playing = false;
  showPlaying(false);
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
  if (currentOutline) editor.outlined = kinds(currentOutline);
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
    themeFigure();
    const vb = svg.viewBox.baseVal;
    camera.figure(vb.width, vb.height);
    player?.stop();
    player = null;
    ranFor = null;
    markSelected();
  }
  showGraph();
  root.classList.remove("busy", "failed");
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
  root.classList.add("busy");
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
  root.classList.remove("busy");
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
  showPlaying(true);
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

/** The play button's face: a triangle to play, two bars to pause. */
function showPlaying(on: boolean) {
  play.classList.toggle("playing", on);
  play.setAttribute("aria-label", on ? "Pause" : "Play");
  play.title = on ? "Pause" : "Play";
}

function tick(t: number) {
  if (!player) return;
  scrub.value = String(t);
  clock.textContent = `t = ${t.toFixed(3)} s` + (player.skipping ? " ▸▸" : "");
  const c = player.counts();
  counts.textContent = `${c.queue} waiting · ${c.resident} in a station` + (c.away ? ` · ${c.away} at a tool` : "");
  if (!player.playing) showPlaying(false);
  dashboard.cursor(t);
}

// ------------------------------------------------------------ report ----

/** The report: under the figure, the chosen component's part (nothing
 * until one is chosen), with that component lit in the figure; in Metrics,
 * all of it or the component chosen there. */
function showReport() {
  report.innerHTML = last && selected ? render(last, selected, false) : "";
  reportAll.innerHTML = last ? render(last, metricsSelected) : "";
  markSelected();
}

function markSelected() {
  for (const g of view.querySelectorAll<SVGGElement>("svg g[data-stage], svg g[data-pool]")) {
    const kind = g.dataset.stage !== undefined ? "stage" : "pool";
    const name = kind === "stage" ? g.dataset.stage : g.dataset.pool;
    g.classList.toggle("selected", selected !== null && selected.kind === kind && selected.name === name);
  }
}

const same = (a: Selection, b: Selection) => !!a && !!b && a.kind === b.kind && a.name === b.name;

/** Choose a component to read the report for under the figure; choosing it again, or `null`, closes it. */
function choose(c: Selection) {
  selected = same(c, selected) ? null : c;
  showReport();
}

/** The component a chip names (`null` for "all"), or `undefined` off the chips. */
function chipOf(e: Event): Selection | undefined {
  const chip = (e.target as Element).closest<HTMLButtonElement>("button.chip");
  if (!chip) return undefined;
  const kind = chip.dataset.kind;
  return kind === "stage" || kind === "pool" ? { kind, name: chip.dataset.name ?? "" } : null;
}
report.addEventListener("click", (e) => {
  const c = chipOf(e);
  if (c !== undefined) choose(c);
});
reportAll.addEventListener("click", (e) => {
  const c = chipOf(e);
  if (c === undefined) return;
  metricsSelected = same(c, metricsSelected) ? null : c;
  showReport();
});

// ------------------------------------------------------------ the diagnostic ----

/** serQ's diagnostic starts `LINE:COL:`; clicking it opens the text with the caret there. */
diag.addEventListener("click", () => {
  setTab("code");
  editor.goTo(diag.textContent ?? "");
});

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
  const g = under?.closest<SVGGElement>("g[data-stage], g[data-pool]");
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
function sayIt(m: string, bad?: boolean) {
  say.textContent = m;
  say.classList.toggle("bad", !!bad);
  clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => (say.textContent = ""), 9000);
}
const compose = new Compose(
  {
    text: () => editor.text,
    outline: () => currentOutline,
    apply: (edits) => editor.apply(edits),
    say: (m, bad) => sayIt(m, bad),
  },
  $<HTMLDivElement>("inspector"),
);
// ------------------------------------------------------------ the views ----

/** Replay: serQ's figure with the run over it. Flow: the same deployment as
 * nodes to drag and wire, and the parts to drop onto it. Code: the program,
 * the width of the page. Metrics: the run's numbers over time, and the
 * report. */
type Tab = "replay" | "flow" | "code" | "metrics";
const TABS: Tab[] = ["replay", "flow", "code", "metrics"];
let tab: Tab = "replay";
const flowEl = $<HTMLDivElement>("flow");
const replayPane = $<HTMLDivElement>("replay-pane");
const mainEl = $<HTMLElement>("main");
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button[data-tab]")];
const tabInk = document.querySelector<HTMLSpanElement>(".tab-ink")!;

/** A node of the Edit view as an end of an arrow: the arrival (or the router's decision, the start of the way), a station, or a draft. */
function endOf(id: string): { from?: From; to?: To; nic?: Draft } {
  if (id === SOURCE || id.startsWith("#")) return { from: { kind: "arrival" } };
  const d = compose.draftList.find((_, i) => draftId(i) === id);
  if (d) return d.kind === "nic" ? { nic: d } : { to: { kind: "draft", draft: d } };
  return { from: { kind: "station", stage: id }, to: { kind: "station", stage: id } };
}

const editHost: EditHost = {
  connect(from, to) {
    if (to === SINK) return void sayIt("A session leaves where its way ends: serQ draws the exit, nothing to connect.", true);
    if (to.startsWith("#") || to === SOURCE) return void sayIt("An arrow ends at a station or a draft.", true);
    const a = endOf(from);
    const b = endOf(to);
    if (!b.to) return void sayIt("A NIC's draft starts a copy: draw its arrow to the queue that reads.", true);
    if (!a.from && !a.nic) return void sayIt("A draft is placed by an arrow into it, not out of it.", true);
    compose.link(a.from ?? null, b.to, a.nic);
  },
  select(id) {
    compose.choose(id && !id.startsWith("#") && id !== SOURCE && id !== SINK && !id.startsWith("draft:") ? id : null);
  },
  remove(ids) {
    for (const id of ids) {
      const d = compose.draftList.find((_, i) => draftId(i) === id);
      if (d) compose.discard(d);
      else compose.removeStation(id);
    }
  },
  layoutKey: () => `serq-lar:layout:${select.value}`,
  instance: (id) => compose.makeInstance(id),
  nic: (id) => compose.nicDraft(id),
  pool: (id, name, kind, cap) => compose.declarePool(id, name, kind, cap),
  add(part) {
    const d = part.kind === "pool" ? compose.addPool(part.role, part.count) : compose.add(part.kind);
    return { draft: d, id: draftId(compose.draftList.indexOf(d)) };
  },
  code(id) {
    const at = currentOutline && codeOf(currentOutline, id);
    if (!at) return void sayIt(`${id} is not written as such in the text: serQ's outline does not place it.`, true);
    setTab("code");
    editor.view.dispatch({ selection: { anchor: at[0], head: at[1] }, effects: EditorView.scrollIntoView(at[0], { y: "center" }) });
    editor.view.focus();
  },
};

/** Where a node of the Edit view is written: a queue, its NIC, or a declaration (a delay). */
function codeOf(ol: Outline, id: string): [number, number] | null {
  const nic = id.endsWith(".nic");
  const q = ol.queues.find((x) => x.name === id.replace(/\.nic$/, ""));
  if (q) return (nic && q.members.find((m) => m.kind === "nic")?.range) || q.range;
  return ol.decls.find((d) => d.name === id)?.range ?? null;
}

/** The Edit view, loaded the first time it is asked for: React and React Flow are its alone. */
let editView: Promise<{ show(g: ReturnType<typeof graphOf>): void }> | null = null;

/** Give the Edit view serQ's graph of the figure as drawn now. */
function showGraph() {
  if (tab !== "flow" || !drawnFrom) return;
  const svg = view.querySelector("svg");
  if (!svg) return;
  const g = graphOf(svg, JSON.parse(drawnFrom.ir), [...compose.draftList]);
  editView ??= import("./flow/EditView").then((m) => m.mountEditView(flowEl, editHost));
  editView.then((v) => v.show(g));
}
compose.onDrafts = showGraph;

/** Slide the selected tab's pill under it. */
function inkTab() {
  const b = tabButtons.find((x) => x.dataset.tab === tab);
  if (!b) return;
  tabInk.style.width = `${b.offsetWidth}px`;
  tabInk.style.transform = `translateX(${b.offsetLeft - 3}px)`;
}

function setTab(t: Tab) {
  tab = t;
  root.dataset.tab = t;
  for (const b of tabButtons) b.setAttribute("aria-selected", String(b.dataset.tab === t));
  inkTab();
  // the figure stays laid out (the graph is read off it), out of sight, as wide as the stage
  replayPane.classList.toggle("offstage", t !== "replay");
  replayPane.style.width = t === "replay" ? "" : `${mainEl.clientWidth}px`;
  if (t === "code") editor.view.focus();
  if (location.hash !== `#${t}`) history.replaceState(null, "", `#${t}`);
  showGraph();
}
for (const b of tabButtons) b.onclick = () => setTab(b.dataset.tab as Tab);
new ResizeObserver(inkTab).observe(tabButtons[0].parentElement!);
setTab(TABS.find((t) => `#${t}` === location.hash) ?? "replay");
window.addEventListener("hashchange", () => {
  const t = TABS.find((x) => `#${x}` === location.hash);
  if (t && t !== tab) setTab(t);
});

// ------------------------------------------------------------ memory and keys ----

/** The page's memory of the viewer's choices: none in a private window, and the page works without it. */
const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(`serq-lar:${k}`, v);
  } catch {}
};

// Flow has no text beside it: Ctrl+Z there undoes the text's last edit, as it would in the text
window.addEventListener("keydown", (e) => {
  if (tab !== "flow" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  if ((e.target as Element).closest("input, select, textarea, [contenteditable]")) return;
  const k = e.key.toLowerCase();
  const redo = k === "y" || (k === "z" && e.shiftKey);
  if (k !== "z" && !redo) return;
  e.preventDefault();
  if (redo) editor.redo();
  else editor.undo();
});
// the stage changes width with the window: the off-stage figure follows it
new ResizeObserver(() => {
  if (tab !== "replay") replayPane.style.width = `${mainEl.clientWidth}px`;
}).observe(mainEl);

// ------------------------------------------------------------ the theme ----

/** System, light, dark, round again; remembered (index.html applies it before the first paint). */
{
  const button = $<HTMLButtonElement>("theme");
  const show = () => {
    const m = root.dataset.theme ?? "system";
    button.dataset.mode = m;
    button.title = `Theme: ${m === "system" ? "follows the system" : m}`;
  };
  button.onclick = () => {
    const next = ({ system: "light", light: "dark", dark: "system" } as Record<string, string>)[root.dataset.theme ?? "system"];
    if (next === "system") delete root.dataset.theme;
    else root.dataset.theme = next;
    remember("theme", next);
    show();
    themeFigure();
    // the canvases read the colours when they draw: the replay's every frame, the panels now
    dashboard.cursor(player?.t ?? 0);
  };
  show();
}


for (const n of names) select.add(new Option(n, n));
select.value = names.includes("llmd_nixl_pull") ? "llmd_nixl_pull" : names[0];
const load = () => {
  editor.text = programs[`./examples/${select.value}.sq`];
  last = null;
  selected = null;
  metricsSelected = null;
  report.innerHTML = "";
  reportAll.innerHTML = "";
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
  showPlaying(player.playing);
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
// the serQ tag the page was built from (vite.config.ts); a checkout past
// the tag reads v…-N-g<sha>, and the link goes to that commit
{
  const v = $<HTMLAnchorElement>("version");
  const sha = /-g([0-9a-f]+)$/.exec(__SERQ_REF__)?.[1];
  v.textContent = `serQ ${__SERQ_REF__} · wasm`;
  v.href = `https://github.com/servingQ/serQ/tree/${sha ?? __SERQ_REF__}`;
}
drawer.ask({ cmd: "vocabulary" }).then((r) => {
  if (r.ok) editor.vocabulary = JSON.parse(r.value);
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
