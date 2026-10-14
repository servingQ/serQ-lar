// The Edit view's arrows, routed by libavoid (Adaptagrams' connector
// router, compiled to wasm by libavoid-js): orthogonal, around every node
// rather than through it, and with arrows that share a stretch nudged apart,
// so that no two lie on one line. The page decides nothing here: which
// arrows there are is serQ's figure (graph.ts), where the nodes stand is
// serQ's layout or the viewer's drag; libavoid only finds a path for each.

import { AvoidLib } from "libavoid-js";
import wasm from "../../node_modules/libavoid-js/dist/libavoid.wasm?url";

export interface Point {
  x: number;
  y: number;
}

/** A node to route around: its box on the canvas. */
export interface Obstacle {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Wire {
  id: string;
  from: string;
  to: string;
}

// The parts of libavoid-js's binding the router uses (its own typings name no module).
interface Avoid {
  Router: new (flags: number) => Router;
  Point: new (x: number, y: number) => Point;
  Rectangle: new (a: Point, b: Point) => object;
  ShapeRef: new (r: Router, poly: object) => object;
  ShapeConnectionPin: new (shape: object, cls: number, x: number, y: number, proportional: boolean, inside: number, dirs: number) => { setExclusive(e: boolean): void };
  ConnEnd: new (shape: object, cls: number) => object;
  ConnRef: new (r: Router, src: object, dst: object) => { displayRoute(): { size(): number; get_ps(i: number): Point } };
  OrthogonalRouting: number;
  ConnDirLeft: number;
  ConnDirRight: number;
  shapeBufferDistance: number;
  idealNudgingDistance: number;
  nudgeOrthogonalSegmentsConnectedToShapes: number;
  nudgeSharedPathsWithCommonEndPoint: number;
  performUnifyingNudgingPreprocessingStep: number;
  destroy(o: object): void;
}
interface Router {
  setRoutingParameter(p: number, v: number): void;
  setRoutingOption(o: number, v: boolean): void;
  processTransaction(): void;
}

let lib: Promise<Avoid> | null = null;
/** libavoid, loaded once (its wasm is fetched the first time the Edit view routes). */
export function avoid(): Promise<Avoid> {
  lib ??= AvoidLib.load(wasm).then(() => AvoidLib.getInstance() as unknown as Avoid);
  return lib;
}

/** The pins every node has: an output on its right, an input on its left. */
const OUT = 1;
const IN = 2;

/** Each wire's route, from its source's right edge to its target's left edge. */
export function route(A: Avoid, nodes: Obstacle[], wires: Wire[]): Map<string, Point[]> {
  const r = new A.Router(A.OrthogonalRouting);
  // a clearance around each node, and the spacing of arrows that would share a line
  r.setRoutingParameter(A.shapeBufferDistance, 14);
  r.setRoutingParameter(A.idealNudgingDistance, 9);
  r.setRoutingOption(A.nudgeOrthogonalSegmentsConnectedToShapes, true);
  r.setRoutingOption(A.nudgeSharedPathsWithCommonEndPoint, true);
  r.setRoutingOption(A.performUnifyingNudgingPreprocessingStep, true);
  // the points, rectangles and ends are copied in: freed once routed
  const spent: object[] = [];
  const keep = <T extends object>(o: T) => (spent.push(o), o);
  const shapes = new Map<string, object>();
  for (const n of nodes) {
    const s = new A.ShapeRef(r, keep(new A.Rectangle(keep(new A.Point(n.x, n.y)), keep(new A.Point(n.x + n.w, n.y + n.h)))));
    // a pin many arrows may share: libavoid's pins are exclusive unless told otherwise
    new A.ShapeConnectionPin(s, OUT, 1, 0.5, true, 0, A.ConnDirRight).setExclusive(false);
    new A.ShapeConnectionPin(s, IN, 0, 0.5, true, 0, A.ConnDirLeft).setExclusive(false);
    shapes.set(n.id, s);
  }
  const conns: [string, InstanceType<Avoid["ConnRef"]>][] = [];
  for (const w of wires) {
    const a = shapes.get(w.from);
    const b = shapes.get(w.to);
    if (a && b && a !== b) conns.push([w.id, new A.ConnRef(r, keep(new A.ConnEnd(a, OUT)), keep(new A.ConnEnd(b, IN)))]);
  }
  r.processTransaction();
  const out = new Map<string, Point[]>();
  for (const [id, c] of conns) {
    const line = c.displayRoute();
    const pts: Point[] = [];
    for (let i = 0; i < line.size(); i++) {
      const p = line.get_ps(i);
      pts.push({ x: p.x, y: p.y });
    }
    out.set(id, pts);
  }
  // the router owns its shapes, pins and connectors, and frees them with it
  A.destroy(r);
  for (const o of spent) A.destroy(o);
  return out;
}

/** An SVG path through `pts`, its corners rounded by up to `radius`. */
export function pathOf(pts: Point[], radius = 6): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const towards = (p: Point, q: Point, k: number) => {
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: p.x + ((q.x - p.x) * k) / l, y: p.y + ((q.y - p.y) * k) / l };
    };
    const s = towards(b, a, r);
    const e = towards(b, c, r);
    d += ` L ${s.x} ${s.y} Q ${b.x} ${b.y} ${e.x} ${e.y}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L ${z.x} ${z.y}`;
}

/** Where a label goes: the middle of the route's longest stretch. */
export function labelAt(pts: Point[]): Point {
  let best = { x: 0, y: 0 };
  let len = -1;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l > len) {
      len = l;
      best = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
    }
  }
  return best;
}
