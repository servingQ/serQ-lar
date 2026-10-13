// Replays a trace over the deployment view: each request a circle, orange
// in prefill and blue in decode; hollow while it waits in a queue, filled
// while resident, with a halo while a forward pass runs over it.

import type { Anchors, Box } from "./anchors";
import type { Phase, Trace } from "./events";

type Where = "queue" | "resident" | "gone";

interface ReqState {
  where: Where;
  stage: string;
  phase: Phase;
  /** Drawn position, eased toward the target each frame. */
  x: number;
  y: number;
  /** Fade-out after leaving, 1 → 0. */
  alpha: number;
}

interface Forward {
  t: number;
  dur: number;
  reqs: Set<number>;
  tokens: number;
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

  private next = 0; // index of the first event not yet applied
  private reqs = new Map<number, ReqState>();
  private forwards = new Map<string, Forward>();
  private last = 0;
  private ctx: CanvasRenderingContext2D;
  private alive = true;

  constructor(
    private trace: Trace,
    private at: Anchors,
    private canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
    requestAnimationFrame(this.frame);
  }

  /** End the animation loop: a new figure gets a new player. */
  stop() {
    this.alive = false;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Jump to time `t`, replaying from the start if it is behind us. */
  seek(t: number) {
    if (t < this.t) {
      this.next = 0;
      this.reqs.clear();
      this.forwards.clear();
    }
    this.t = t;
    this.apply(true);
  }

  counts() {
    let queue = 0;
    let resident = 0;
    for (const r of this.reqs.values()) {
      if (r.where === "queue") queue++;
      else if (r.where === "resident") resident++;
    }
    return { queue, resident };
  }

  private apply(snap: boolean) {
    const ev = this.trace.events;
    while (this.next < ev.length && ev[this.next].t <= this.t) {
      const e = ev[this.next++];
      if (e.kind === "forward") {
        this.forwards.set(e.stage, { t: e.t, dur: e.dur, reqs: new Set(e.reqs), tokens: e.tokens });
        continue;
      }
      let r = this.reqs.get(e.req);
      if (!r) {
        const src = this.source();
        r = { where: "queue", stage: "", phase: "prefill", x: src.x, y: src.y, alpha: 1 };
        this.reqs.set(e.req, r);
      }
      switch (e.kind) {
        case "wait":
          r.where = "queue";
          r.stage = e.stage;
          break;
        case "admit":
          r.where = "resident";
          r.stage = e.stage;
          r.phase = e.phase;
          break;
        case "phase":
          r.phase = e.phase;
          break;
        case "preempt":
          r.where = "queue";
          r.phase = "prefill";
          break;
        case "leave":
          r.where = "gone";
          break;
      }
    }
    for (const [id, r] of this.reqs) if (r.where === "gone" && (snap || r.alpha <= 0)) this.reqs.delete(id);
    if (snap) {
      const targets = this.targets();
      for (const [id, r] of this.reqs) Object.assign(r, targets.get(id));
    }
  }

  /** Where new requests come from: the left edge, level with the first station. */
  private source() {
    const first = [...this.at.stations.values()][0];
    return { x: 10, y: first ? first.y + first.h / 2 : this.at.height / 2 };
  }

  /** Each live request's target position. */
  private targets(): Map<number, { x: number; y: number }> {
    const out = new Map<number, { x: number; y: number }>();
    const queued = new Map<string, number>();
    const resident = new Map<string, number>();
    // `reqs` keeps insertion order, which is arrival order: the queue's order
    for (const [id, r] of this.reqs) {
      const box = this.at.stations.get(r.stage);
      if (!box) continue;
      if (r.where === "queue") {
        const k = queued.get(r.stage) ?? 0;
        queued.set(r.stage, k + 1);
        out.set(id, queuePos(box, k));
      } else if (r.where === "resident") {
        const k = resident.get(r.stage) ?? 0;
        resident.set(r.stage, k + 1);
        out.set(id, slotPos(box, k));
      } else {
        out.set(id, { x: box.x + box.w + 30, y: box.y + box.h / 2 });
      }
    }
    return out;
  }

  private frame = (now: number) => {
    if (!this.alive) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (this.playing) {
      this.t = Math.min(this.trace.horizon, this.t + dt * this.speed);
      if (this.t >= this.trace.horizon) this.playing = false;
      this.apply(false);
      this.onTick(this.t);
    }
    const targets = this.targets();
    const ease = 1 - Math.exp(-dt * 12);
    for (const [id, r] of this.reqs) {
      const p = targets.get(id);
      if (p) {
        r.x += (p.x - r.x) * ease;
        r.y += (p.y - r.y) * ease;
      }
      if (r.where === "gone") r.alpha -= dt * 3;
    }
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private draw() {
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
    const prefill = css("--prefill");
    const decode = css("--decode");
    const busy = css("--busy");

    // a station running a forward pass: a band across its top, filling as it runs
    for (const [stage, f] of this.forwards) {
      const box = at.stations.get(stage);
      if (!box || this.t > f.t + f.dur) continue;
      const done = Math.min(1, (this.t - f.t) / f.dur);
      ctx.fillStyle = busy;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(box.x + 1, box.y - 4, (box.w - 2) * done, 3);
      ctx.globalAlpha = 1;
    }

    // a veil over the station's glyph, so its residents read over it
    const veil = new Set([...this.reqs.values()].filter((r) => r.where === "resident").map((r) => r.stage));
    ctx.fillStyle = css("--veil");
    for (const stage of veil) {
      const box = at.stations.get(stage);
      if (box) ctx.fillRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    }

    for (const [id, r] of this.reqs) {
      const colour = r.phase === "prefill" ? prefill : decode;
      ctx.globalAlpha = Math.max(0, r.alpha);
      ctx.beginPath();
      ctx.arc(r.x, r.y, R, 0, Math.PI * 2);
      if (r.where === "queue") {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = colour;
        ctx.stroke();
      } else {
        ctx.fillStyle = colour;
        ctx.fill();
        const f = this.forwards.get(r.stage);
        if (r.where === "resident" && f && f.reqs.has(id) && this.t <= f.t + f.dur) {
          ctx.beginPath();
          ctx.arc(r.x, r.y, R + 1.8, 0, Math.PI * 2);
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = busy;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** The k-th place in the queue ahead of a station: a column leftward from its entrance. */
function queuePos(box: Box, k: number) {
  const perRow = 12;
  const col = k % perRow;
  const row = Math.floor(k / perRow);
  return {
    x: box.x - 8 - col * GAP,
    y: box.y + box.h / 2 + (row % 2 ? 1 : -1) * Math.ceil(row / 2) * GAP,
  };
}

/** The k-th slot inside a station: a grid over it, row by row. */
function slotPos(box: Box, k: number) {
  const cols = Math.max(1, Math.floor((box.w - 6) / GAP));
  return {
    x: box.x + 3 + R + 1 + (k % cols) * GAP,
    y: box.y + 3 + R + 1 + Math.floor(k / cols) * GAP,
  };
}
