// The part of the figure the viewer sees: a scale and the figure point at the
// view's top left. The SVG shows it as its viewBox, so serQ's figure stays a
// vector at any zoom, and the replay's canvas draws with the same transform.
// Nothing here knows about serQ.

import type { Point } from "./anchors";

const MIN = 0.2;
const MAX = 12;

export class Camera {
  /** CSS pixels per figure unit. */
  s = 1;
  /** The figure point at the view's top left. */
  ox = 0;
  oy = 0;
  /** Whether the view is the whole figure, fitted: a new figure is fitted again. */
  fitted = true;
  /** The figure's size, from its viewBox as serQ wrote it. */
  private W = 1;
  private H = 1;
  onChange: () => void = () => {};

  constructor(private el: HTMLElement) {
    new ResizeObserver(() => {
      if (this.fitted) this.fit();
      else this.apply();
    }).observe(el);
  }

  /** A new figure of `w` × `h`: fitted, unless the viewer had zoomed and it is
   * about the size of the last one, which an edit of the text usually is. */
  figure(w: number, h: number) {
    const same = Math.abs(w - this.W) < 0.25 * this.W && Math.abs(h - this.H) < 0.25 * this.H;
    this.W = w;
    this.H = h;
    // the view takes the figure's shape, up to most of the window's height
    this.el.style.height = `${Math.round(Math.max(300, Math.min(this.el.clientWidth * (h / w), window.innerHeight * 0.72)))}px`;
    if (this.fitted || !same) this.fit();
    else this.apply();
  }

  fit() {
    const { clientWidth: cw, clientHeight: ch } = this.el;
    this.s = Math.min(cw / this.W, ch / this.H) || 1;
    this.ox = -(cw / this.s - this.W) / 2;
    this.oy = -(ch / this.s - this.H) / 2;
    this.fitted = true;
    this.apply();
  }

  /** Zoom by `k` about the view point (`vx`, `vy`), in CSS pixels from its top left. */
  zoomAt(vx: number, vy: number, k: number) {
    const fit = Math.min(this.el.clientWidth / this.W, this.el.clientHeight / this.H);
    const s = Math.min(Math.max(this.s * k, fit * MIN), fit * MAX);
    const fx = this.ox + vx / this.s;
    const fy = this.oy + vy / this.s;
    this.s = s;
    this.ox = fx - vx / s;
    this.oy = fy - vy / s;
    this.fitted = false;
    this.apply();
  }

  /** Zoom by `k` about the view's centre (the buttons). */
  zoom(k: number) {
    this.zoomAt(this.el.clientWidth / 2, this.el.clientHeight / 2, k);
  }

  /** Move the figure by (`dx`, `dy`) CSS pixels. */
  pan(dx: number, dy: number) {
    this.ox -= dx / this.s;
    this.oy -= dy / this.s;
    this.fitted = false;
    this.apply();
  }

  /** The zoom against the fitted view, as the viewer reads it (1 is fitted). */
  get level(): number {
    const fit = Math.min(this.el.clientWidth / this.W, this.el.clientHeight / this.H) || 1;
    return this.s / fit;
  }

  /** The figure point under a client (page) point. */
  toFigure(clientX: number, clientY: number): Point {
    const r = this.el.getBoundingClientRect();
    return { x: this.ox + (clientX - r.left) / this.s, y: this.oy + (clientY - r.top) / this.s };
  }

  /** The canvas transform for a device pixel ratio. */
  transform(dpr: number): [number, number, number, number, number, number] {
    const k = this.s * dpr;
    return [k, 0, 0, k, -this.ox * k, -this.oy * k];
  }

  private apply() {
    const svg = this.el.querySelector("svg");
    if (svg) svg.setAttribute("viewBox", `${this.ox} ${this.oy} ${this.el.clientWidth / this.s} ${this.el.clientHeight / this.s}`);
    this.onChange();
  }
}
