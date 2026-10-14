import "./style.css";
import { EditorView } from "@codemirror/view";
import { anchors, type Anchors } from "./anchors";
import { Compose } from "./compose";
import type { Draft, Edit, From, To } from "./edit";
import { clientOf, routerOf } from "./inspect";
import { Dashboard, withGauges } from "./dashboard";
import { Editor } from "./editor";
import { CLIENT, graphOf, draftId, type Graph } from "./flow/graph";
import type { EditHost, ReplaySurface } from "./flow/EditView";
import { flowAnchors } from "./flow/replay";
import { family, type Log } from "./events";
import { kinds, outline as readOutline, type Outline } from "./outline";
import { Player } from "./player";
import { render, type Report, type Selection } from "./report";
import { Serq } from "./serq";
import type { Ir, Report as RunReport } from "./series";

/** serQ's examples: each a deployment, and the workloads it can run under,
 * a file of their own that serQ pairs with it (`--workload`). */
const deployments = import.meta.glob<string>("./examples/deployments/*.sq", { query: "?raw", import: "default", eager: true });
const workloads = import.meta.glob<string>("./examples/workloads/*.sq", { query: "?raw", import: "default", eager: true });
/** The workload each deployment starts under: serQ's `examples/pairs.json`. */
const pairs = Object.values(
  import.meta.glob<Record<string, string>>("./examples/pairs.json", { import: "default", eager: true }),
)[0];
const stem = (p: string) => p.replace(/^.*\//, "").replace(/\.sq$/, "");
const deploymentNames = Object.keys(deployments).map(stem).sort();
const workloadNames = Object.keys(workloads).map(stem).sort();

/** The most log events a run keeps: past it the replay stops early and says so. */
const LOG_CAP = 400_000;
/** After an edit: how long typing pauses before serQ draws, and before it runs. */
const DRAW_AFTER = 120;
const RUN_AFTER = 700;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;
const select = $<HTMLSelectElement>("program");
const workloadSelect = $<HTMLSelectElement>("workload");
const deploymentHead = $<HTMLDivElement>("deployment-head");
const workloadHead = $<HTMLDivElement>("workload-head");
/** serQ's figure, laid out off the page: the Flow view's graph and words are read off it. */
const view = $<HTMLDivElement>("view");
const flowEl = $<HTMLDivElement>("flow");
const tip = $<HTMLDivElement>("tip");
const diag = $<HTMLPreElement>("diag");
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

const typed = () => {
  clearTimeout(drawTimer);
  drawTimer = window.setTimeout(() => redraw(), DRAW_AFTER);
};
/** The program, or a pair's deployment: what Flow edits. */
const editor = new Editor($<HTMLDivElement>("source"), typed);
/** A pair's workload, beside the deployment. */
const workloadEditor = new Editor($<HTMLDivElement>("workload-source"), typed, "serQ workload");
let drawTimer = 0;

// ------------------------------------------------------------ serQ ----

/** Draws: answers each edit in milliseconds. */
const drawer = new Serq();
/** Runs: may take seconds, and is stopped when a newer edit wants the run. */
const runner = new Serq();

// ------------------------------------------------------------ view ----

let player: Player | null = null;
/** The last run's log, waiting for the Flow view to be there to replay it on. */
let pending: { log: Log; ir: string; H: number } | null = null;
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

/** serQ refused the text: the last figure stays, dimmed, under serQ's words. */
function fail(message: string) {
  status.textContent = "error";
  root.classList.remove("busy");
  root.classList.add("failed");
  flowEl.classList.add("stale");
  report.classList.add("stale");
  metrics.classList.add("stale");
  if (player) player.playing = false;
  showPlaying(false);
  diag.textContent = message;
  diag.hidden = false;
  const file = fileOf(message);
  editor.diagnose(file === "workload" ? null : message);
  workloadEditor.diagnose(file === "workload" ? message : null);
}

// ------------------------------------------------------------ a pair's two files ----

/** The texts serQ compiles: the deployment, and the workload file it runs (serQ `--workload`). */
function texts(): { src: string; workload: string } {
  return { src: editor.text, workload: workloadEditor.text };
}
/** Which text a diagnostic is about: serQ names its file first (`workload: 3:5: …`). */
function fileOf(message: string): string {
  return /^workload: /.test(message) ? "workload" : /^deployment: /.test(message) ? "deployment" : "";
}

/** Draw the text as it is now; when it means something new, run it after a pause. */
async function redraw(runNow = false) {
  const gen = ++generation;
  const { src, workload } = texts();
  const [drawn, irJson, outlined, cut, cutWorkload] = await Promise.all([
    drawer.ask({ cmd: "draw", src, workload }),
    drawer.ask({ cmd: "ir", src, workload }),
    drawer.ask({ cmd: "outline", src, workload }),
    drawer.ask({ cmd: "tokens", src }),
    workload === undefined ? null : drawer.ask({ cmd: "tokens", src: workload }),
  ]);
  if (gen !== generation) return;
  // serQ's roles colour the text, whether or not it links
  if (cut.ok) editor.colour(JSON.parse(cut.value));
  if (cutWorkload?.ok) workloadEditor.colour(JSON.parse(cutWorkload.value));
  // the outline needs the text to parse, not to link: an edit can follow a link error
  currentOutline = outlined.ok ? readOutline(outlined.value, src) : null;
  if (currentOutline) editor.outlined = kinds(currentOutline);
  if (!drawn.ok) return fail(drawn.error);
  if (!irJson.ok) return fail(irJson.error);
  diag.hidden = true;
  editor.diagnose(null);
  // a run is for the IR, the horizon and the seed; a comment or a space changes none
  const key = `${irJson.value}\u0000${horizon.value}\u0000${seed.value}`;
  flowEl.classList.remove("stale");
  const same = drawnFrom !== null && drawnFrom.svg === drawn.value && drawnFrom.ir === irJson.value;
  if (!same) {
    drawnFrom = { svg: drawn.value, ir: irJson.value };
    view.querySelector("svg")?.remove();
    view.insertAdjacentHTML("afterbegin", drawn.value);
    const svg = view.querySelector("svg")!;
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    player?.stop();
    player = null;
    pending = null;
    ranFor = null;
  }
  showGraph();
  root.classList.remove("busy", "failed");
  status.textContent = `drawn in ${drawn.ms.toFixed(1)} ms` + (key === ranFor ? ranNote : "");
  if (key === ranFor) {
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
  const { src, workload } = texts();
  const H = Number(horizon.value);
  const S = Number(seed.value) || 1;
  // a run still going is for older text: stop it rather than wait for it
  if (runner.busy) runner.kill();
  status.textContent += " · running…";
  root.classList.add("busy");
  const ran = await runner.ask({ cmd: "run", src, workload, horizon: H, seed: S, log: LOG_CAP });
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
  figureAt = anchors(svg);
  ranNote = ` · ran ${H} s of simulated time in ${ran.ms.toFixed(0)} ms`;
  status.textContent = status.textContent.replace(" · running…", "") + ranNote;
  root.classList.remove("busy");
  const n = log.events.length.toLocaleString("en");
  banner.innerHTML = `Replaying serQ's log of this run: <b>${n}</b> events over ${H} s, seed ${S}.` +
    (log.truncated ? ` The log stopped at the cap of ${LOG_CAP.toLocaleString("en")} events; the run went on.` : "") +
    (figureAt.stations.size === 0 ? " No station in this figure: nothing to place the sessions on." : "");
  player?.stop();
  player = null;
  pending = { log, ir: drawnFrom.ir, H };
  startReplay();
}

/** Replay the run waiting, once the Flow view is there to place it on. */
function startReplay() {
  const on = places();
  if (!pending || !on || !flowSurface) return;
  const { log, ir, H } = pending;
  pending = null;
  player = new Player(log, on, poolStages(JSON.parse(ir)), flowSurface.canvas, H, flowSurface.view);
  scrub.max = String(H);
  scrub.value = "0";
  player.speed = Number(speed.value);
  player.skipIdle = skip.checked;
  player.onTick = tick;
  player.playing = true;
  showPlaying(true);
  tick(0);
}

/** Per pool (by index), the stage (by index) whose entrance its queue is
 * at: the stage it admits for (`admit_via`), or the engine whose memory it is. */
function poolStages(ir: { pools: { admit_via?: number | null }[]; stages: { kind: unknown }[] }): Map<number, number> {
  const out = new Map<number, number>();
  ir.pools.forEach((q, i) => {
    if (q.admit_via !== undefined && q.admit_via !== null) out.set(i, q.admit_via);
  });
  ir.stages.forEach((s, i) => {
    const step = (s.kind as { Step?: { memory?: number | null } }).Step;
    if (step && step.memory !== undefined && step.memory !== null && !out.has(step.memory)) out.set(step.memory, i);
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
  countStations();
}

/** Each station's card says how many sessions wait at it and are in it. */
function countStations() {
  const occ = player?.occupancy() ?? new Map<string, { waiting: number; running: number }>();
  for (const el of flowEl.querySelectorAll<HTMLElement>(".react-flow__node[data-id] .fcount")) {
    const id = el.closest<HTMLElement>(".react-flow__node")!.dataset.id!;
    const c = occ.get(id);
    const text = c ? [c.running ? `${c.running} in` : "", c.waiting ? `${c.waiting} waiting` : ""].filter(Boolean).join(" · ") : "";
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle("busy", !!c?.running);
  }
}

// ------------------------------------------------------------ report ----

/** The report: under the Flow view, the part of the station or pool chosen
 * there (nothing until one is); in Metrics, all of it or the component
 * chosen there. */
function showReport() {
  report.innerHTML = last && selected ? render(last, selected, false) : "";
  reportAll.innerHTML = last ? render(last, metricsSelected) : "";
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
  const message = diag.textContent ?? "";
  setTab("code");
  (fileOf(message) === "workload" ? workloadEditor : editor).goTo(message);
});

// ------------------------------------------------------------ pointer ----

/** The session under a client point, on the Flow view. */
function hitAt(e: MouseEvent) {
  if (!player || !flowSurface) return null;
  const p = flowSurface.toAnchor(e.clientX, e.clientY);
  return player.hit(p.x, p.y);
}

flowEl.addEventListener("pointermove", (e) => {
  const hit = e.buttons ? null : hitAt(e);
  if (!hit) {
    tip.hidden = true;
    return;
  }
  tip.textContent = hit.text;
  const r = flowEl.getBoundingClientRect();
  tip.hidden = false;
  // to the right of the pointer, or to its left near the edge
  const x = e.clientX - r.left;
  const flip = x + 12 + tip.offsetWidth > r.width;
  tip.style.left = `${flip ? x - 12 - tip.offsetWidth : x + 12}px`;
  tip.style.top = `${Math.min(e.clientY - r.top + 12, r.height - tip.offsetHeight - 4)}px`;
});
flowEl.addEventListener("pointerleave", () => (tip.hidden = true));
// a click on a session pins it, before React Flow takes the click for a node or the pane
flowEl.addEventListener(
  "click",
  (e) => {
    if (!player) return;
    const hit = hitAt(e);
    if (!hit) {
      player.pinned = null;
      return;
    }
    player.pinned = player.pinned !== hit.mover.key ? hit.mover.key : null;
    e.stopPropagation();
  },
  { capture: true },
);

// ------------------------------------------------------------ editing ----

let currentOutline: Outline | null = null;
let sayTimer = 0;
function sayIt(m: string, bad?: boolean) {
  say.textContent = m;
  say.classList.toggle("bad", !!bad);
  clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => (say.textContent = ""), 9000);
}
const compose = new Compose({
  text: () => texts().src,
  outline: () => currentOutline,
  apply: (edits) => editor.apply(edits),
  say: (m, bad) => sayIt(m, bad),
});
// ------------------------------------------------------------ the views ----

/** Flow: the deployment, serQ's graph with its words, the run replayed over
 * it, the parts to drop onto it. Code: the program, the width of the page.
 * Metrics: the run's numbers over time, and the report. */
type Tab = "flow" | "code" | "metrics";
const TABS: Tab[] = ["flow", "code", "metrics"];
let tab: Tab = "flow";
const replayPane = $<HTMLDivElement>("replay-pane");
const mainEl = $<HTMLElement>("main");
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button[data-tab]")];
const tabInk = document.querySelector<HTMLSpanElement>(".tab-ink")!;

/** A node of the Edit view as an end of an arrow: the arrival (or the router's decision, the start of the way), a station, or a draft. */
function endOf(id: string): { from?: From; to?: To; nic?: Draft } {
  if (id === CLIENT || id.startsWith("#")) return { from: { kind: "arrival" } };
  const d = compose.draftList.find((_, i) => draftId(i) === id);
  if (d) return d.kind === "nic" ? { nic: d } : { to: { kind: "draft", draft: d } };
  // a member of a stacked instance (`P[1]`) is written as its array
  const stage = family(id);
  return { from: { kind: "station", stage }, to: { kind: "station", stage } };
}

const editHost: EditHost = {
  connect(from, to) {
    if (to === CLIENT) return void sayIt("A reply goes back to the client where its way ends: serQ draws it, nothing to connect.", true);
    if (to.startsWith("#")) return void sayIt("An arrow ends at a station or a draft.", true);
    const a = endOf(from);
    const b = endOf(to);
    if (!b.to) return void sayIt("A NIC's draft starts a copy: draw its arrow to the queue that reads.", true);
    if (!a.from && !a.nic) return void sayIt("A draft is placed by an arrow into it, not out of it.", true);
    compose.link(a.from ?? null, b.to, a.nic);
  },
  select(id) {
    const station = id && !id.startsWith("#") && id !== CLIENT && !id.startsWith("draft:") ? family(id) : null;
    // its part of the run's report, under the view
    selected = station ? { kind: "stage", name: station } : null;
    showReport();
  },
  report(pool) {
    selected = { kind: "pool", name: pool };
    showReport();
  },
  placed: () => replace(),
  remove(ids) {
    for (const id of ids) {
      const d = compose.draftList.find((_, i) => draftId(i) === id);
      if (d) compose.discard(d);
      else compose.removeStation(family(id));
    }
  },
  layoutKey: () => `serq-lar:layout:${select.value}`,
  instance: (id) => compose.makeInstance(family(id)),
  pool: (id, name, kind, cap) => compose.declarePool(family(id), name, kind, cap),
  copy: (from, to, mode) => compose.copyKv(family(from), family(to), mode),
  mode: (from, to, mode) => compose.setMode(family(from), family(to), mode),
  role: (id) => compose.roleOf(compose.draftList.find((_, i) => draftId(i) === id) ?? family(id)),
  setRole: (id, role) => compose.setRole(compose.draftList.find((_, i) => draftId(i) === id) ?? family(id), role),
  say: (m, bad) => sayIt(m, bad),
  add(part) {
    const d = compose.add(part.kind);
    return { draft: d, id: draftId(compose.draftList.indexOf(d)) };
  },
  routeTo: (id) => compose.routeTo(family(id)),
  inspect(id) {
    if (!currentOutline) return null;
    const apply = (edits: Edit[]) => editor.apply(edits);
    if (id === CLIENT) return clientOf(currentOutline, editor.text, shownGraph?.nodes.find((n) => n.id === CLIENT)?.sub ?? "", apply);
    if (!id.startsWith("#")) return null;
    const pools = drawnFrom ? ((JSON.parse(drawnFrom.ir) as { pools?: { name: string; block: number | null }[] }).pools ?? []) : [];
    return routerOf(currentOutline, editor.text, new Set(pools.filter((p) => p.block !== null).map((p) => p.name)), apply);
  },
  code(id) {
    const at = currentOutline && codeOf(currentOutline, family(id));
    if (!at) return void sayIt(`${id} is not written as such in the text: serQ's outline does not place it.`, true);
    setTab("code");
    editor.view.dispatch({ selection: { anchor: at[0], head: at[1] }, effects: EditorView.scrollIntoView(at[0], { y: "center" }) });
    editor.view.focus();
  },
};

/** Where a node of the Edit view is written: the client's workload, the
 * router's first choice (else its gateway's route, else the server), a
 * queue, its NIC, or a declaration (a delay). */
function codeOf(ol: Outline, id: string): [number, number] | null {
  if (id === CLIENT) return ol.workload;
  if (id.startsWith("#")) return ol.chooses?.find((c) => c.block !== "entry")?.range ?? ol.routes[0]?.range ?? ol.server?.range ?? null;
  const nic = id.endsWith(".nic");
  const q = ol.queues.find((x) => x.name === id.replace(/\.nic$/, ""));
  if (q) return (nic && q.members.find((m) => m.kind === "nic")?.range) || q.range;
  return ol.decls.find((d) => d.name === id)?.range ?? null;
}

/** The Flow view, loaded the first time it is shown: React and React Flow are its alone. */
let editView: Promise<{ show(g: Graph): void; rename(from: string, to: string): void; surface: Promise<ReplaySurface> }> | null = null;
/** serQ's figure as laid out off the page, for what the Flow view does not
 * draw; the graph the Flow view shows; and what the replay draws over it with. */
let figureAt: Anchors | null = null;
let shownGraph: Graph | null = null;
let flowSurface: ReplaySurface | null = null;

/** The replay's places: the Flow view's nodes and arrows as they stand. */
function places(): Anchors | null {
  if (!flowSurface || !shownGraph || !figureAt) return null;
  return flowAnchors(flowEl, shownGraph, flowSurface.placed(), figureAt);
}

/** The Flow view moved, measured or routed something: the replay follows; a run waiting starts. */
function replace() {
  if (pending) return startReplay();
  const on = player && places();
  if (on) player!.place(on);
  countStations();
}

/** Give the Flow view serQ's graph of the figure as drawn now. */
function showGraph() {
  if (tab !== "flow" || !drawnFrom) return;
  const svg = view.querySelector("svg");
  if (!svg) return;
  const g = graphOf(svg, JSON.parse(drawnFrom.ir), [...compose.draftList]);
  shownGraph = g;
  editView ??= import("./flow/EditView").then((m) => {
    const v = m.mountEditView(flowEl, editHost);
    v.surface.then((s) => {
      flowSurface = s;
      replace();
    });
    return v;
  });
  editView.then((v) => v.show(g));
}
compose.onDrafts = showGraph;
// before the graph it is shown in: the promise runs its callbacks in order
compose.onRename = (from, to) => void editView?.then((v) => v.rename(from, to));

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
  // serQ's figure stays laid out (the graph is read off it), out of sight, as wide as the stage
  replayPane.style.width = `${mainEl.clientWidth}px`;
  if (t === "code") editor.view.focus();
  if (location.hash !== `#${t}`) history.replaceState(null, "", `#${t}`);
  showGraph();
}
for (const b of tabButtons) b.onclick = () => setTab(b.dataset.tab as Tab);
new ResizeObserver(inkTab).observe(tabButtons[0].parentElement!);
// a link to the Replay tab, which was, is the Flow view now
setTab(TABS.find((t) => `#${t}` === location.hash) ?? "flow");
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
new ResizeObserver(() => (replayPane.style.width = `${mainEl.clientWidth}px`)).observe(mainEl);

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
    // the canvases read the colours when they draw: the replay's every frame, the panels now
    dashboard.cursor(player?.t ?? 0);
  };
  show();
}


for (const n of deploymentNames) select.add(new Option(n, n));
for (const n of workloadNames) workloadSelect.add(new Option(n, n));
select.value = deploymentNames.includes("llmd_nixl_pull") ? "llmd_nixl_pull" : deploymentNames[0];
// another deployment: its text, under the workload serQ pairs it with
const load = () => {
  const d = select.value;
  editor.reset(deployments[`./examples/deployments/${d}.sq`]);
  deploymentHead.innerHTML = `<b>${d}.sq</b> · deployment`;
  if (workloadNames.includes(pairs[d])) workloadSelect.value = pairs[d];
  showWorkload();
  last = null;
  selected = null;
  metricsSelected = null;
  report.innerHTML = "";
  reportAll.innerHTML = "";
  redraw(true);
};
select.onchange = load;
/** The workload picked, beside the deployment. */
function showWorkload() {
  const w = workloadSelect.value;
  workloadEditor.reset(workloads[`./examples/workloads/${w}.sq`]);
  workloadHead.innerHTML = `<b>${w}.sq</b> · workload`;
}
// another workload: the deployment as it is now, edits and history kept, under it
workloadSelect.onchange = () => {
  showWorkload();
  last = null;
  redraw(true);
};
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
  if (!r.ok) return;
  editor.vocabulary = JSON.parse(r.value);
  workloadEditor.vocabulary = JSON.parse(r.value);
});
load();

// for the page checks (scripts/check-page.mjs): what is on the page, without reading the canvas
(window as unknown as { serqLar: unknown }).serqLar = {
  editor,
  get player() {
    return player;
  },
  compose,
  outline: () => currentOutline,
  get generation() {
    return generation;
  },
};
