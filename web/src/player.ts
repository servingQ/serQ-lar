// Replays serQ's run log over the deployment view. Each session is a
// circle: hollow while it waits in a pool's queue, filled once admitted
// and while it runs; orange in a prefill, blue in a decode, grey on any
// other stage (a NIC transfer, a tool). A ring marks the requests in the
// forward pass an engine is running, and the engine's budget bar fills
// with that pass's tokens. A session on a stage the figure does not draw
// (the workload's tool) parks, dimmed, past the exit.

import type { Anchors, Box, Point } from "./anchors";
import { label, who, whoOf, type Log, type LogEvent, type Named } from "./events";

type Mode = "prefill" | "decode" | "plain";

/** Where a session is, as the log last put it. */
type Where =
  | { kind: "source" }
  | { kind: "queue"; pool: number; seq: number }
  | { kind: "held"; pool: number; seq: number }
  | { kind: "run"; stages: number[]; mode: Mode; since: number; until: number }
  | { kind: "ready"; stage: number }
  /** Ended, leaving by the exit from `from` (the stage it was last on). */
  | { kind: "gone"; from?: string };

export interface Mover {
  key: string;
  s: number;
  leg?: number;
  turn: number;
  where: Where;
  /** Drawn position, eased toward the target each frame. */
  x: number;
  y: number;
  alpha: number;
  /** Wall-clock time of its last preemption, for a flash. */
  flashed: number;
  preemptions: number;
  arrived: number;
}

interface Iter {
  t: number;
  dur: number;
  /** The keys of the requests in the batch. */
  reqs: Set<string>;
  tokens: number;
}

/** What the tooltip says about a session. */
export interface Hit {
  mover: Mover;
  text: string;
  x: number;
  y: number;
}

const R = 3.2; // circle radius, in figure points
const GAP = 8.5;

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class Player {
  t = 0;
  /** Simulated seconds per wall-clock second. */
  speed = 1;
  playing = false;
  onTick: (t: number) => void = () => {};
  /** A session the viewer clicked: drawn larger, its tooltip kept. */
  pinned: string | null = null;

  private next = 0; // index of the first event not yet applied
  private movers = new Map<string, Mover>();
  private iters = new Map<number, Iter>();
  private seq = 0;
  private last = 0;
  private ctx: CanvasRenderingContext2D;
  private alive = true;
  /** Per run event (by index): when the run ends, the session's next `done`. */
  private until: Map<number, number>;
  /** Per stage name: the most tokens one of its iterations scheduled, the budget bar's scale. */
  private peak = new Map<string, number>();
  private stageName: string[];
  private poolName: string[];

  constructor(
    private log: Log,
    private at: Anchors,
    /** Per pool (by index): the stage whose entrance its queue is at, if the IR says. */
    private poolStage: Map<number, string>,
    private canvas: HTMLCanvasElement,
    public horizon: number,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.stageName = log.stages.map((s) => s.name);
    this.poolName = log.pools.map((p) => p.name);
    this.until = runEnds(log.events, horizon);
    for (const e of log.events) {
      if (e.ev !== "iter") continue;
      const n = this.stageName[e.stage];
      this.peak.set(n, Math.max(this.peak.get(n) ?? 0, e.tokens));
    }
    requestAnimationFrame(this.frame);
  }

  /** End the animation loop: a new figure gets a new player. */
  stop() {
    this.alive = false;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const b of this.at.budgets.values()) b.rect.setAttribute("width", String(b.full * 0.62));
  }

  /** Jump to time `t`, replaying from the start if it is behind us. */
  seek(t: number) {
    if (t < this.t) {
      this.next = 0;
      this.movers.clear();
      this.iters.clear();
    }
    this.t = t;
    this.apply(true);
  }

  counts() {
    let queue = 0;
    let resident = 0;
    let away = 0;
    for (const m of this.movers.values()) {
      switch (m.where.kind) {
        case "queue":
        case "held":
          queue++;
          break;
        case "run":
          if (this.stationOf(m.where.stages[0])) resident++;
          else away++;
          break;
        case "ready":
          resident++;
          break;
      }
    }
    return { queue, resident, away };
  }

  /** The session under the figure point `(x, y)`, if any. */
  hit(x: number, y: number): Hit | null {
    let best: Mover | null = null;
    let d2 = (R + 2) ** 2;
    for (const m of this.movers.values()) {
      if (m.where.kind === "gone") continue;
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d < d2) {
        d2 = d;
        best = m;
      }
    }
    return best && { mover: best, text: this.describe(best), x: best.x, y: best.y };
  }

  describe(m: Mover): string {
    const w = m.where;
    const name = m.leg === undefined ? `session ${m.s}` : `session ${m.s}, leg ${m.leg}`;
    const turn = m.turn ? ` · turn ${m.turn}` : "";
    let at: string;
    switch (w.kind) {
      case "source":
        at = "arriving";
        break;
      case "queue":
        at = `waiting at ${label(this.log.pools[w.pool])}`;
        break;
      case "held":
        at = `admitted at ${label(this.log.pools[w.pool])}`;
        break;
      case "run": {
        const where = w.stages.map((k) => label(this.log.stages[k])).join(" + ");
        const what = w.mode === "plain" ? "on" : w.mode + " on";
        at = `${what} ${where} since ${w.since.toFixed(3)} s`;
        break;
      }
      case "ready":
        at = `done at ${label(this.log.stages[w.stage])}`;
        break;
      case "gone":
        at = "ended";
    }
    const pre = m.preemptions ? ` · preempted ×${m.preemptions}` : "";
    return `${name}${turn}\n${at}${pre}`;
  }

  private apply(snap: boolean) {
    const ev = this.log.events;
    while (this.next < ev.length && ev[this.next].t <= this.t) {
      const i = this.next++;
      const e = ev[i];
      if (e.ev === "iter") {
        this.iters.set(e.stage, { t: e.t, dur: e.dur, reqs: new Set(e.reqs.map(whoOf)), tokens: e.tokens });
        continue;
      }
      const key = who(e);
      let m = this.movers.get(key);
      if (!m) {
        const src = this.source();
        m = { key, s: e.s, leg: e.leg, turn: 0, where: { kind: "source" }, x: src.x, y: src.y, alpha: 1, flashed: 0, preemptions: 0, arrived: e.t };
        this.movers.set(key, m);
      }
      switch (e.ev) {
        case "arrive":
        case "fork":
          break;
        case "turn":
          m.turn = e.turn;
          break;
        case "wait":
          m.where = { kind: "queue", pool: e.pool, seq: this.seq++ };
          break;
        case "admit":
          m.where = { kind: "held", pool: e.pool, seq: m.where.kind === "queue" ? m.where.seq : this.seq++ };
          break;
        case "run":
          m.where = { kind: "run", stages: e.stages, mode: e.mode ?? "plain", since: e.t, until: this.until.get(i) ?? this.horizon };
          break;
        case "done":
          m.where = { kind: "ready", stage: e.stage };
          break;
        case "preempt":
        case "revoke":
          m.preemptions++;
          if (!snap) m.flashed = performance.now();
          break;
        case "refuse":
        case "end": {
          const w = m.where;
          const from = w.kind === "ready" ? this.stageName[w.stage] : w.kind === "run" ? this.stageName[w.stages[0]] : undefined;
          m.where = { kind: "gone", from };
          break;
        }
      }
    }
    for (const [k, m] of this.movers) if (m.where.kind === "gone" && (snap || m.alpha <= 0)) this.movers.delete(k);
    if (snap) {
      const targets = this.targets();
      for (const [k, m] of this.movers) {
        const p = targets.get(k);
        if (p) Object.assign(m, p);
        m.alpha = m.where.kind === "gone" ? 0 : 1;
      }
    }
  }

  private stationOf(stage: number): Box | undefined {
    return this.at.stations.get(this.stageName[stage]);
  }

  /** Where new sessions come from: the start of the arrival arrow. */
  private source(): Point {
    const a = this.at.arrival[0];
    if (a) return { x: a.x + 4, y: a.y };
    const first = [...this.at.stations.values()][0];
    return { x: 10, y: first ? first.y + first.h / 2 : this.at.height / 2 };
  }

  /** Where an ended session goes: the end of the exit arrow from the stage
   * it was last on, else the last exit arrow. */
  private sink(from?: string): Point {
    const exits = this.at.exits;
    const e = (from && exits.find((x) => x.from === from)) || exits[exits.length - 1];
    if (e && e.pts.length) return e.pts[e.pts.length - 1];
    return { x: this.at.width - 10, y: this.at.height / 2 };
  }

  /** The entrance a pool's queue is drawn at: its queue glyph, else its stage's left edge, else its drum. */
  private entrance(pool: number): { x: number; y: number; lane: boolean } {
    const a = this.at.pools.get(this.poolName[pool]);
    if (a?.queue) return { x: a.queue.x + a.queue.w - 4, y: a.queue.y + a.queue.h / 2, lane: true };
    const st = this.poolStage.get(pool);
    const box = st ? this.at.stations.get(st) : undefined;
    if (box) return { x: box.x - 8, y: box.y + box.h / 2, lane: true };
    if (a) return { x: a.drum.x - 6, y: a.drum.y + a.drum.h / 2, lane: true };
    const s = this.source();
    return { x: s.x + 20, y: s.y, lane: true };
  }

  /** Each live session's target position. */
  private targets(): Map<string, Point> {
    const out = new Map<string, Point>();
    const queued = new Map<number, Mover[]>();
    const resident = new Map<string, Mover[]>();
    const away: Mover[] = [];
    for (const m of this.movers.values()) {
      const w = m.where;
      if (w.kind === "queue" || w.kind === "held") {
        const q = queued.get(w.pool) ?? [];
        q.push(m);
        queued.set(w.pool, q);
      } else if (w.kind === "run") {
        const first = this.stageName[w.stages[0]];
        const drawn = w.stages.filter((k) => this.stationOf(k));
        if (drawn.length >= 2) {
          // a flow over two stations: along the line between them, by progress
          const a = this.stationOf(drawn[0])!;
          const b = this.stationOf(drawn[drawn.length - 1])!;
          const p = Math.min(1, Math.max(0, (this.t - w.since) / Math.max(1e-9, w.until - w.since)));
          out.set(m.key, { x: a.x + a.w / 2 + (b.x + b.w / 2 - a.x - a.w / 2) * p, y: a.y + a.h / 2 + (b.y + b.h / 2 - a.y - a.h / 2) * p });
        } else if (drawn.length === 1) {
          const name = this.stageName[drawn[0]];
          const r = resident.get(name) ?? [];
          r.push(m);
          resident.set(name, r);
        } else if (this.at.stations.has(first)) {
          // unreachable: kept for the type
        } else away.push(m);
      } else if (w.kind === "ready") {
        const name = this.stageName[w.stage];
        const r = resident.get(name) ?? [];
        r.push(m);
        resident.set(name, r);
      } else if (w.kind === "gone") {
        out.set(m.key, this.sink(w.from));
      }
    }
    for (const [pool, list] of queued) {
      list.sort((a, b) => seqOf(a) - seqOf(b));
      const e = this.entrance(pool);
      list.forEach((m, k) => out.set(m.key, queuePos(e, k)));
    }
    for (const [name, list] of resident) {
      const box = this.at.stations.get(name)!;
      list.sort((a, b) => sinceOf(a) - sinceOf(b));
      list.forEach((m, k) => out.set(m.key, slotPos(box, k)));
    }
    const s = this.sink();
    away.sort((a, b) => sinceOf(a) - sinceOf(b));
    away.forEach((m, k) => out.set(m.key, { x: s.x + 14 + (k % 4) * GAP, y: s.y + 16 + Math.floor(k / 4) * GAP }));
    return out;
  }

  private frame = (now: number) => {
    if (!this.alive) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (this.playing) {
      this.t = Math.min(this.horizon, this.t + dt * this.speed);
      if (this.t >= this.horizon) this.playing = false;
      this.apply(false);
      this.onTick(this.t);
    }
    const targets = this.targets();
    const ease = 1 - Math.exp(-dt * 12);
    for (const [k, m] of this.movers) {
      const p = targets.get(k);
      if (p) {
        m.x += (p.x - m.x) * ease;
        m.y += (p.y - m.y) * ease;
      }
      if (m.where.kind === "gone") m.alpha -= dt * 3;
    }
    this.draw(now);
    requestAnimationFrame(this.frame);
  };

  private draw(now: number) {
    const { canvas, ctx, at } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const k = (w / at.width) * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, at.width, at.height);
    const colours = { prefill: css("--prefill"), decode: css("--decode"), plain: css("--plain") };
    const busy = css("--busy");
    const alert = css("--alert");
    const ink = css("--ink");

    // the forward pass each engine runs now: a band across its top filling as it
    // runs, and its budget bar at the pass's tokens (members of an array share the
    // station: the latest pass among them)
    const running = new Map<string, Iter>();
    for (const [stage, it] of this.iters) {
      if (this.t > it.t + it.dur) continue;
      const name = this.stageName[stage];
      const prev = running.get(name);
      if (!prev || it.t > prev.t) running.set(name, it);
    }
    for (const [name, b] of at.budgets) {
      const it = running.get(name);
      const peak = this.peak.get(name) ?? 1;
      b.rect.setAttribute("width", String(it ? Math.max(1, b.full * (it.tokens / peak)) : 0));
    }
    for (const [name, it] of running) {
      const box = at.stations.get(name);
      if (!box) continue;
      const done = Math.min(1, (this.t - it.t) / it.dur);
      ctx.fillStyle = busy;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(box.x + 1, box.y - 4, (box.w - 2) * done, 3);
      ctx.globalAlpha = 1;
    }

    // a veil over each occupied station's glyph, so its residents read over it
    const occupied = new Map<string, { waiting: number; running: number }>();
    for (const m of this.movers.values()) {
      const w = m.where;
      let name: string | undefined;
      let waiting = false;
      if (w.kind === "run" || w.kind === "ready") name = this.stageName[w.kind === "run" ? w.stages[0] : w.stage];
      else if (w.kind === "queue" || w.kind === "held") {
        name = this.poolStage.get(w.pool);
        waiting = true;
      }
      if (!name || !at.stations.has(name)) continue;
      const c = occupied.get(name) ?? { waiting: 0, running: 0 };
      if (waiting) c.waiting++;
      else c.running++;
      occupied.set(name, c);
    }
    ctx.fillStyle = css("--veil");
    for (const [name, c] of occupied) {
      const box = at.stations.get(name)!;
      if (c.running) ctx.fillRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    }
    // the tally under each station's bottom-right corner
    ctx.font = "7px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = css("--dim");
    for (const [name, c] of occupied) {
      const box = at.stations.get(name)!;
      const parts = [];
      if (c.waiting) parts.push(`${c.waiting} waiting`);
      if (c.running) parts.push(`${c.running} in`);
      ctx.fillText(parts.join(" · "), box.x + box.w - 2, box.y + box.h + 9);
    }
    ctx.textAlign = "left";
    // the sessions away at a stage the figure does not draw
    const away = this.counts().away;
    if (away) {
      const s = this.sink();
      ctx.fillText(`${away} at a tool`, s.x + 12, s.y + 8);
    }

    for (const m of this.movers.values()) {
      const w = m.where;
      const mode: Mode = w.kind === "run" ? w.mode : "plain";
      const colour = w.kind === "run" || w.kind === "ready" ? colours[mode] : colours.prefill;
      const pinned = m.key === this.pinned;
      const r = pinned ? R + 1.5 : R;
      const awayNow = w.kind === "run" && !this.stationOf(w.stages[0]) && !w.stages.some((k) => this.stationOf(k));
      ctx.globalAlpha = Math.max(0, m.alpha) * (awayNow ? 0.35 : 1);
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      if (w.kind === "queue" || w.kind === "source") {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = colour;
        ctx.stroke();
      } else {
        ctx.fillStyle = colour;
        ctx.fill();
        if (w.kind === "run") {
          const it = this.iters.get(w.stages[0]);
          if (it && it.reqs.has(m.key) && this.t <= it.t + it.dur) {
            ctx.beginPath();
            ctx.arc(m.x, m.y, r + 1.8, 0, Math.PI * 2);
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = busy;
            ctx.stroke();
          }
        }
      }
      // a preemption: a red ring that fades over half a second
      const age = (now - m.flashed) / 500;
      if (m.flashed && age < 1) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, r + 2 + age * 4, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = alert;
        ctx.globalAlpha = 1 - age;
        ctx.stroke();
      }
      if (pinned) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

function seqOf(m: Mover): number {
  return m.where.kind === "queue" || m.where.kind === "held" ? m.where.seq : 0;
}

function sinceOf(m: Mover): number {
  return m.where.kind === "run" ? m.where.since : m.arrived;
}

/** When each `run` ends: the time of the session's next `done`, by the run's index. */
function runEnds(events: LogEvent[], horizon: number): Map<number, number> {
  const open = new Map<string, number>();
  const out = new Map<number, number>();
  events.forEach((e, i) => {
    if (e.ev === "iter") return;
    const k = who(e);
    if (e.ev === "run") open.set(k, i);
    else if (e.ev === "done" || e.ev === "end" || e.ev === "refuse") {
      const j = open.get(k);
      if (j !== undefined) {
        out.set(j, e.t);
        open.delete(k);
      }
    }
  });
  for (const j of open.values()) out.set(j, horizon);
  return out;
}

/** The k-th place in a queue: a column leftward from its entrance, two rows deep. */
function queuePos(e: Point, k: number): Point {
  const perRow = 12;
  const col = k % perRow;
  const row = Math.floor(k / perRow);
  return {
    x: e.x - col * GAP,
    y: e.y + (row % 2 ? 1 : -1) * Math.ceil(row / 2) * GAP,
  };
}

/** The k-th slot inside a station: a grid over it, row by row. */
function slotPos(box: Box, k: number): Point {
  const cols = Math.max(1, Math.floor((box.w - 6) / GAP));
  return {
    x: box.x + 3 + R + 1 + (k % cols) * GAP,
    y: box.y + 3 + R + 1 + Math.floor(k / cols) * GAP,
  };
}

export type { Named };
