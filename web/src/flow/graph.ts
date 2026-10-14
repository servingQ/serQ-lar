// The deployment as a graph for the Edit view, read off serQ's figure: its
// nodes are the figure's (`data-node`: stations, decisions), placed where
// serQ placed them; its edges are the figure's arrows (`data-from`,
// `data-to`, `data-role`), a KV copy with the mode serQ wrote on it
// (`data-copy`, `data-poster`); what kind each station is comes from the IR.
// Nothing here decides what the program means: the page draws serQ's graph
// with handles to grab, and every arrow drawn goes back into the text.

import { points } from "../anchors";
import type { Draft } from "../edit";

export type NodeKind = "source" | "sink" | "engine" | "nic" | "station" | "delay" | "decision" | "draft";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** What it is, in serQ's words: `engine`, `nic · ps`, `fifo`, `×2` members. */
  sub: string;
  /** Where serQ's figure has its centre. */
  x: number;
  y: number;
  draft?: Draft;
  /** The memory pools it holds (an engine's request slots and KV blocks). */
  pools?: GraphPool[];
}

/** A memory pool, as serQ's IR declares it. */
export interface GraphPool {
  /** serQ's name (`P.kv`), and the name within its queue (`kv`). */
  id: string;
  name: string;
  /** KV blocks (the pool has a block size), or request slots. */
  kind: "blocks" | "slots";
  cap: string;
  /** Whether serQ's figure draws it: a pool no hold takes is declared, not drawn. */
  drawn: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "arrival" | "flow" | "exit" | "copy";
  copy?: "pull" | "push";
  poster?: string;
}

/** An instance: the panel serQ draws around the engine, NIC and pools one
 * `choose` variable indexes (`prefill instance P[i]`). */
export interface GraphInstance {
  id: string;
  /** serQ's words over the panel: `prefill instance P[i]`, `choose i of 2`. */
  title: string;
  note: string;
  /** The nodes in it, by the names the arrows use. */
  members: string[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  instances: GraphInstance[];
}

interface IrStage {
  name: string;
  kind: Record<string, unknown> | string;
}

interface IrPool {
  name: string;
  cap: number | string;
  block: number | null;
}

/** Where sessions arrive from, and where they leave to: no stage of serQ's,
 * the ends of the figure's arrival and exit arrows. */
export const SOURCE = "arrival";
export const SINK = "exit";

/** The graph of the figure in `svg` (on the page, so that it has a layout), with `drafts` beside it. */
export function graphOf(svg: SVGSVGElement, ir: { stages: IrStage[]; pools?: IrPool[] }, drafts: Draft[]): Graph {
  const kinds = new Map<string, { kind: string; count: number }>();
  for (const s of ir.stages) {
    const k = typeof s.kind === "string" ? s.kind : Object.keys(s.kind)[0];
    const was = kinds.get(s.name);
    kinds.set(s.name, { kind: k, count: (was?.count ?? 0) + 1 });
  }
  const nodes: GraphNode[] = [];
  let right = 0;
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-node]")) {
    const id = g.dataset.node!;
    const b = g.getBBox();
    right = Math.max(right, b.x + b.width);
    const stage = g.dataset.stage;
    if (stage === undefined) {
      nodes.push({ id, kind: "decision", label: label(g) ?? "decide", sub: "", x: b.x + b.width / 2, y: b.y + b.height / 2 });
      continue;
    }
    const k = kinds.get(stage);
    const members = k && k.count > 1 ? ` · ×${k.count}` : "";
    const kind: NodeKind = k?.kind === "Step" ? "engine" : stage.endsWith(".nic") ? "nic" : k?.kind === "Delay" ? "delay" : "station";
    const what = k?.kind === "Step" ? "engine" : (k?.kind ?? "").toLowerCase();
    nodes.push({ id, kind, label: stage, sub: (kind === "nic" ? `nic · ${what}` : what) + members, x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  const edges: GraphEdge[] = [];
  const arrival = svg.querySelector<SVGPathElement>('path[data-role="arrival"]');
  if (arrival?.dataset.to) {
    const p = points(arrival)[0] ?? { x: 0, y: 0 };
    nodes.push({ id: SOURCE, kind: "source", label: "arrival", sub: "sessions arrive", x: p.x, y: p.y });
    edges.push({ id: `${SOURCE}>${arrival.dataset.to}`, from: SOURCE, to: arrival.dataset.to, kind: "arrival" });
  }
  const exits = [...svg.querySelectorAll<SVGPathElement>('path[data-role="exit"]')];
  if (exits.length) {
    const ends = exits.map((e) => points(e).at(-1)!).filter(Boolean);
    const y = ends.reduce((s, p) => s + p.y, 0) / Math.max(1, ends.length);
    nodes.push({ id: SINK, kind: "sink", label: "out", sub: "sessions leave", x: Math.max(right, ...ends.map((p) => p.x)) + 40, y });
    for (const e of exits) if (e.dataset.from) edges.push({ id: `${e.dataset.from}>${SINK}`, from: e.dataset.from, to: SINK, kind: "exit" });
  }
  for (const p of svg.querySelectorAll<SVGPathElement>('path[data-role="flow"]')) {
    const from = p.dataset.from!;
    const to = p.dataset.to!;
    const copy = p.dataset.copy as "pull" | "push" | undefined;
    edges.push({ id: `${from}>${to}`, from, to, kind: copy ? "copy" : "flow", copy, poster: p.dataset.poster });
  }
  // a copy serQ brackets rather than draws an arrow for (NICs in no instance)
  for (const r of svg.querySelectorAll<SVGRectElement>('rect[data-role="bracket"][data-copy]')) {
    const [from, to] = (r.dataset.nodes ?? "").split(" ");
    if (from && to && !edges.some((e) => e.from === from && e.to === to))
      edges.push({ id: `${from}>${to}`, from, to, kind: "copy", copy: r.dataset.copy as "pull" | "push", poster: r.dataset.poster });
  }
  poolsOf(svg, ir.pools ?? [], nodes);
  const instances = instancesOf(svg, nodes);
  compact(nodes, edges);
  // drafts wait in a row under the figure until an arrow reaches them
  const below = Math.max(0, ...nodes.map((n) => n.y)) + ROW * 1.5;
  drafts.forEach((d, i) => {
    const name = d.kind === "nic" ? `${d.queue}.nic` : d.kind === "queue" && d.family ? `${d.name}[${d.family}]` : d.name;
    const sub = d.kind === "queue" ? (d.family ? `draft · pool of ${d.family} · ${d.role}` : `draft · ${d.role}`) : d.kind === "stage" ? "draft · delay" : "draft · NIC: connect it to the reader";
    nodes.push({ id: draftId(i), kind: "draft", label: name, sub, x: i * COL, y: below, draft: d });
  });
  return { nodes, edges, instances };
}

/** Each pool of the IR on the node that holds it: a queue's (`P.kv`) on
 * the queue's station; one named by no queue, on the station serQ draws its
 * drum nearest, if it draws one. A family's pool is one pool. */
function poolsOf(svg: SVGSVGElement, pools: IrPool[], nodes: GraphNode[]) {
  const stations = nodes.filter((n) => n.kind !== "decision");
  const seen = new Set<string>();
  for (const p of pools) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    const drum = svg.querySelector<SVGGElement>(`g[data-pool="${CSS.escape(p.name)}"][data-role="drum"]`);
    const dot = p.name.lastIndexOf(".");
    let owner = dot > 0 ? stations.find((n) => n.id === p.name.slice(0, dot)) : undefined;
    if (!owner && drum) {
      const b = drum.getBBox();
      const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      owner = stations.reduce<GraphNode | undefined>((a, n) => (!a || Math.hypot(n.x - c.x, n.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? n : a), undefined);
    }
    if (!owner) continue;
    const cap = typeof p.cap === "number" ? (p.cap >= 1e4 ? `${Math.round(p.cap / 1000)}k` : String(p.cap)) : p.cap;
    (owner.pools ??= []).push({ id: p.name, name: dot > 0 ? p.name.slice(dot + 1) : p.name, kind: p.block !== null ? "blocks" : "slots", cap, drawn: drum !== null });
  }
}

/** The panels serQ draws for its instances (`rect.instance`), with the nodes
 * that stand in each and the words serQ wrote over it (at the panel's top
 * left, 7 above its edge).
 * Stopgap: the panel names no nodes, so a node is a member when its centre
 * is inside the panel; a queue's NIC (`P.nic`), indexed with its queue, is a
 * member of its queue's panel wherever serQ draws it (a push's bracket of
 * both NICs stands inside the decoder's panel). docs/upstream.md U15 asks
 * serQ for `data-nodes` on the panel, as a bracket has. */
function instancesOf(svg: SVGSVGElement, nodes: GraphNode[]): GraphInstance[] {
  const texts = [...svg.querySelectorAll<SVGTextElement>("text")].filter((t) => !t.closest("g[data-node], g[data-pool]"));
  const panels = [...svg.querySelectorAll<SVGRectElement>("rect.instance")].map((r) => r.getBBox());
  const inside = (b: DOMRect, n: GraphNode) => n.x > b.x && n.x < b.x + b.width && n.y > b.y && n.y < b.y + b.height;
  const panelOf = (n: GraphNode): DOMRect | undefined => {
    const queue = n.kind === "nic" ? nodes.find((q) => q.id === n.id.slice(0, -4)) : undefined;
    return queue ? panels.find((b) => inside(b, queue)) ?? panels.find((b) => inside(b, n)) : panels.find((b) => inside(b, n));
  };
  const out: GraphInstance[] = [];
  for (const b of panels) {
    const members = nodes.filter((n) => n.kind !== "decision" && panelOf(n) === b);
    if (!members.length) continue;
    const words = texts
      .filter((t) => Math.abs(Number(t.getAttribute("y")) - (b.y - 7)) < 1 && Number(t.getAttribute("x")) >= b.x && Number(t.getAttribute("x")) < b.x + b.width)
      .sort((p, q) => Number(p.getAttribute("x")) - Number(q.getAttribute("x")))
      .map((t) => t.textContent?.trim() ?? "");
    const engine = members.find((n) => n.kind === "engine") ?? members[0];
    out.push({ id: `instance:${engine.id}`, title: words[0] || `instance ${engine.label}`, note: words.slice(1).join(" "), members: members.map((n) => n.id) });
  }
  return out;
}

/** The spacing of the Edit view's columns and rows. */
const COL = 210;
const ROW = 90;

/** serQ's arrangement, tightened: its columns and rows kept in order, a
 * node's width apart. serQ spaces its figure for pools and panels the Edit
 * view does not draw. The arrival goes left of what it reaches, the exit
 * right of everything, each on the row of what it joins. */
function compact(nodes: GraphNode[], edges: GraphEdge[]) {
  const placed = nodes.filter((n) => n.kind !== "source" && n.kind !== "sink");
  const index = (vals: number[], snap: number) => {
    const keys = [...new Set(vals.map((v) => Math.round(v / snap)))].sort((a, b) => a - b);
    return (v: number) => keys.indexOf(Math.round(v / snap));
  };
  const col = index(placed.map((n) => n.x), 40);
  const row = index(placed.map((n) => n.y), 30);
  // two nodes in one cell (serQ drew them apart by less than the snap): the later goes a row down
  const taken = new Set<string>();
  const at = new Map<string, { x: number; y: number }>();
  for (const n of [...placed].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const c = col(n.x);
    let r = row(n.y);
    while (taken.has(`${c},${r}`)) r++;
    taken.add(`${c},${r}`);
    at.set(n.id, { x: c * COL, y: r * ROW });
  }
  for (const n of placed) Object.assign(n, at.get(n.id));
  const lastCol = Math.max(0, ...placed.map((n) => n.x));
  for (const n of nodes) {
    if (n.kind === "source") {
      const to = at.get(edges.find((e) => e.from === n.id)?.to ?? "");
      n.x = -COL;
      n.y = to?.y ?? 0;
    } else if (n.kind === "sink") {
      const ys = edges.filter((e) => e.to === n.id).map((e) => at.get(e.from)?.y ?? 0).sort((a, b) => a - b);
      n.x = lastCol + COL;
      n.y = ys.length ? ys[Math.floor(ys.length / 2)] : 0;
    }
  }
}

/** A draft's node, by its place in the palette's list. */
export const draftId = (i: number) => `draft:${i}`;

/** The decision's own words (`choose j, i`), if serQ wrote any beside it. */
function label(g: SVGGElement): string | null {
  const t = g.querySelector("text")?.textContent?.trim();
  return t || null;
}
