// Replays serQ's run log over the deployment view. Each session is a
// circle: hollow while it waits in a pool's queue, filled once admitted
// and while it runs; orange in a prefill, blue in a decode, grey on any
// other stage (a NIC, a tool). A ring marks the requests in the forward
// pass an engine is running, and the engine's budget bar fills with that
// pass's tokens. A session on a stage the figure does not draw (the
// workload's tool) parks, dimmed, past the exit.
//
// A session is where its latest run put it: in that run's first drawn
// station (a transfer over two NICs stages at the first). A wait moves it
// to the pool's queue only when that is where its next run is (the log
// says): a reservation elsewhere, such as the decoder's KV before the
// transfer, leaves it where it stands, hollow. Between stations it travels
// along the figure's arrows at a pace of its own: a hop takes a fraction of
// a wall-clock second whatever the playback speed, since in the simulation
// it takes no time. When nothing is in any station, time can skip to the
// next event (`skipIdle`): a tool call of seconds passes in a blink, an
// iteration of milliseconds plays at the chosen speed.

import type { Anchors, Box, Point } from "./anchors";
import type { Camera } from "./camera";
import { label, who, whoOf, type Log, type LogEvent, type Named } from "./events";

type Mode = "prefill" | "decode" | "plain";

/** Where a session is, as the log last put it. */
type Where =
  | { kind: "source" }
  /** In a pool's queue; `moved` there (its next run is at that pool's stage), or waiting where it stands. */
  | { kind: "queue"; pool: number; seq: number; moved: boolean }
  | { kind: "held"; pool: number; seq: number; moved: boolean }
  | { kind: "run"; stages: number[]; mode: Mode; since: number; until: number }
  | { kind: "ready"; stage: number }
  /** Ended, leaving by the exit from `from` (the node it was last at). */
  | { kind: "gone"; from?: string };

/** A way along the figure's arrows: points, and the indices after which the
 * session is carried rather than drawn moving (from where it parked to the
 * arrival, out by an exit and in again: a new turn). */
interface Path {
  pts: Point[];
  jumps: Set<number>;
  /** Cumulative length at each point. */
  at: number[];
  len: number;
  /** Length travelled so far. */
  pos: number;
}

export interface Mover {
  key: string;
  s: number;
  leg?: number;
  turn: number;
  where: Where;
  /** The figure node (a station, or a decision `#k`) it was last placed at. */
  node?: string;
  /** At the workload (a tool), not in the deployment: parked past the exit. */
  away: boolean;
  path: Path | null;
  /** Drawn position, eased toward the target each frame unless on a path. */
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
/** Wall-clock seconds a hop along the arrows takes. */
const HOP = 0.5;

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class Player {
  t = 0;
  /** Simulated seconds per wall-clock second, while something is happening. */
  speed = 1;
  /** Jump to the next event when no session is in any station or queue. */
  skipIdle = true;
  playing = false;
  onTick: (t: number) => void = () => {};
  /** A session the viewer clicked: drawn larger, its tooltip kept. */
  pinned: string | null = null;
  /** Whether the last frame skipped idle time. */
  skipping = false;

  private next = 0; // index of the first event not yet applied
  private movers = new Map<string, Mover>();
  private iters = new Map<number, Iter>();
  private seq = 0;
  private last = 0;
  private ctx: CanvasRenderingContext2D;
  private alive = true;
  /** Per run event (by index): when the run ends, the session's next `done`. */
  private until: Map<number, number>;
  /** The wait events (by index) that move the session to the pool's queue:
   * its next run is at that pool's stage. */
  private moves: Set<number>;
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
    /** The part of the figure in view: the canvas draws as the SVG shows. */
    private camera: Camera,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.stageName = log.stages.map((s) => s.name);
    this.poolName = log.pools.map((p) => p.name);
    this.until = runEnds(log.events, horizon);
    this.moves = this.waitMoves();
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

  /** Pause and move to the next event (or the one after a tie at this instant). */
  step() {
    this.playing = false;
    const ev = this.log.events;
    let i = this.next;
    while (i < ev.length && ev[i].t <= this.t) i++;
    if (i < ev.length) {
      this.t = ev[i].t;
      this.apply(false);
    }
  }

  /** The time of the next event not yet applied. */
  nextEventTime(): number {
    const e = this.log.events[this.next];
    return e ? e.t : this.horizon;
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
          if (m.away) away++;
          else resident++;
          break;
        case "ready":
          resident++;
          break;
      }
    }
    return { queue, resident, away };
  }

  /** Whether anything is happening in the figure: a session in a station or
   * a queue, travelling along an arrow, or an iteration under way. */
  busy(): boolean {
    for (const m of this.movers.values()) {
      if (m.path) return true;
      const w = m.where;
      if (w.kind === "queue" || w.kind === "held" || w.kind === "ready") return true;
      if (w.kind === "run" && !m.away) return true;
    }
    for (const [stage, it] of this.iters) if (this.t <= it.t + it.dur && this.stationOf(stage)) return true;
    return false;
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

  /** The wait events whose pool's stage is where the session runs next: the
   * ones that move it there. A wait for a pool elsewhere (the decoder's KV,
   * reserved before the transfer) is not a move. */
  private waitMoves(): Set<number> {
    const out = new Set<number>();
    const pending = new Map<string, number[]>();
    this.log.events.forEach((e, i) => {
      if (e.ev === "iter") return;
      const k = who(e);
      if (e.ev === "wait") {
        const list = pending.get(k) ?? [];
        list.push(i);
        pending.set(k, list);
      } else if (e.ev === "run") {
        const drawn = e.stages.find((s) => this.stationOf(s));
        const there = drawn === undefined ? undefined : this.stageName[drawn];
        for (const j of pending.get(k) ?? []) {
          const w = this.log.events[j];
          if (w.ev === "wait" && there !== undefined && this.poolStage.get(w.pool) === there) out.add(j);
        }
        pending.delete(k);
      }
    });
    return out;
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
        m = { key, s: e.s, leg: e.leg, turn: 0, where: { kind: "source" }, away: false, path: null, x: src.x, y: src.y, alpha: 1, flashed: 0, preemptions: 0, arrived: e.t };
        this.movers.set(key, m);
      }
      switch (e.ev) {
        case "arrive":
        case "fork":
          break;
        case "turn":
          m.turn = e.turn;
          break;
        case "wait": {
          const moved = this.moves.has(i);
          m.where = { kind: "queue", pool: e.pool, seq: this.seq++, moved };
          if (moved) {
            m.away = false;
            if (!snap) this.travel(m, this.poolStage.get(e.pool));
          }
          break;
        }
        case "admit": {
          const w = m.where;
          const prior = w.kind === "queue" ? w : null;
          m.where = { kind: "held", pool: e.pool, seq: prior ? prior.seq : this.seq++, moved: prior ? prior.moved : false };
          break;
        }
        case "run": {
          const held = m.where.kind === "queue" || m.where.kind === "held";
          m.where = { kind: "run", stages: e.stages, mode: e.mode ?? "plain", since: e.t, until: this.until.get(i) ?? this.horizon };
          const drawn = e.stages.find((k) => this.stationOf(k));
          if (drawn !== undefined) {
            // into a station: a transfer over two NICs stages at the first
            m.away = false;
            if (!snap) this.travel(m, this.stageName[drawn]);
          } else if (!held) {
            // at the workload: out of the deployment until something takes it in
            m.away = true;
            if (!snap) this.travel(m, undefined, true);
          }
          // else: a run on a stage the figure does not draw, inside a hold:
          // it stays where it was admitted
          break;
        }
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
          m.where = { kind: "gone", from: m.node };
          if (!snap) this.travel(m, undefined, true);
          break;
        }
      }
    }
    for (const [k, m] of this.movers) if (m.where.kind === "gone" && (snap || m.alpha <= 0)) this.movers.delete(k);
    if (snap) {
      for (const m of this.movers.values()) m.node = this.nodeOf(m);
      const targets = this.targets();
      for (const [k, m] of this.movers) {
        const p = targets.get(k);
        if (p) Object.assign(m, p);
        m.path = null;
        m.alpha = m.where.kind === "gone" ? 0 : 1;
      }
    }
  }

  /** The figure node a session's state puts it at: the stage of a queue it
   * moved to, the station of its run, else where it already stands. */
  private nodeOf(m: Mover): string | undefined {
    const w = m.where;
    if (w.kind === "queue" || w.kind === "held") return w.moved ? this.poolStage.get(w.pool) : m.node;
    if (w.kind === "run") {
      const k = w.stages.find((k) => this.stationOf(k));
      return k === undefined ? (m.away ? undefined : m.node) : this.stageName[k];
    }
    if (w.kind === "ready") return this.at.stations.has(this.stageName[w.stage]) ? this.stageName[w.stage] : m.node;
    return undefined;
  }

  /** Send `m` along the arrows to node `to` (a station), or out (`leaving`:
   * by the exit from where it is). From nowhere (an arrival, a return from
   * the workload) it comes in by the arrival arrow; where no arrows join
   * two stations, out by the exit and in again, as a new turn comes. */
  private travel(m: Mover, to: string | undefined, leaving = false) {
    const from = m.node;
    if (to !== undefined && !this.at.stations.has(to)) to = undefined;
    if (to === undefined && !leaving) return;
    if (to !== undefined && to === from) return;
    const segs: { pts: Point[]; jump?: boolean }[] = [];
    if (to === undefined) {
      const ex = this.exitFrom(from);
      if (ex) segs.push({ pts: ex });
    } else {
      const direct = from === undefined ? this.arrivalTo(to) : this.route(from, to);
      if (direct) segs.push(...direct);
      else {
        const ex = this.exitFrom(from);
        if (ex) segs.push({ pts: ex });
        const inAgain = this.arrivalTo(to);
        if (inAgain) {
          inAgain[0].jump = true;
          segs.push(...inAgain);
        }
      }
      // from nowhere, it is carried to the arrival's start, not drawn flying there
      if (from === undefined && segs.length) segs[0].jump = true;
    }
    if (to !== undefined) m.node = to;
    else if (leaving) m.node = undefined;
    if (!segs.length) return;
    // from where it is drawn now, then the arrows
    const pts: Point[] = [{ x: m.x, y: m.y }];
    const jumps = new Set<number>();
    for (const s of segs) {
      if (s.jump) jumps.add(pts.length - 1);
      pts.push(...s.pts);
    }
    const at = [0];
    for (let i = 1; i < pts.length; i++) {
      const d = jumps.has(i - 1) ? 0 : Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      at.push(at[i - 1] + d);
    }
    m.path = { pts, jumps, at, len: at[at.length - 1], pos: 0 };
  }

  /** The arrival arrow, then the arrows from the node it reaches to `to`. */
  private arrivalTo(to: string): { pts: Point[]; jump?: boolean }[] | null {
    const a = this.at.arrival;
    if (!a.pts.length) return null;
    if (a.to === to || a.to === undefined) return [{ pts: a.pts }];
    const rest = this.route(a.to, to);
    return rest ? [{ pts: a.pts }, ...rest] : [{ pts: a.pts }];
  }

  /** The exit arrow from node `from`, else the last exit arrow. */
  private exitFrom(from: string | undefined): Point[] | null {
    const exits = this.at.exits;
    const e = (from !== undefined && exits.find((x) => x.from === from)) || exits[exits.length - 1];
    return e && e.pts.length ? e.pts : null;
  }

  /** The arrows from node `from` to node `to`, the fewest hops, through
   * decisions and across brackets (two stations one job holds at once: a
   * hop between their centres, with no arrow). */
  private route(from: string, to: string): { pts: Point[] }[] | null {
    const prev = new Map<string, { from: string; pts: Point[] }>();
    const queue = [from];
    const seen = new Set([from]);
    const hops = (n: string): { to: string; pts: Point[] }[] => {
      const out = [...(this.at.flows.get(n) ?? [])];
      for (const b of this.at.brackets) {
        if (!b.includes(n)) continue;
        const a = this.at.nodes.get(n);
        for (const other of b) {
          const c = this.at.nodes.get(other);
          if (other !== n && a && c) out.push({ to: other, pts: [centre(a), centre(c)] });
        }
      }
      return out;
    };
    while (queue.length) {
      const n = queue.shift()!;
      for (const f of hops(n)) {
        if (seen.has(f.to)) continue;
        seen.add(f.to);
        prev.set(f.to, { from: n, pts: f.pts });
        if (f.to === to) {
          const segs: { pts: Point[] }[] = [];
          for (let x = to; x !== from; ) {
            const p = prev.get(x)!;
            segs.unshift({ pts: p.pts });
            x = p.from;
          }
          return segs;
        }
        queue.push(f.to);
      }
    }
    return null;
  }

  private stationOf(stage: number): Box | undefined {
    return this.at.stations.get(this.stageName[stage]);
  }

  /** Where new sessions come from: the start of the arrival arrow. */
  private source(): Point {
    const a = this.at.arrival.pts[0];
    if (a) return { x: a.x + 4, y: a.y };
    const first = [...this.at.stations.values()][0];
    return { x: 10, y: first ? first.y + first.h / 2 : this.at.height / 2 };
  }

  /** Where an ended session goes: the end of the exit arrow from the node
   * it was last at, else the last exit arrow. */
  private sink(from?: string): Point {
    const e = this.exitFrom(from);
    if (e) return e[e.length - 1];
    return { x: this.at.width - 10, y: this.at.height / 2 };
  }

  /** The entrance a pool's queue is drawn at: its queue glyph, else its stage's left edge, else its drum. */
  private entrance(pool: number): Point {
    const a = this.at.pools.get(this.poolName[pool]);
    if (a?.queue) return { x: a.queue.x + a.queue.w - 4, y: a.queue.y + a.queue.h / 2 };
    const st = this.poolStage.get(pool);
    const box = st ? this.at.stations.get(st) : undefined;
    if (box) return { x: box.x - 8, y: box.y + box.h / 2 };
    if (a) return { x: a.drum.x - 6, y: a.drum.y + a.drum.h / 2 };
    const s = this.source();
    return { x: s.x + 20, y: s.y };
  }

  /** Each live session's target position: a place in a queue, a slot in a
   * station, the parking past the exit, or the sink. */
  private targets(): Map<string, Point> {
    const out = new Map<string, Point>();
    const queued = new Map<number, Mover[]>();
    const resident = new Map<string, Mover[]>();
    const away: Mover[] = [];
    const at = (name: string, m: Mover) => {
      const r = resident.get(name) ?? [];
      r.push(m);
      resident.set(name, r);
    };
    // where it stands, if that is a station; else parked
    const stay = (m: Mover) => (m.node !== undefined && this.at.stations.has(m.node) ? at(m.node, m) : away.push(m));
    for (const m of this.movers.values()) {
      const w = m.where;
      if (w.kind === "queue" || w.kind === "held") {
        if (w.moved) {
          const q = queued.get(w.pool) ?? [];
          q.push(m);
          queued.set(w.pool, q);
        } else stay(m);
      } else if (w.kind === "run") {
        const k = w.stages.find((k) => this.stationOf(k));
        if (k !== undefined) at(this.stageName[k], m);
        else if (m.away) away.push(m);
        else stay(m);
      } else if (w.kind === "ready") {
        const name = this.stageName[w.stage];
        if (this.at.stations.has(name)) at(name, m);
        else stay(m);
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
    this.skipping = false;
    if (this.playing) {
      let advance = dt * this.speed;
      if (this.skipIdle && !this.busy()) {
        // nothing to see: hurry to the next event, and no further
        this.skipping = true;
        const gap = this.nextEventTime() - this.t;
        advance = Math.min(gap, Math.max(advance * 64, dt * 8));
      }
      this.t = Math.min(this.horizon, this.t + Math.max(0, advance));
      if (this.t >= this.horizon) this.playing = false;
      this.apply(false);
      this.onTick(this.t);
    }
    const targets = this.targets();
    const ease = 1 - Math.exp(-dt * 12);
    for (const [k, m] of this.movers) {
      if (m.path) {
        const p = m.path;
        p.pos += (dt * p.len) / HOP;
        const q = pointAt(p, Math.min(p.pos, p.len));
        m.x = q.x;
        m.y = q.y;
        if (p.pos >= p.len) m.path = null;
        continue;
      }
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(...this.camera.transform(dpr));
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
      if (w.kind === "gone" || w.kind === "source" || m.away) continue;
      const name = this.nodeOf(m);
      if (!name || !at.stations.has(name)) continue;
      const c = occupied.get(name) ?? { waiting: 0, running: 0 };
      if (w.kind === "queue" || w.kind === "held") c.waiting++;
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
      const awayNow = !m.path && m.away;
      // carried, not drawn moving: faint around a jump
      let carried = 1;
      if (m.path) {
        for (const j of m.path.jumps) {
          const d = Math.abs(m.path.pos - m.path.at[j]);
          carried = Math.min(carried, Math.min(1, d / 40));
        }
      }
      ctx.globalAlpha = Math.max(0, m.alpha) * (awayNow ? 0.35 : 1) * (0.2 + 0.8 * carried);
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      if (w.kind === "queue" || w.kind === "source") {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = colour;
        ctx.stroke();
      } else {
        ctx.fillStyle = colour;
        ctx.fill();
        if (w.kind === "run" && !m.path) {
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

function centre(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** The point `d` along a path. */
function pointAt(p: Path, d: number): Point {
  const { pts, at } = p;
  let i = 1;
  while (i < at.length - 1 && at[i] < d) i++;
  const span = at[i] - at[i - 1];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - at[i - 1]) / span)) : 1;
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
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
