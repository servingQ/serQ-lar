// The replay on the Flow view: serQ's log, placed on React Flow's nodes and
// moving along the edges as drawn. The topology is serQ's (graph.ts read it
// off the figure); only the places are the Flow view's. A station's sessions
// sit in its lane, the strip its card keeps for them, and wait in a line
// left of its card; its engine's forward pass shows on its card's budget
// bar. What the view does not draw comes from serQ's figure: the brackets
// (two stations one job holds at once).
//
// The player sizes its circles and slots in serQ's figure points, where a
// station is 52 to 84 wide (llmd_nixl_pull); a card is 132. So the anchors
// are in flow units over `SCALE`, and the view multiplies them back.

import type { Anchors, Bar, Box, Point } from "../anchors";
import { CLIENT, type Graph } from "./graph";

/** A node as the Flow view has it now, in the flow's coordinates: its card,
 * the lane its sessions sit in, and its budget bar. */
export interface Placed {
  box: Box;
  lane?: Box;
  bar?: HTMLElement;
}

/** Flow units per anchor point. */
const SCALE = 2;

/** The canvas transform for React Flow's viewport, from anchor points. */
export function flowTransform(v: { x: number; y: number; zoom: number }, dpr: number): [number, number, number, number, number, number] {
  const k = v.zoom * SCALE * dpr;
  return [k, 0, 0, k, v.x * dpr, v.y * dpr];
}

/** The anchor point at a point of the flow. */
export const toAnchor = (p: Point): Point => ({ x: p.x / SCALE, y: p.y / SCALE });

const shrink = (b: Box): Box => ({ x: b.x / SCALE, y: b.y / SCALE, w: b.w / SCALE, h: b.h / SCALE });

/** Points along an edge's drawn path, every `step` flow units. */
function sample(path: SVGPathElement, step = 6): Point[] {
  const len = path.getTotalLength();
  const n = Math.max(1, Math.ceil(len / step));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) out.push(toAnchor(path.getPointAtLength((len * i) / n)));
  return out;
}

/** A card's budget bar: the pass's tokens as a share of the most any pass
 * took, and how far the pass has run, as the bar's CSS variables. */
function bar(el: HTMLElement): Bar {
  let was = "";
  return {
    show(pass) {
      const now = pass ? `${pass.share.toFixed(3)} ${pass.done.toFixed(3)}` : "";
      if (now === was) return;
      was = now;
      el.classList.toggle("on", !!pass);
      el.style.setProperty("--share", pass ? String(Math.max(0.02, pass.share)) : "0");
      el.style.setProperty("--done", pass ? String(pass.done) : "0");
      el.title = pass ? `the forward pass running now: ${pass.tokens} tokens` : "no forward pass running";
    },
  };
}

/** The anchors of the Flow view: the `placed` nodes, the edge paths under `el`, the brackets of `figure`. */
export function flowAnchors(el: HTMLElement, graph: Graph, placed: Map<string, Placed>, figure: Anchors): Anchors {
  const paths = new Map<string, SVGPathElement>();
  for (const g of el.querySelectorAll<SVGGElement>(".react-flow__edge[data-id]")) {
    const p = g.querySelector<SVGPathElement>("path.react-flow__edge-path");
    if (p) paths.set(g.dataset.id!, p);
  }
  const nodes = new Map<string, Box>();
  const stations = new Map<string, Box>();
  const budgets = new Map<string, Bar>();
  for (const n of graph.nodes) {
    const at = placed.get(n.id);
    if (!at || n.kind === "draft") continue;
    nodes.set(n.id, shrink(at.box));
    // a station's node is named by its stage, as the figure's `data-node` is
    if (!figure.stations.has(n.id)) continue;
    stations.set(n.id, shrink(at.lane ?? at.box));
    if (at.bar) budgets.set(n.id, bar(at.bar));
  }
  let arrival: Anchors["arrival"] = { pts: [] };
  const exits: Anchors["exits"] = [];
  const flows: Anchors["flows"] = new Map();
  for (const e of graph.edges) {
    const path = paths.get(e.id);
    if (!path || e.bracket) continue;
    const pts = sample(path);
    if (e.from === CLIENT) arrival = { to: e.to, pts };
    else if (e.kind === "reply" || e.kind === "exit") {
      // to the gateway, which sends it on to the client
      if (e.kind === "reply") {
        const out = paths.get(`${e.to}>${CLIENT}`);
        if (out) pts.push(...sample(out));
      }
      // back into the client: a session at a tool, thinking, parks under its card
      const c = nodes.get(CLIENT);
      if (c) pts.push({ x: c.x - 6, y: c.y + c.h + 8 });
      exits.push({ from: e.from, pts });
    } else {
      const list = flows.get(e.from) ?? [];
      list.push({ to: e.to, pts });
      flows.set(e.from, list);
    }
  }
  let right = 0;
  let bottom = 0;
  for (const b of nodes.values()) {
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { width: right, height: bottom, stations, pools: new Map(), arrival, exits, flows, nodes, brackets: figure.brackets, budgets };
}
