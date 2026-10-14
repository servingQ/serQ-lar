// serQ's report (`serq run --json`, serQ's docs/reference/cli.md) laid out
// to be read: a table a section with the unit in each header, numbers cut
// to three significant digits; or one component of it, field by field, with
// what each field means. Every number is serQ's; the one derived column,
// `idle`, is the remainder serQ's own text report prints.

export interface Observe {
  count: number;
  mean: number | null;
  ci: number | null;
  cv2: number | null;
  p99: number | null;
}

export interface Gauge {
  mean: number | null;
  ci: number | null;
  min: number | null;
  max: number | null;
}

export interface Claim {
  name: string;
  kind: string;
  result: string;
  checked: number;
  failures: number;
  first: number | null;
  note: string | null;
}

export interface Stage {
  name: string;
  index: number | null;
  mean_number: number;
  utilization: number;
  completed: number;
  throughput: number;
  mean_wait: number | null;
  mean_service: number | null;
  iterations: number;
  prefill_only: number;
  decode_only: number;
  mixed: number;
  mean_decodes: number;
  mean_decode_batch: number | null;
  mean_decode_step: number | null;
  mean_itl: number | null;
  itl_p50: number | null;
  itl_p99: number | null;
  idle_with_work: boolean;
}

export interface Pool {
  name: string;
  index: number | null;
  mean_used: number;
  mean_cached: number;
  mean_queue: number;
  mean_holders: number;
  mean_wait: number | null;
  admissions: number;
  evicted_entries: number;
  evicted_units: number;
  preemptions: number;
  spills: number;
  rejected: number;
  stuck: number;
  over_cap: { queue: string; need: number } | null;
  growing_at_end: number;
  growing_stalled: boolean;
}

export interface Report {
  serq_version: string;
  horizon: number;
  end: number;
  warmup: number;
  seed: number;
  events: number;
  arrivals: number;
  ended: number;
  turns: number;
  mean_live: number;
  observes: Record<string, Observe>;
  client: Record<string, Observe>;
  gauges: Record<string, Gauge>;
  claims?: Claim[];
  stages: Stage[];
  pools: Pool[];
}

/** One component of the deployment, by the name the figure and the report share (`P` for every member of the array `P`). */
export type Selection = { kind: "stage" | "pool"; name: string } | null;

// ------------------------------------------------------------ numbers ----

/** `count` an integer, `num` a quantity with no unit, `time` seconds of the
 * simulated clock, `frac` a fraction of time, `rate` per second. */
type Kind = "count" | "num" | "time" | "frac" | "rate" | "text";

interface Col<T> {
  key: keyof T & string;
  head: string;
  kind: Kind;
  meaning: string;
}

const DASH = "–";
const grouped = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Three significant digits, or a whole number past 100: enough to read.
 * Below a thousandth a number is `<0.001`, not `7.78e-7`. */
export function num(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return DASH;
  if (Math.abs(v) >= 100) return grouped.format(v);
  if (v !== 0 && Math.abs(v) < 1e-3) return v < 0 ? ">-0.001" : "<0.001";
  return String(Number(v.toPrecision(3)));
}

interface Scale {
  k: number;
  unit: string;
}

/** The unit a duration reads best in: seconds, milliseconds or microseconds. */
function scaleOf(seconds: number): Scale {
  if (!Number.isFinite(seconds) || seconds >= 1) return { k: 1, unit: "s" };
  if (seconds >= 1e-3) return { k: 1e3, unit: "ms" };
  return { k: 1e6, unit: "µs" };
}

/** A duration with its own unit: `12.3 ms`. */
export function time(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return DASH;
  if (v === 0) return "0 s";
  const s = scaleOf(Math.abs(v));
  return `${num(v * s.k)} ${s.unit}`;
}

/** The cell's text and the unit that goes with it, for a column read in one unit. */
function cell(kind: Kind, v: unknown, scale: Scale): string {
  switch (kind) {
    case "count":
      return typeof v === "number" ? grouped.format(v) : DASH;
    case "time":
      return typeof v === "number" && Number.isFinite(v) ? num(v * scale.k) : DASH;
    case "frac":
      return typeof v === "number" && Number.isFinite(v) ? num(v * 100) : DASH;
    case "text":
      return v === null || v === undefined ? DASH : esc(String(v));
    default:
      return num(v);
  }
}

/** The value with its unit, as the detail view says it. */
function value(kind: Kind, v: unknown): string {
  switch (kind) {
    case "time":
      return time(v);
    case "frac":
      return typeof v === "number" && Number.isFinite(v) ? `${num(v * 100)} %` : DASH;
    case "rate":
      return typeof v === "number" && Number.isFinite(v) ? `${num(v)} /s` : DASH;
    default:
      return cell(kind, v, { k: 1, unit: "" });
  }
}

/** The unit of a column: a time column's is the one its largest value reads best in. */
function unitOf<T>(c: Col<T>, rows: T[]): Scale {
  switch (c.kind) {
    case "time": {
      let max = 0;
      for (const r of rows) {
        const v = r[c.key];
        if (typeof v === "number" && Number.isFinite(v)) max = Math.max(max, Math.abs(v));
      }
      return max === 0 ? { k: 1, unit: "s" } : scaleOf(max);
    }
    case "frac":
      return { k: 100, unit: "%" };
    case "rate":
      return { k: 1, unit: "/s" };
    default:
      return { k: 1, unit: "" };
  }
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** `P[0]` for an array member, `tool` for a single component. */
export function label(r: { name: string; index: number | null }): string {
  return r.index === null ? r.name : `${r.name}[${r.index}]`;
}

// ------------------------------------------------------------ tables ----

/** One section: a table with a row per item, the unit in each header and the meaning on hover. */
function table<T>(caption: string, cols: Col<T>[], rows: T[], name: (r: T) => string, hint?: (r: T) => string | undefined): string {
  if (rows.length === 0) return "";
  const scales = cols.map((c) => unitOf(c, rows));
  const head = cols
    .map((c, i) => `<th title="${esc(c.meaning)}">${esc(c.head)}${scales[i].unit ? `<small>${scales[i].unit}</small>` : ""}</th>`)
    .join("");
  const body = rows
    .map((r) => {
      const h = hint?.(r);
      return `<tr><td class="name"${h ? ` title="${esc(h)}"` : ""}>${esc(name(r))}</td>${cols.map((c, i) => `<td class="n">${cell(c.kind, r[c.key], scales[i])}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<div class="scroll"><table><thead><tr><th class="name">${esc(caption)}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** One item, field by field: the value with its unit, and what the field means. */
function detail<T>(cols: Col<T>[], row: T): string {
  const rows = cols
    .map((c) => `<tr><th>${esc(c.head)}</th><td class="n">${value(c.kind, row[c.key])}</td><td class="meaning">${esc(c.meaning)}</td></tr>`)
    .join("");
  return `<table class="detail"><tbody>${rows}</tbody></table>`;
}

const STAGE: Col<Stage>[] = [
  { key: "mean_number", head: "present", kind: "num", meaning: "time-average runs present, waiting and in service" },
  { key: "utilization", head: "util", kind: "frac", meaning: "fraction of the measured time with a run present; on a shared stage, the capacity its flows carry" },
  { key: "completed", head: "done", kind: "count", meaning: "runs completed after warm-up: on an engine a prefill then a decode is two runs" },
  { key: "throughput", head: "thru", kind: "rate", meaning: "runs completed per second of simulated time" },
  { key: "mean_wait", head: "wait", kind: "time", meaning: "mean wait from a run's arrival at the stage to its start; 0 on an engine, where the wait for admission is its pool's" },
  { key: "mean_service", head: "service", kind: "time", meaning: "mean time from a run's start to its end" },
  { key: "iterations", head: "iters", kind: "count", meaning: "step iterations over the whole run, warm-up included; 0 off an engine" },
];

/** The engine's time and tokens: what the step table says of a stage with iterations. */
const STEP: Col<Stage & { idle: number }>[] = [
  { key: "prefill_only", head: "prefill only", kind: "frac", meaning: "fraction of the measured time running an iteration of prefills only" },
  { key: "decode_only", head: "decode only", kind: "frac", meaning: "fraction of the measured time running an iteration of decodes only" },
  { key: "mixed", head: "mixed", kind: "frac", meaning: "fraction of the measured time running an iteration of both" },
  { key: "idle", head: "idle", kind: "frac", meaning: "the rest of the measured time: no iteration running (an iteration that only preempts counts here)" },
  { key: "mean_decodes", head: "decodes", kind: "num", meaning: "time-average decodes in the running iteration, 0 while none runs" },
  { key: "mean_decode_batch", head: "decode batch", kind: "num", meaning: "mean decodes of an iteration that carried any, over those started after warm-up: the batch a decode is in" },
  { key: "mean_decode_step", head: "decode step", kind: "time", meaning: "mean duration of such an iteration: the step a decode waits for" },
  { key: "mean_itl", head: "ITL mean", kind: "time", meaning: "inter-token gaps ending on this stage after warm-up: their mean" },
  { key: "itl_p50", head: "ITL p50", kind: "time", meaning: "inter-token gaps ending on this stage after warm-up: their median" },
  { key: "itl_p99", head: "ITL p99", kind: "time", meaning: "inter-token gaps ending on this stage after warm-up: their 99th percentile" },
];

const POOL: Col<Pool>[] = [
  { key: "mean_used", head: "used", kind: "num", meaning: "time-average allocated units" },
  { key: "mean_cached", head: "cached", kind: "num", meaning: "time-average cached units" },
  { key: "mean_queue", head: "queue", kind: "num", meaning: "time-average holds waiting in this pool's queue" },
  { key: "mean_holders", head: "holders", kind: "num", meaning: "time-average sessions holding it; one holding it twice, by a nested hold or a lease, is one" },
  { key: "mean_wait", head: "wait", kind: "time", meaning: "mean wait from a hold joining this pool's queue to its admission, after warm-up; a hold waits in the queue of its first pool only" },
  { key: "admissions", head: "admits", kind: "count", meaning: "holds admitted" },
  { key: "evicted_entries", head: "evicted", kind: "count", meaning: "cache entries evicted" },
  { key: "evicted_units", head: "evicted units", kind: "num", meaning: "units evicted from the cache" },
  { key: "preemptions", head: "preempt", kind: "count", meaning: "holds preempted" },
  { key: "spills", head: "spills", kind: "count", meaning: "holds spilled to another pool" },
  { key: "rejected", head: "rejected", kind: "count", meaning: "sessions ended asking for more than the cap" },
  { key: "stuck", head: "stuck", kind: "count", meaning: "sessions preempted again without progress past their previous preemption: a livelock" },
];

const OBSERVE: Col<Observe & { name: string }>[] = [
  { key: "count", head: "samples", kind: "count", meaning: "samples after warm-up" },
  { key: "mean", head: "mean", kind: "num", meaning: "their mean" },
  { key: "ci", head: "± 95 % CI", kind: "num", meaning: "batch-means 95 % confidence half-width; below 40 samples it is not estimated" },
  { key: "cv2", head: "cv²", kind: "num", meaning: "squared coefficient of variation" },
  { key: "p99", head: "p99", kind: "num", meaning: "99th percentile" },
];

/** The client's metrics are times: `ttft`, `tpot`, `response`. */
const CLIENT: Col<Observe & { name: string }>[] = OBSERVE.map((c) => (c.key === "count" || c.key === "cv2" ? c : { ...c, kind: "time" }));

const CLIENT_MEANING: Record<string, string> = {
  ttft: "time to first token: from the turn to its first output token",
  tpot: "time per output token, after the first",
  response: "from the turn to its answer",
};

const GAUGE: Col<Gauge & { name: string }>[] = [
  { key: "mean", head: "mean", kind: "num", meaning: "time average over the measured span" },
  { key: "ci", head: "± 95 % CI", kind: "num", meaning: "batch-means 95 % confidence half-width over 20 windows" },
  { key: "min", head: "min", kind: "num", meaning: "least value held for a positive time after warm-up" },
  { key: "max", head: "max", kind: "num", meaning: "greatest value held for a positive time after warm-up" },
];

const CLAIM: Col<Claim>[] = [
  { key: "kind", head: "kind", kind: "text", meaning: "every iteration, some iteration, or at the end" },
  { key: "result", head: "result", kind: "text", meaning: "what the run found of it" },
  { key: "checked", head: "checked", kind: "count", meaning: "iterations read, or 1 for a claim read at the end" },
  { key: "failures", head: "failures", kind: "count", meaning: "of those, the ones that read 0" },
  { key: "first", head: "first", kind: "time", meaning: "the first failure, or a some claim's first witness" },
  { key: "note", head: "note", kind: "text", meaning: "why the claim was not read" },
];

// ------------------------------------------------------------ notes ----

/** What serQ's text report says under its tables of a component worth a second look. */
function stageNotes(s: Stage): string[] {
  return s.idle_with_work
    ? [`${label(s)} ended with residents or waiting requests, its last iteration scheduling nothing (idle with work).`]
    : [];
}

function poolNotes(p: Pool): string[] {
  const out: string[] = [];
  const name = label(p);
  if (p.stuck > 0) out.push(`${p.stuck} session(s) were preempted again at ${name} without passing the position of their previous preemption.`);
  if (p.rejected > 0) out.push(`${p.rejected} session(s) ended at ${name} asking for more than its cap.`);
  if (p.growing_at_end > 0)
    out.push(
      `${p.growing_at_end} hold(s) wait to grow in ${name} when the run ends, ` +
        (p.growing_stalled ? "and every holder is one of them, so none will free room." : "for room another holder may free."),
    );
  if (p.over_cap) out.push(`The head of ${p.over_cap.queue}'s queue asks ${name} for ${num(p.over_cap.need)}, above its cap, when the run ends, and waits.`);
  return out;
}

function notes(lines: string[]): string {
  return lines.map((l) => `<p class="note">${esc(l)}</p>`).join("");
}

// ------------------------------------------------------------ sections ----

function section(title: string, body: string, note = ""): string {
  return body ? `<section><h3>${esc(title)}${note ? ` <span class="dim">${esc(note)}</span>` : ""}</h3>${body}</section>` : "";
}

function named<T>(obj: Record<string, T>): (T & { name: string })[] {
  return Object.entries(obj).map(([name, v]) => ({ name, ...v }));
}

function withIdle(s: Stage): Stage & { idle: number } {
  return { ...s, idle: 1 - s.prefill_only - s.decode_only - s.mixed };
}

/** The whole report, section by section. */
function overview(j: Report): string {
  const run = [
    ["horizon", time(j.horizon)],
    ["end", time(j.end)],
    ["warm-up", time(j.warmup)],
    ["seed", String(j.seed)],
    ["events", grouped.format(j.events)],
    ["arrivals", grouped.format(j.arrivals)],
    ["ended", grouped.format(j.ended)],
    ["turns", grouped.format(j.turns)],
    ["live", num(j.mean_live)],
  ]
    .map(([k, v]) => `<span><span class="dim">${k}</span> ${v}</span>`)
    .join("");
  const client = named(j.client).filter((o) => o.count > 0);
  const steps = j.stages.filter((s) => s.iterations > 0).map(withIdle);
  return (
    `<div class="run mono">${run}</div>` +
    section("client", table("metric", CLIENT, client, (o) => o.name, (o) => CLIENT_MEANING[o.name]), "what each turn's client saw") +
    section("observe", table("observe", OBSERVE, named(j.observes), (o) => o.name), "the program's own") +
    section("gauge", table("gauge", GAUGE, named(j.gauges), (g) => g.name)) +
    section("claim", table("claim", CLAIM, j.claims ?? [], (c) => c.name)) +
    section("stages", table("stage", STAGE, j.stages, label) + notes(j.stages.flatMap(stageNotes)), "runs after warm-up") +
    section("step engines", table("engine", STEP, steps, label), "the iterations' time and tokens") +
    section("pools", table("pool", POOL, j.pools, label) + notes(j.pools.flatMap(poolNotes)), "time averages and counts")
  );
}

/** One component: its rows alone, and a single row field by field. */
function one(j: Report, sel: NonNullable<Selection>): string {
  if (sel.kind === "stage") {
    const rows = j.stages.filter((s) => s.name === sel.name);
    if (rows.length === 0) return `<p class="dim">No stage named ${esc(sel.name)} in this report.</p>`;
    const steps = rows.filter((s) => s.iterations > 0).map(withIdle);
    if (rows.length === 1) {
      return (
        section(label(rows[0]), detail(STAGE, rows[0]) + notes(stageNotes(rows[0])), "stage") +
        (steps.length ? section("as a step engine", detail(STEP, steps[0])) : "")
      );
    }
    return (
      section(sel.name, table("stage", STAGE, rows, label) + notes(rows.flatMap(stageNotes)), `${rows.length} stages`) +
      section("as step engines", table("engine", STEP, steps, label))
    );
  }
  const rows = j.pools.filter((p) => p.name === sel.name);
  if (rows.length === 0) return `<p class="dim">No pool named ${esc(sel.name)} in this report.</p>`;
  if (rows.length === 1) return section(label(rows[0]), detail(POOL, rows[0]) + notes(poolNotes(rows[0])), "pool");
  return section(sel.name, table("pool", POOL, rows, label) + notes(rows.flatMap(poolNotes)), `${rows.length} pools`);
}

/** The components a report has, each once: the chips, in the report's order. */
export function components(j: Report): NonNullable<Selection>[] {
  const out: NonNullable<Selection>[] = [];
  const seen = new Set<string>();
  for (const s of j.stages) if (!seen.has(`s:${s.name}`)) seen.add(`s:${s.name}`) && out.push({ kind: "stage", name: s.name });
  for (const p of j.pools) if (!seen.has(`p:${p.name}`)) seen.add(`p:${p.name}`) && out.push({ kind: "pool", name: p.name });
  return out;
}

function chips(j: Report, sel: Selection, whole: boolean): string {
  const chip = (c: NonNullable<Selection> | null, text: string) =>
    `<button class="chip" data-kind="${c ? c.kind : ""}" data-name="${c ? esc(c.name) : ""}" aria-pressed="${
      (c === null && sel === null) || (c !== null && sel !== null && c.kind === sel.kind && c.name === sel.name)
    }">${esc(text)}</button>`;
  const all = components(j);
  const stages = all.filter((c) => c.kind === "stage");
  const pools = all.filter((c) => c.kind === "pool");
  return (
    `<div class="chips">${whole ? chip(null, "all") : ""}` +
    (stages.length ? `<span class="dim">stages</span>${stages.map((c) => chip(c, c.name)).join("")}` : "") +
    (pools.length ? `<span class="dim">pools</span>${pools.map((c) => chip(c, c.name)).join("")}` : "") +
    `</div>`
  );
}

/** The report as HTML: the chips to choose a component, then the whole
 * report or the chosen component. Without `whole`, there is no "all" chip
 * and nothing but the chips until a component is chosen. */
export function render(j: Report, sel: Selection, whole = true): string {
  return chips(j, sel, whole) + (sel ? one(j, sel) : whole ? overview(j) : "");
}
