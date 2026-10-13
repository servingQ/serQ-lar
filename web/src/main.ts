import "./style.css";
import { anchors } from "./anchors";
import { Player } from "./player";
import { defaults, synthetic } from "./synthetic";
import type { Request, Response } from "./worker";

const programs = import.meta.glob<string>("./examples/*.sq", { query: "?raw", import: "default", eager: true });
const names = Object.keys(programs)
  .map((p) => p.replace(/^.*\//, "").replace(/\.sq$/, ""))
  .sort();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>("program");
const source = $<HTMLTextAreaElement>("source");
const view = $<HTMLDivElement>("view");
const canvas = $<HTMLCanvasElement>("overlay");
const status = $<HTMLSpanElement>("status");
const play = $<HTMLButtonElement>("play");
const scrub = $<HTMLInputElement>("scrub");
const speed = $<HTMLSelectElement>("speed");
const clock = $<HTMLSpanElement>("clock");
const counts = $<HTMLSpanElement>("counts");
const banner = $<HTMLDivElement>("banner");
const report = $<HTMLPreElement>("report");

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

async function drawProgram() {
  status.textContent = "drawing…";
  const [r, names] = await Promise.all([
    serq({ cmd: "draw", src: source.value }),
    serq({ cmd: "stages", src: source.value }),
  ]);
  if (!r.ok || !names.ok) {
    status.textContent = "error";
    view.querySelector("svg")?.remove();
    player?.stop();
    player = null;
    banner.textContent = "";
    report.textContent = r.ok ? (names as { error: string }).error : r.error;
    return;
  }
  view.querySelector("svg")?.remove();
  view.insertAdjacentHTML("afterbegin", r.value);
  const svg = view.querySelector("svg")!;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  const stages: string[] = JSON.parse(names.value);
  const at = anchors(svg, stages);
  // the first stage a request reaches, in the IR's order, that is drawn
  const stage = stages.find((s) => at.stations.has(s));
  status.textContent = `drawn in ${r.ms.toFixed(1)} ms · ${at.stations.size} station(s)`;
  if (!stage) {
    banner.textContent = "No station found in this figure to animate.";
    return;
  }
  // until serQ emits request events, the trace is made up (docs/upstream.md)
  const trace = synthetic(defaults(stage));
  banner.innerHTML = `Synthetic trace at <code>${stage}</code>: serQ does not emit request events yet. See <code>docs/upstream.md</code>.`;
  player?.stop();
  player = new Player(trace, at, canvas);
  scrub.max = String(trace.horizon);
  player.speed = Number(speed.value);
  player.onTick = tick;
  player.playing = true;
  play.textContent = "Pause";
}

function tick(t: number) {
  if (!player) return;
  scrub.value = String(t);
  clock.textContent = `t = ${t.toFixed(2)} s`;
  const c = player.counts();
  counts.textContent = `${c.queue} waiting · ${c.resident} resident`;
  if (!player.playing) play.textContent = "Play";
}

async function runProgram() {
  status.textContent = "running…";
  report.textContent = "";
  const r = await serq({ cmd: "run", src: source.value, horizon: 600 });
  if (!r.ok) {
    status.textContent = "error";
    report.textContent = r.error;
    return;
  }
  status.textContent = `ran 600 s of simulated time in ${r.ms.toFixed(0)} ms`;
  report.textContent = summarise(JSON.parse(r.value));
}

function summarise(j: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(j)) {
    if (typeof v === "number" || typeof v === "string") lines.push(`${k}: ${v}`);
  }
  for (const key of ["client", "stages", "pools"]) {
    const rows = j[key];
    if (!Array.isArray(rows)) continue;
    lines.push("", `${key}:`);
    for (const row of rows) lines.push("  " + JSON.stringify(row, (_k, v) => (Array.isArray(v) && v.length > 8 ? `[${v.length} values]` : v)));
  }
  return lines.join("\n");
}

// ------------------------------------------------------------ wiring ----

for (const n of names) select.add(new Option(n, n));
select.value = names.includes("vllm") ? "vllm" : names[0];
const load = () => {
  source.value = programs[`./examples/${select.value}.sq`];
  report.textContent = "";
  drawProgram();
};
select.onchange = load;
$<HTMLButtonElement>("draw").onclick = drawProgram;
$<HTMLButtonElement>("run").onclick = runProgram;
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
serq({ cmd: "version" }).then((r) => {
  if (r.ok) $<HTMLSpanElement>("version").textContent = `serQ ${r.value} · wasm`;
});
load();
