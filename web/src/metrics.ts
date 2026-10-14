// Signals the run log carries that the report does not give over time:
// how many sessions wait in each pool's queue, how many run on each stage
// in which mode, each engine iteration's batch and tokens, and when
// sessions arrive, end, are preempted or refused. `derive` replays the
// log's state once, as the player does (web/src/player.ts), and keeps
// each signal's change points; the bucketing below turns change points
// and samples into one value per time window, the way a scrape interval
// does. Nothing here is a model: it is serQ's log, counted.

import { who, type Log } from "./events";
import type { Points, Samples } from "./series";

/** A step function kept as its change points: the last value set at a time wins. */
class Step {
  t: number[] = [];
  v: number[] = [];
  cur = 0;
  add(t: number, d: number) {
    this.cur += d;
    const n = this.t.length;
    if (n && this.t[n - 1] === t) this.v[n - 1] = this.cur;
    else {
      this.t.push(t);
      this.v.push(this.cur);
    }
  }
}

export interface Iters {
  t: number[];
  dur: number[];
  tokens: number[];
  /** Requests in the batch. */
  batch: number[];
}

export interface Derived {
  /** Per pool index: sessions waiting in its queue. */
  waiting: Map<number, Points>;
  /** Per pool index: each admission's wait, from its `wait` to its `admit`, at the admission's time. */
  queueWait: Map<number, { t: number[]; v: number[] }>;
  /** Per stage index: sessions running on it, by the run's mode. */
  running: Map<number, { prefill: Points; decode: Points; plain: Points }>;
  /** Per engine stage index: its iterations. */
  iters: Map<number, Iters>;
  arrivals: number[];
  ends: number[];
  preempts: number[];
  refuses: number[];
  /** Tokens scheduled over the log, all engines. */
  tokens: number;
}

export function derive(log: Log): Derived {
  const waiting = new Map<number, Step>();
  const running = new Map<number, { prefill: Step; decode: Step; plain: Step }>();
  const iters = new Map<number, Iters>();
  const arrivals: number[] = [];
  const ends: number[] = [];
  const preempts: number[] = [];
  const refuses: number[] = [];
  let tokens = 0;
  const queueWait = new Map<number, { t: number[]; v: number[] }>();
  const queued = new Map<string, { pool: number; since: number }>(); // session key -> the pool it waits at, since when
  const runs = new Map<string, { stages: number[]; mode: "prefill" | "decode" | "plain" }>();

  const wait = (pool: number) => {
    let s = waiting.get(pool);
    if (!s) waiting.set(pool, (s = new Step()));
    return s;
  };
  const run = (stage: number) => {
    let s = running.get(stage);
    if (!s) running.set(stage, (s = { prefill: new Step(), decode: new Step(), plain: new Step() }));
    return s;
  };
  const leaveQueue = (k: string, t: number, admitted = false) => {
    const q = queued.get(k);
    if (q !== undefined) {
      wait(q.pool).add(t, -1);
      queued.delete(k);
      if (admitted) {
        let w = queueWait.get(q.pool);
        if (!w) queueWait.set(q.pool, (w = { t: [], v: [] }));
        w.t.push(t);
        w.v.push(t - q.since);
      }
    }
  };
  const leaveRun = (k: string, t: number) => {
    const r = runs.get(k);
    if (r) {
      for (const st of r.stages) run(st)[r.mode].add(t, -1);
      runs.delete(k);
    }
  };

  for (const e of log.events) {
    if (e.ev === "iter") {
      let it = iters.get(e.stage);
      if (!it) iters.set(e.stage, (it = { t: [], dur: [], tokens: [], batch: [] }));
      it.t.push(e.t);
      it.dur.push(e.dur);
      it.tokens.push(e.tokens);
      it.batch.push(e.reqs.length);
      tokens += e.tokens;
      continue;
    }
    const k = who(e);
    switch (e.ev) {
      case "arrive":
        arrivals.push(e.t);
        break;
      case "wait":
        leaveQueue(k, e.t);
        queued.set(k, { pool: e.pool, since: e.t });
        wait(e.pool).add(e.t, 1);
        break;
      case "admit":
        leaveQueue(k, e.t, true);
        break;
      case "preempt":
        preempts.push(e.t);
        leaveRun(k, e.t);
        break;
      case "refuse":
        refuses.push(e.t);
        leaveQueue(k, e.t);
        break;
      case "run": {
        leaveRun(k, e.t);
        const mode = e.mode ?? "plain";
        runs.set(k, { stages: e.stages, mode });
        for (const st of e.stages) run(st)[mode].add(e.t, 1);
        break;
      }
      case "done":
        leaveRun(k, e.t);
        break;
      case "end":
        if (e.leg === undefined) ends.push(e.t);
        leaveQueue(k, e.t);
        leaveRun(k, e.t);
        break;
    }
  }
  const points = (s: Step): Points => ({ t: s.t, v: s.v });
  return {
    waiting: new Map([...waiting].map(([p, s]) => [p, points(s)])),
    queueWait,
    running: new Map([...running].map(([st, r]) => [st, { prefill: points(r.prefill), decode: points(r.decode), plain: points(r.plain) }])),
    iters,
    arrivals,
    ends,
    preempts,
    refuses,
    tokens,
  };
}

// ------------------------------------------------------------ windows ----

/** A window that cuts the horizon into about 40 buckets, snapped to a round number of seconds. */
export function autoWindow(H: number): number {
  const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300];
  const want = H / 40;
  for (const s of steps) if (s >= want) return s;
  return steps[steps.length - 1];
}

/** The buckets' centres. */
export function centres(H: number, w: number): number[] {
  const n = Math.max(1, Math.ceil(H / w - 1e-9));
  return Array.from({ length: n }, (_, i) => Math.min((i + 0.5) * w, H));
}

function bucketOf(t: number, w: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(t / w)));
}

/** Events per second in each bucket. */
export function rate(times: number[], H: number, w: number): number[] {
  const n = centres(H, w).length;
  const out = new Array<number>(n).fill(0);
  for (const t of times) out[bucketOf(t, w, n)] += 1;
  const last = H - (n - 1) * w; // the last bucket may be short
  return out.map((c, i) => c / (i === n - 1 ? Math.max(last, 1e-9) : w));
}

/** The q-quantile of sorted values (nearest rank). */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[k];
}

function groups(t: number[], v: number[], H: number, w: number): number[][] {
  const n = centres(H, w).length;
  const g: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < t.length; i++) if (Number.isFinite(v[i])) g[bucketOf(t[i], w, n)].push(v[i]);
  return g;
}

/** Per quantile asked, the samples' quantile in each bucket (`null`: no sample there). */
export function quantiles(s: Samples, H: number, w: number, qs: number[]): (number | null)[][] {
  const g = groups(s.t, s.v, H, w);
  for (const b of g) b.sort((a, c) => a - c);
  return qs.map((q) => g.map((b) => (b.length ? quantile(b, q) : null)));
}

/** The samples' mean in each bucket. */
export function meanOf(t: number[], v: number[], H: number, w: number): (number | null)[] {
  return groups(t, v, H, w).map((b) => (b.length ? b.reduce((a, c) => a + c, 0) / b.length : null));
}

/** The samples' sum in each bucket, per second. */
export function sumRate(t: number[], v: number[], H: number, w: number): number[] {
  const n = centres(H, w).length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < t.length; i++) out[bucketOf(t[i], w, n)] += v[i];
  const last = H - (n - 1) * w;
  return out.map((c, i) => c / (i === n - 1 ? Math.max(last, 1e-9) : w));
}

/** The time-weighted mean of a step function in each bucket. */
export function stepMean(p: Points, H: number, w: number): number[] {
  const n = centres(H, w).length;
  const area = new Array<number>(n).fill(0);
  const len = new Array<number>(n).fill(0);
  let cur = 0;
  let from = 0;
  const flush = (to: number) => {
    // spread the value held over [from, to) across the buckets it covers
    let a = from;
    while (a < to) {
      const b = bucketOf(a, w, n);
      const end = Math.min(to, (b + 1) * w, H);
      if (end <= a) break;
      area[b] += cur * (end - a);
      len[b] += end - a;
      a = end;
    }
  };
  for (let i = 0; i < p.t.length; i++) {
    const t = Math.min(p.t[i], H);
    if (t > from) flush(t);
    from = t;
    cur = p.v[i];
  }
  if (from < H) flush(H);
  return area.map((a, i) => (len[i] > 0 ? a / len[i] : 0));
}

/** The whole run's quantile of a metric's samples. */
export function overall(s: Samples, q: number): number | null {
  const v = s.v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? quantile(v, q) : null;
}
