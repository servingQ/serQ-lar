// A panel of the metrics board: one time axis over the run, a few lines
// (one value per window), the raw samples behind them as faint dots, a
// crosshair that reads every line at the pointer, a playhead at the
// replay's clock, and the same numbers as a table. Canvas, no library.

export type Unit = "s" | "count" | "ratio" | "per_s" | "tok_per_s" | "value";

export interface Line {
  name: string;
  /** A CSS custom property (`--c1`) or a colour. */
  color: string;
  /** One value per window; `null` leaves a gap. */
  y: (number | null)[];
}

export interface Dots {
  name: string;
  color: string;
  t: number[];
  v: number[];
}

export interface PanelOpts {
  title: string;
  unit: Unit;
  /** Under the title: where the numbers come from. */
  note?: string;
}

const M = { l: 50, r: 10, t: 16, b: 20 };

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function colour(c: string): string {
  return c.startsWith("--") ? css(c) : c;
}

/** The scale a unit is read at, chosen once per panel from its largest value. */
interface Scale {
  k: number;
  suffix: string;
}

function scaleFor(unit: Unit, max: number): Scale {
  switch (unit) {
    case "s":
      if (max < 0.001) return { k: 1e6, suffix: " µs" };
      if (max < 1) return { k: 1e3, suffix: " ms" };
      return { k: 1, suffix: " s" };
    case "ratio":
      return { k: 100, suffix: " %" };
    case "per_s":
      return { k: 1, suffix: "/s" };
    case "tok_per_s":
      return max >= 10_000 ? { k: 1e-3, suffix: "K tok/s" } : { k: 1, suffix: " tok/s" };
    default:
      return max >= 10_000 ? { k: 1e-3, suffix: "K" } : { k: 1, suffix: "" };
  }
}

function digits(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a < 0.001) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}

/** A value in the panel's unit, for the tooltip and the table. */
export function fmt(v: number | null, unit: Unit, scale?: Scale): string {
  if (v === null || !Number.isFinite(v)) return "–";
  const s = scale ?? scaleFor(unit, Math.abs(v));
  return digits(v * s.k) + s.suffix;
}

/** The whole run's number, shown alone: the scale is its own. */
export function fmtOne(v: number | null, unit: Unit): string {
  return fmt(v, unit);
}

function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export class Panel {
  el: HTMLElement;
  onSeek: (t: number) => void = () => {};
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tip: HTMLDivElement;
  private legend: HTMLUListElement;
  private table: HTMLTableElement;
  private H = 1;
  private x: number[] = [];
  private lines: Line[] = [];
  private dots: Dots[] = [];
  private yMax = 1;
  private scale: Scale = { k: 1, suffix: "" };
  private hover: number | null = null;
  private at = 0;
  private ro: ResizeObserver;

  constructor(private opts: PanelOpts) {
    this.el = document.createElement("div");
    this.el.className = "panel";
    const head = document.createElement("div");
    head.className = "panel-head";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = opts.title;
    head.append(title);
    if (opts.note) {
      const note = document.createElement("span");
      note.className = "panel-note";
      note.textContent = opts.note;
      head.append(note);
    }
    const toggle = document.createElement("button");
    toggle.className = "panel-toggle";
    toggle.type = "button";
    toggle.textContent = "table";
    toggle.setAttribute("aria-pressed", "false");
    head.append(toggle);
    this.legend = document.createElement("ul");
    this.legend.className = "panel-legend";
    const plot = document.createElement("div");
    plot.className = "panel-plot";
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", opts.title);
    this.tip = document.createElement("div");
    this.tip.className = "panel-tip";
    this.tip.hidden = true;
    plot.append(this.canvas, this.tip);
    this.table = document.createElement("table");
    this.table.className = "panel-table";
    this.table.hidden = true;
    this.el.append(head, this.legend, plot, this.table);
    this.ctx = this.canvas.getContext("2d")!;

    toggle.onclick = () => {
      const on = this.table.hidden;
      this.table.hidden = !on;
      plot.hidden = on;
      toggle.setAttribute("aria-pressed", String(on));
    };
    this.canvas.addEventListener("pointermove", (e) => this.point(e.offsetX));
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.tip.hidden = true;
      this.draw();
    });
    this.canvas.addEventListener("click", (e) => {
      const t = this.timeAt(e.offsetX);
      if (t !== null) this.onSeek(t);
    });
    this.canvas.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const n = this.x.length;
      if (!n) return;
      const i = this.hover === null ? (e.key === "ArrowLeft" ? n - 1 : 0) : Math.min(n - 1, Math.max(0, this.hover + (e.key === "ArrowLeft" ? -1 : 1)));
      this.hover = i;
      this.showTip();
      this.draw();
    });
    this.canvas.addEventListener("blur", () => {
      this.hover = null;
      this.tip.hidden = true;
      this.draw();
    });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(plot);
  }

  /** The data: windows' centres `x` over `[0, H]`, the lines, the samples behind them. */
  set(H: number, x: number[], lines: Line[], dots: Dots[] = [], yMax?: number) {
    this.H = H;
    this.x = x;
    this.lines = lines;
    this.dots = dots;
    let max = yMax ?? 0;
    if (yMax === undefined) {
      for (const l of lines) for (const v of l.y) if (v !== null && v > max) max = v;
      for (const d of dots) for (const v of d.v) if (Number.isFinite(v) && v > max) max = v;
    }
    this.yMax = yMax ?? niceMax(max);
    this.scale = scaleFor(this.opts.unit, this.yMax);
    this.legend.replaceChildren();
    this.legend.hidden = lines.length + dots.length < 2;
    for (const l of [...lines, ...dots]) {
      const li = document.createElement("li");
      const key = document.createElement("i");
      key.className = "y" in l ? "key-line" : "key-dot";
      key.style.background = colour(l.color);
      li.append(key, document.createTextNode(l.name));
      this.legend.append(li);
    }
    this.fillTable();
    this.draw();
  }

  /** The replay's clock: a playhead. */
  cursor(t: number) {
    this.at = t;
    this.draw();
  }

  destroy() {
    this.ro.disconnect();
    this.el.remove();
  }

  private fillTable() {
    this.table.replaceChildren();
    const thead = this.table.createTHead();
    const hr = thead.insertRow();
    const th0 = document.createElement("th");
    th0.textContent = "t";
    hr.append(th0);
    for (const l of this.lines) {
      const th = document.createElement("th");
      th.textContent = l.name;
      hr.append(th);
    }
    const body = this.table.createTBody();
    this.x.forEach((t, i) => {
      const r = body.insertRow();
      r.insertCell().textContent = `${t.toFixed(2)} s`;
      for (const l of this.lines) r.insertCell().textContent = fmt(l.y[i], this.opts.unit, this.scale);
    });
  }

  private timeAt(px: number): number | null {
    const w = this.canvas.clientWidth - M.l - M.r;
    if (w <= 0) return null;
    const t = ((px - M.l) / w) * this.H;
    return Math.min(this.H, Math.max(0, t));
  }

  private point(px: number) {
    const t = this.timeAt(px);
    if (t === null || !this.x.length) return;
    let best = 0;
    for (let i = 1; i < this.x.length; i++) if (Math.abs(this.x[i] - t) < Math.abs(this.x[best] - t)) best = i;
    if (best !== this.hover) {
      this.hover = best;
      this.showTip();
      this.draw();
    }
  }

  private showTip() {
    const i = this.hover;
    if (i === null) return;
    this.tip.replaceChildren();
    const when = document.createElement("div");
    when.className = "tip-when";
    when.textContent = `t ≈ ${this.x[i].toFixed(2)} s`;
    this.tip.append(when);
    for (const l of this.lines) {
      const row = document.createElement("div");
      row.className = "tip-row";
      const key = document.createElement("i");
      key.style.background = colour(l.color);
      const v = document.createElement("b");
      v.textContent = fmt(l.y[i], this.opts.unit, this.scale);
      row.append(key, v, document.createTextNode(l.name));
      this.tip.append(row);
    }
    this.tip.hidden = false;
    const w = this.canvas.clientWidth;
    const px = M.l + (this.x[i] / this.H) * (w - M.l - M.r);
    const flip = px + 12 + this.tip.offsetWidth > w;
    this.tip.style.left = `${flip ? px - 12 - this.tip.offsetWidth : px + 12}px`;
    this.tip.style.top = `${M.t}px`;
  }

  private draw() {
    const c = this.canvas;
    const W = c.clientWidth;
    const Hh = c.clientHeight;
    if (W === 0 || Hh === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(Hh * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(Hh * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    const pw = W - M.l - M.r;
    const ph = Hh - M.t - M.b;
    const X = (t: number) => M.l + (t / this.H) * pw;
    const Y = (v: number) => M.t + ph - (Math.min(v, this.yMax) / this.yMax) * ph;
    const grid = css("--line");
    const dim = css("--dim");
    const ink = css("--ink");

    // the grid: four hairlines and their labels
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    ctx.fillStyle = dim;
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let k = 0; k <= 4; k++) {
      const v = (this.yMax * k) / 4;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(M.l, y);
      ctx.lineTo(W - M.r, y);
      ctx.stroke();
      ctx.fillText(k === 0 ? "0" : digits(v * this.scale.k), M.l - 6, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = this.H <= 10 ? 5 : 6;
    for (let k = 0; k <= ticks; k++) {
      const t = (this.H * k) / ticks;
      ctx.fillText(k === ticks ? `${digits(t)} s` : digits(t), X(t), M.t + ph + 5);
    }
    // the unit, above the plot's right edge
    ctx.textAlign = "right";
    ctx.fillText(this.scale.suffix.trim(), W - M.r, 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(M.l, M.t - 1, pw, ph + 2);
    ctx.clip();

    // the samples, behind
    for (const d of this.dots) {
      ctx.fillStyle = colour(d.color);
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < d.t.length; i++) {
        if (!Number.isFinite(d.v[i])) continue;
        ctx.beginPath();
        ctx.arc(X(d.t[i]), Y(d.v[i]), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // the lines
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const l of this.lines) {
      ctx.strokeStyle = colour(l.color);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < this.x.length; i++) {
        const v = l.y[i];
        if (v === null || !Number.isFinite(v)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(X(this.x[i]), Y(v));
        else ctx.moveTo(X(this.x[i]), Y(v));
        pen = true;
      }
      ctx.stroke();
      // a lone window has no line: a marker
      for (let i = 0; i < this.x.length; i++) {
        const v = l.y[i];
        const alone = v !== null && (i === 0 || l.y[i - 1] === null) && (i === this.x.length - 1 || l.y[i + 1] === null);
        if (alone && v !== null) {
          ctx.fillStyle = colour(l.color);
          ctx.beginPath();
          ctx.arc(X(this.x[i]), Y(v), 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // the crosshair
    if (this.hover !== null && this.x.length) {
      const x = Math.round(X(this.x[this.hover])) + 0.5;
      ctx.strokeStyle = dim;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, M.t);
      ctx.lineTo(x, M.t + ph);
      ctx.stroke();
      for (const l of this.lines) {
        const v = l.y[this.hover];
        if (v === null) continue;
        ctx.fillStyle = colour(l.color);
        ctx.strokeStyle = css("--panel");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, Y(v), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
    // the playhead
    if (this.at > 0 && this.at <= this.H) {
      const x = Math.round(X(this.at)) + 0.5;
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, M.t - 4);
      ctx.lineTo(x, M.t + ph);
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(x - 4, M.t - 6);
      ctx.lineTo(x + 4, M.t - 6);
      ctx.lineTo(x, M.t - 1);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}
