// Where things are in the deployment view's SVG, by what the program calls
// them: serQ names each station's stage (`<g data-stage="P">`), each queue
// glyph's and drum's pool (`data-pool`), the arrival and exit arrows
// (`data-role`). An array's members share one station, except in a stacked
// instance, which serQ draws once per member (`P[1]`). The figure is laid
// out off the page: the replay plays on the Flow view's places
// (flow/replay.ts), and takes from here only what that view does not draw.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PoolAnchor {
  /** The queue glyph where holds of the pool wait, if the figure draws one. */
  queue?: Box;
  /** The pool's drum. */
  drum: Box;
}

export interface Anchors {
  width: number;
  height: number;
  stations: Map<string, Box>;
  pools: Map<string, PoolAnchor>;
  /** The arrival arrow: where sessions come from, and the node it reaches. */
  arrival: { to?: string; pts: Point[] };
  /** The exit arrows: where sessions go, each from the node it leaves. */
  exits: { from?: string; pts: Point[] }[];
  /** The arrows between nodes, by the node they leave: the next station, a
   * loop's return, a transfer between two NICs. A decision or a tick is a
   * node without a stage, named `#k` by serQ. */
  flows: Map<string, { to: string; pts: Point[] }[]>;
  /** Every node's box, by the name the arrows use (stations and decisions alike). */
  nodes: Map<string, Box>;
  /** The stations one job holds at once (a transfer's two NICs): bracketed,
   * with no arrow between them, so a walk treats them as one place. */
  brackets: string[][];
  /** Each engine's budget bar, by its stage: shows the forward pass running
   * now (its tokens, as a share of the most any pass of it took, and how far
   * it has run), or none. */
  budgets: Map<string, Bar>;
}

export interface Bar {
  show(pass: { tokens: number; share: number; done: number } | null): void;
}

function box(el: SVGGraphicsElement): Box {
  const b = el.getBBox();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

/** The points of a path written as `M x y L x y …` (what serQ's writer emits). */
export function points(path: SVGPathElement): Point[] {
  const d = path.getAttribute("d") ?? "";
  const out: Point[] = [];
  for (const m of d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}

export function anchors(svg: SVGSVGElement): Anchors {
  const vb = svg.viewBox.baseVal;
  const stations = new Map<string, Box>();
  const nodes = new Map<string, Box>();
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-node]")) nodes.set(g.dataset.node!, box(g));
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-stage]")) stations.set(g.dataset.stage!, box(g));
  const pools = new Map<string, PoolAnchor>();
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-pool]")) {
    const pool = g.dataset.pool!;
    const b = box(g);
    const a = pools.get(pool) ?? { drum: b };
    if (g.dataset.role === "queue") a.queue = b;
    else a.drum = b;
    pools.set(pool, a);
  }
  const arrivalPath = svg.querySelector<SVGPathElement>('path[data-role="arrival"]');
  const arrival = arrivalPath ? { to: arrivalPath.dataset.to, pts: points(arrivalPath) } : { pts: [] };
  const exits = [...svg.querySelectorAll<SVGPathElement>('path[data-role="exit"]')].map((p) => ({
    from: p.dataset.from,
    pts: points(p),
  }));
  const flows = new Map<string, { to: string; pts: Point[] }[]>();
  for (const p of svg.querySelectorAll<SVGPathElement>('path[data-role="flow"]')) {
    const from = p.dataset.from!;
    const list = flows.get(from) ?? [];
    list.push({ to: p.dataset.to!, pts: points(p) });
    flows.set(from, list);
  }
  const brackets = [...svg.querySelectorAll<SVGRectElement>('rect[data-role="bracket"]')].map((r) => (r.dataset.nodes ?? "").split(" ").filter(Boolean));
  return { width: vb.width, height: vb.height, stations, pools, arrival, exits, flows, nodes, brackets, budgets: new Map() };
}
