// The metrics board under the figure: a row of the run's numbers, then
// panels over the run's time, Prometheus-style, each a window's worth of
// serQ's samples or of the log's state. The numbers are serQ's (the
// report, its samples, its gauges) or counted from its log
// (web/src/metrics.ts); the windowing and the p50/p90 are the page's
// (docs/metrics.md says which is which).

import { label } from "./events";
import { Panel, fmtOne, type Dots, type Line, type Unit } from "./charts";
import { autoWindow, centres, derive, meanOf, overall, quantiles, rate, stepMean, sumRate, type Derived } from "./metrics";
import type { Ir, Points, Report, Samples } from "./series";

const Q = [0.5, 0.9, 0.99];
const QC = ["--q50", "--q90", "--q99"];
const QN = ["p50", "p90", "p99"];

/** The k-th entity's colour: the categorical slots, in fixed order. */
const slot = (k: number) => `--c${(k % 8) + 1}`;

/** The gauge the page would add for a pool, by the pool's row in the IR. */
export interface PoolGauge {
  /** `used_D_kv_0` */
  name: string;
  /** `gauge used_D_kv_0 = used(D[0].kv);` */
  line: string;
  pool: number;
  cap: number;
}

/** A `gauge used_… = used(…)` for every pool of finite capacity, in the IR's order (serQ accepts `P[0].kv` for the member of an array). */
export function poolGauges(ir: Ir): PoolGauge[] {
  const out: PoolGauge[] = [];
  ir.pools.forEach((p, i) => {
    if (typeof p.cap !== "number" || !Number.isFinite(p.cap)) return;
    const index = p.index ?? null;
    const [head, ...rest] = p.name.split(".");
    const path = [index === null ? head : `${head}[${index}]`, ...rest].join(".");
    const name = `used_${p.name.replace(/\./g, "_")}${index === null ? "" : `_${index}`}`;
    out.push({ name, line: `  gauge ${name} = used(${path});`, pool: i, cap: p.cap });
  });
  return out;
}

/** The program with the gauge lines added before `main`'s closing brace. */
export function withGauges(src: string, lines: string[]): string {
  const k = src.trimEnd().lastIndexOf("}");
  if (k < 0) return src;
  return `${src.slice(0, k)}  // serq-lar: pool usage, one gauge per pool\n${lines.join("\n")}\n${src.slice(k)}`;
}

interface Hosts {
  tiles: HTMLElement;
  panels: HTMLElement;
  observes: HTMLElement;
  observesBox: HTMLDetailsElement;
  window: HTMLSelectElement;
  gauges: HTMLButtonElement;
  note: HTMLElement;
}

export class Dashboard {
  onSeek: (t: number) => void = () => {};
  onAddGauges: (lines: string[]) => void = () => {};
  private panels: Panel[] = [];
  private last: { report: Report; ir: Ir; H: number; derived: Derived } | null = null;
  private at = 0;
  private pending: string[] = [];

  constructor(private h: Hosts) {
    h.window.onchange = () => this.last && this.build();
    h.gauges.onclick = () => this.onAddGauges(this.pending);
    const dark = matchMedia("(prefers-color-scheme: dark)");
    dark.addEventListener("change", () => this.cursor(this.at));
  }

  show(report: Report, ir: Ir, H: number) {
    this.last = { report, ir, H, derived: derive(report.log) };
    this.build();
  }

  cursor(t: number) {
    this.at = t;
    for (const p of this.panels) p.cursor(t);
  }

  clear() {
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.h.tiles.replaceChildren();
    this.h.observes.replaceChildren();
    this.h.observesBox.hidden = true;
    this.h.gauges.hidden = true;
    this.h.note.textContent = "";
    this.last = null;
  }

  private window(H: number): number {
    const v = Number(this.h.window.value);
    return v > 0 ? Math.min(v, H) : autoWindow(H);
  }

  private add(host: HTMLElement, title: string, unit: Unit, note: string, H: number, x: number[], lines: Line[], dots: Dots[] = [], yMax?: number) {
    const p = new Panel({ title, unit, note });
    p.onSeek = (t) => this.onSeek(t);
    p.set(H, x, lines, dots, yMax);
    p.cursor(this.at);
    host.append(p.el);
    this.panels.push(p);
  }

  private build() {
    if (!this.last) return;
    const { report, ir, H, derived: d } = this.last;
    const log = report.log;
    for (const p of this.panels) p.destroy();
    this.panels = [];
    const w = this.window(H);
    const x = centres(H, w);
    const win = `${w} s windows`;
    const stageName = log.stages.map(label);
    const poolName = log.pools.map(label);
    const engines = ir.stages.map((s, i) => (typeof s.kind === "object" && "Step" in s.kind ? i : -1)).filter((i) => i >= 0);

    // ---- the numbers of the run
    this.tiles(report, d, H, engines, stageName);

    // ---- the client's metrics: what each turn saw
    const host = this.h.panels;
    host.replaceChildren();
    const client: [string, string][] = [
      ["ttft", "Time to first token"],
      ["tpot", "Time per output token"],
      ["response", "Response time"],
    ];
    for (const [key, title] of client) {
      const s = report.series.client[key];
      if (!s || s.t.length === 0) continue;
      const qs = quantiles(s, H, w, Q);
      this.add(
        host,
        title,
        "s",
        `serQ's client.${key} · ${win}`,
        H,
        x,
        qs.map((y, i) => ({ name: QN[i], color: QC[i], y })),
        [{ name: "each turn", color: "--dim", t: s.t, v: s.v }],
      );
    }

    // ---- traffic
    const answered = report.series.client.response;
    const traffic: Line[] = [{ name: "arrived", color: "--c1", y: rate(d.arrivals, H, w) }];
    if (answered && answered.t.length) traffic.push({ name: "answered", color: "--c3", y: rate(answered.t, H, w) });
    traffic.push({ name: "ended", color: "--c7", y: rate(d.ends, H, w) });
    this.add(host, "Requests", "per_s", `the log's arrive and end, serQ's client.response · ${win}`, H, x, traffic);

    // ---- the engines
    const its = engines.filter((i) => d.iters.has(i));
    if (its.length) {
      const line = (f: (i: number) => (number | null)[]) => its.map((i, k) => ({ name: stageName[i], color: slot(k), y: f(i) }));
      this.add(host, "Tokens scheduled", "tok_per_s", `the log's iter.tokens · ${win}`, H, x, line((i) => sumRate(d.iters.get(i)!.t, d.iters.get(i)!.tokens, H, w)));
      this.add(host, "Batch size", "count", `requests per iteration, the log's iter.reqs · ${win}`, H, x, line((i) => meanOf(d.iters.get(i)!.t, d.iters.get(i)!.batch, H, w)));
      this.add(host, "Iteration time", "s", `the log's iter.dur · ${win}`, H, x, line((i) => meanOf(d.iters.get(i)!.t, d.iters.get(i)!.dur, H, w)));
    }
    for (const i of engines) {
      const r = d.running.get(i);
      if (!r) continue;
      this.add(host, `Running on ${stageName[i]}`, "count", `the log's run and done · ${win}`, H, x, [
        { name: "prefill", color: "--prefill", y: stepMean(r.prefill, H, w) },
        { name: "decode", color: "--decode", y: stepMean(r.decode, H, w) },
      ]);
    }
    const others = [...d.running.keys()].filter((i) => !engines.includes(i)).slice(0, 8);
    if (others.length) {
      this.add(
        host,
        "On other stages",
        "count",
        `a transfer, a tool: the log's run and done · ${win}`,
        H,
        x,
        others.map((i, k) => ({ name: stageName[i], color: slot(k), y: stepMean(d.running.get(i)!.plain, H, w) })),
      );
    }

    // ---- the queues
    const queues = [...d.waiting.entries()].filter(([, p]) => p.v.some((v) => v > 0)).slice(0, 8);
    if (queues.length) {
      this.add(
        host,
        "Waiting",
        "count",
        `in a pool's queue: the log's wait and admit · ${win}`,
        H,
        x,
        queues.map(([i, p], k) => ({ name: poolName[i], color: slot(k), y: stepMean(p, H, w) })),
      );
    }
    const waits = [...d.queueWait.entries()].filter(([, s]) => s.v.some((v) => v > 0)).slice(0, 8);
    if (waits.length) {
      this.add(
        host,
        "Queue wait",
        "s",
        `from wait to admit in the log, mean per admission · ${win}`,
        H,
        x,
        waits.map(([i, s], k) => ({ name: poolName[i], color: slot(k), y: meanOf(s.t, s.v, H, w) })),
        waits.length === 1 ? [{ name: "each admission", color: "--dim", t: waits[0][1].t, v: waits[0][1].v }] : [],
      );
    }
    if (d.preempts.length || d.refuses.length) {
      this.add(host, "Preemptions and refusals", "per_s", `the log's preempt and refuse · ${win}`, H, x, [
        { name: "preempted", color: "--alert", y: rate(d.preempts, H, w) },
        { name: "refused", color: "--c4", y: rate(d.refuses, H, w) },
      ]);
    }

    // ---- the pools' usage: a gauge per pool, the program's or the page's
    const wanted = poolGauges(ir);
    const usage: Line[] = [];
    const generated = new Set<string>();
    wanted.forEach((g, k) => {
      const pts = report.series.gauges[g.name];
      if (!pts) return;
      generated.add(g.name);
      const ratio: Points = { t: pts.t, v: pts.v.map((v) => v / g.cap) };
      usage.push({ name: `${label({ name: ir.pools[g.pool].name, index: ir.pools[g.pool].index ?? null })} (cap ${g.cap.toLocaleString("en")})`, color: slot(k), y: stepMean(ratio, H, w) });
    });
    if (usage.length) this.add(host, "Pool usage", "ratio", `used / cap, serQ's gauges · ${win}`, H, x, usage.slice(0, 8));
    this.pending = wanted.filter((g) => !generated.has(g.name)).map((g) => g.line);
    this.h.gauges.hidden = this.pending.length === 0;
    this.h.note.textContent =
      this.pending.length === 0
        ? ""
        : usage.length
          ? `${this.pending.length} pool(s) have no usage gauge yet.`
          : "KV and slot usage over time needs a gauge in the program: this one declares none for its pools. The button appends one gauge per pool (used(kv), …) to the program and runs it again.";
    for (const [name, pts] of Object.entries(report.series.gauges)) {
      if (generated.has(name)) continue;
      const row = report.gauges[name];
      const sub = row && row.mean !== null ? `gauge · mean ${fmtOne(row.mean, "value")} · ${win}` : `gauge · ${win}`;
      this.add(host, name, "value", sub, H, x, [{ name, color: "--c1", y: stepMean(pts, H, w) }]);
    }

    // ---- the program's own observations
    const obs = Object.entries(report.series.observes).filter(([, s]) => s.t.length > 0);
    this.h.observes.replaceChildren();
    this.h.observesBox.hidden = obs.length === 0;
    const sum = this.h.observesBox.querySelector("summary");
    if (sum) sum.textContent = `The program's observes (${obs.length})`;
    for (const [name, s] of obs) this.observe(this.h.observes, name, s, H, w, x);
  }

  private observe(host: HTMLElement, name: string, s: Samples, H: number, w: number, x: number[]) {
    const row = this.last!.report.observes[name];
    const sub = row && row.mean !== null ? `observe · mean ${fmtOne(row.mean, "value")} · p99 ${fmtOne(row.p99, "value")}` : "observe";
    this.add(host, name, "value", sub, H, x, [{ name: "mean per window", color: "--c1", y: meanOf(s.t, s.v, H, w) }], [{ name: "each sample", color: "--dim", t: s.t, v: s.v }]);
  }

  private tiles(report: Report, d: Derived, H: number, engines: number[], stageName: string[]) {
    const host = this.h.tiles;
    host.replaceChildren();
    const tile = (labelText: string, value: string, sub: string) => {
      const el = document.createElement("div");
      el.className = "tile";
      const l = document.createElement("div");
      l.className = "tile-label";
      l.textContent = labelText;
      const v = document.createElement("div");
      v.className = "tile-value";
      v.textContent = value;
      const s = document.createElement("div");
      s.className = "tile-sub";
      s.textContent = sub;
      el.append(l, v, s);
      host.append(el);
    };
    const span = Math.max(report.end - report.warmup, 1e-9);
    for (const [key, name] of [
      ["ttft", "TTFT"],
      ["tpot", "TPOT"],
      ["response", "Response"],
    ] as const) {
      const row = report.client[key];
      const s = report.series.client[key];
      if (!row || row.count === 0) {
        tile(name, "–", "no turn measured it");
        continue;
      }
      const p50 = s ? overall(s, 0.5) : null;
      const p90 = s ? overall(s, 0.9) : null;
      tile(`${name} mean`, fmtOne(row.mean, "s"), `p50 ${fmtOne(p50, "s")} · p90 ${fmtOne(p90, "s")} · p99 ${fmtOne(row.p99, "s")} · ${row.count} turns`);
    }
    tile("Requests", `${(report.turns / span).toFixed(2)}/s`, `${report.turns} turns answered · ${report.arrivals} sessions arrived · ${report.ended} ended`);
    const tok = d.tokens / Math.min(span, H);
    tile("Tokens scheduled", fmtOne(tok, "tok_per_s"), report.log.truncated ? "from the log, which the cap cut short" : "from the log, over every engine iteration");
    const pre = report.pools.reduce((a, p) => a + p.preemptions, 0);
    const rej = report.pools.reduce((a, p) => a + p.rejected, 0);
    tile("Preemptions", String(pre), `${rej} rejected · ${report.pools.reduce((a, p) => a + p.evicted_entries, 0)} cache entries evicted`);
    for (const i of engines.slice(0, 4)) {
      const row = report.stages.find((s) => s.name === report.log.stages[i].name && (s.index ?? null) === report.log.stages[i].index);
      if (!row) continue;
      const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(0)} %`);
      tile(`${stageName[i]} busy`, pct(row.utilization), `prefill ${pct(row.prefill_only)} · decode ${pct(row.decode_only)} · mixed ${pct(row.mixed)} · ${row.iterations.toLocaleString("en")} iterations`);
    }
  }
}
