import "./style.css";
import { anchors } from "./anchors";
import { Dashboard, withGauges } from "./dashboard";
import { Player } from "./player";
import type { Log } from "./events";
import { esc, render, type Report, type Selection } from "./report";
import type { Ir, Report as RunReport } from "./series";
import type { Request, Response } from "./worker";

const programs = import.meta.glob<string>("./examples/*.sq", { query: "?raw", import: "default", eager: true });
const names = Object.keys(programs)
  .map((p) => p.replace(/^.*\//, "").replace(/\.sq$/, ""))
  .sort();

/** The most log events a run keeps: past it the replay stops early and says so. */
const LOG_CAP = 400_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>("program");
const source = $<HTMLTextAreaElement>("source");
const view = $<HTMLDivElement>("view");
const canvas = $<HTMLCanvasElement>("overlay");
const tip = $<HTMLDivElement>("tip");
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
const dashboard = new Dashboard({
  tiles: $("tiles"),
  panels: $("panels"),
  observes: $("observes"),
  observesBox: $<HTMLDetailsElement>("observes-box"),
  window: $<HTMLSelectElement>("window"),
  gauges: $<HTMLButtonElement>("gauges"),
  note: $("metrics-note"),
});

// ------------------------------------------------------------ serQ ----

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
let seq = 0;
const pending = new Map<number, (r: Response) => void>();
worker.onmessage = (m: MessageEvent<Response>) => {
  pending.get(m.data.id)?.(m.data);
  pending.delete(m.data.id);
};
type Ask = Request extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never;
function serq(q: Ask): Promise<Response> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...q, id });
  });
}

// ------------------------------------------------------------ view ----

let player: Player | null = null;
let generation = 0;
/** The report of the last run, and the component the viewer chose to read it for. */
let last: Report | null = null;
let selected: Selection = null;

function fail(message: string) {
  status.textContent = "error";
  view.querySelector("svg")?.remove();
  player?.stop();
  player = null;
  banner.textContent = "";
  last = null;
  report.innerHTML = `<pre class="err">${esc(message)}</pre>`;
  dashboard.clear();
}

/** Draw the program, run it with the log, and replay the log over the figure. */
async function drawAndRun() {
  const gen = ++generation;
  const src = source.value;
  status.textContent = "drawing…";
  player?.stop();
  player = null;
  const [drawn, irJson] = await Promise.all([serq({ cmd: "draw", src }), serq({ cmd: "ir", src })]);
  if (gen !== generation) return;
  if (!drawn.ok) return fail(drawn.error);
  if (!irJson.ok) return fail(irJson.error);
  view.querySelector("svg")?.remove();
  view.insertAdjacentHTML("afterbegin", drawn.value);
  const svg = view.querySelector("svg")!;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  const at = anchors(svg);
  const ir = JSON.parse(irJson.value) as Ir;
  const poolStage = poolStages(ir);
  status.textContent = `drawn in ${drawn.ms.toFixed(1)} ms · ${at.stations.size} station(s) · running…`;
  banner.textContent = "";
  const H = Number(horizon.value);
  const ran = await serq({ cmd: "run", src, horizon: H, seed: Number(seed.value) || 1, log: LOG_CAP });
  if (gen !== generation) return;
  if (!ran.ok) return fail(ran.error);
  const j = JSON.parse(ran.value) as Report & { log: Log };
  const log = j.log;
  last = j;
  showReport();
  dashboard.show(j as unknown as RunReport, ir, H);
  status.textContent = `drawn in ${drawn.ms.toFixed(1)} ms · ran ${H} s of simulated time in ${ran.ms.toFixed(0)} ms`;
  const n = log.events.length.toLocaleString("en");
  banner.innerHTML = `Replaying serQ's log of this run: <b>${n}</b> events over ${H} s, seed ${Number(seed.value) || 1}.` +
    (log.truncated ? ` The log stopped at the cap of ${LOG_CAP.toLocaleString("en")} events; the run went on.` : "") +
    (at.stations.size === 0 ? " No station in this figure: nothing to place the sessions on." : "");
  player = new Player(log, at, poolStage, canvas, H);
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

// ------------------------------------------------------------ tooltip ----

/** The figure point under a mouse event. */
function figurePoint(e: MouseEvent): { x: number; y: number } | null {
  if (!player) return null;
  const r = canvas.getBoundingClientRect();
  const svg = view.querySelector("svg");
  if (!svg) return null;
  const k = svg.viewBox.baseVal.width / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
}

function showTip(e: MouseEvent) {
  const p = figurePoint(e);
  const hit = p && player ? player.hit(p.x, p.y) : null;
  if (!hit && player?.pinned) {
    // the pinned session's tooltip stays
    tip.hidden = true;
    return;
  }
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

view.addEventListener("mousemove", showTip);
view.addEventListener("mouseleave", () => (tip.hidden = true));
view.addEventListener("click", (e) => {
  const p = figurePoint(e);
  const hit = p && player ? player.hit(p.x, p.y) : null;
  if (player) player.pinned = hit && player.pinned !== hit.mover.key ? hit.mover.key : null;
  if (hit) return;
  // no session under the pointer: a station or a drum chooses its component in the report
  const g = (e.target as Element).closest<SVGGElement>("g[data-stage], g[data-pool]");
  if (!g) return;
  choose(g.dataset.stage !== undefined ? { kind: "stage", name: g.dataset.stage } : { kind: "pool", name: g.dataset.pool ?? "" });
  report.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ------------------------------------------------------------ wiring ----

for (const n of names) select.add(new Option(n, n));
select.value = names.includes("llmd_nixl_pull") ? "llmd_nixl_pull" : names[0];
const load = () => {
  source.value = programs[`./examples/${select.value}.sq`];
  last = null;
  selected = null;
  report.innerHTML = "";
  drawAndRun();
};
select.onchange = load;
$<HTMLButtonElement>("draw").onclick = drawAndRun;
horizon.onchange = drawAndRun;
seed.onchange = drawAndRun;
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
// the gauges the page offers go into the program, where the viewer sees them, and the run is made again
dashboard.onAddGauges = (lines) => {
  source.value = withGauges(source.value, lines);
  drawAndRun();
};
serq({ cmd: "version" }).then((r) => {
  if (r.ok) $<HTMLSpanElement>("version").textContent = `serQ ${r.value} · wasm`;
});
load();
