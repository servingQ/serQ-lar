// The deployment as a graph for the Edit view, read off serQ's figure: its
// nodes are the figure's (`data-node`: stations, decisions), placed where
// serQ placed them; its edges are the figure's arrows (`data-from`,
// `data-to`, `data-role`), a KV copy with the mode serQ wrote on it
// (`data-copy`, `data-poster`); what kind each station is comes from the IR.
// Nothing here decides what the program means: the page draws serQ's graph
// with handles to grab, and every arrow drawn goes back into the text. The
// words on it are serQ's too, as its figure writes them (`wordsOf`).

import { points } from "../anchors";
import { family } from "../events";
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
  /** serQ's words: its name over the glyph (`P[i]`, `choose j, i`), and its
   * note under it (`tokens cap 8192`, a NIC's rate, a delay's `~exp(3)`). */
  title?: string;
  note?: string;
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
  /** Its drum's name in the figure: `P.kv`, or a stacked member's `P.kv[1]`. */
  drum: string;
  /** serQ's words beside its drum (`pool P.kv on P's device`, `cap 160000 ·
   * block 16 · evict lru · preempt lifo`), and whether it draws a prefix cache. */
  words?: string[];
  cache?: boolean;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "arrival" | "flow" | "exit" | "copy";
  copy?: "pull" | "push";
  poster?: string;
  /** A copy serQ brackets (two stations one job holds at once) rather than draws an arrow for. */
  bracket?: true;
  /** serQ's words along the arrow: a branch's condition (`remote_prefill`,
   * `else`), an exit's (`out (K + n >= 16384)`), a copy's way and latency. */
  words?: string[];
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
    // a stacked instance's member (`P[1]`) is drawn apart, of its array's kind
    const array = family(stage);
    const k = kinds.get(array);
    const members = k && k.count > 1 && array === stage ? ` · ×${k.count}` : "";
    const kind: NodeKind = k?.kind === "Step" ? "engine" : array.endsWith(".nic") ? "nic" : k?.kind === "Delay" ? "delay" : "station";
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
      edges.push({ id: `${from}>${to}`, from, to, kind: "copy", copy: r.dataset.copy as "pull" | "push", poster: r.dataset.poster, bracket: true });
  }
  poolsOf(svg, ir.pools ?? [], nodes);
  const instances = instancesOf(svg, nodes);
  wordsOf(svg, nodes, edges);
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
 * the queue's station, on each member's in a stacked instance (`P[1]`'s
 * `P.kv[1]`); one named by no queue, on the station serQ draws its drum
 * nearest, if it draws one. A family's pool is one pool. */
function poolsOf(svg: SVGSVGElement, pools: IrPool[], nodes: GraphNode[]) {
  const stations = nodes.filter((n) => n.kind !== "decision");
  const drums = [...svg.querySelectorAll<SVGGElement>('g[data-pool][data-role="drum"]')];
  const drumOf = (name: string) => drums.find((g) => g.dataset.pool === name);
  const seen = new Set<string>();
  for (const p of pools) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    const drum = drums.find((g) => family(g.dataset.pool!) === p.name);
    const dot = p.name.lastIndexOf(".");
    let owners = dot > 0 ? stations.filter((n) => n.kind !== "draft" && family(n.id) === p.name.slice(0, dot)) : [];
    if (!owners.length && drum) {
      const b = drum.getBBox();
      const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      const near = stations.reduce<GraphNode | undefined>((a, n) => (!a || Math.hypot(n.x - c.x, n.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? n : a), undefined);
      owners = near ? [near] : [];
    }
    const cap = typeof p.cap === "number" ? (p.cap >= 1e4 ? `${Math.round(p.cap / 1000)}k` : String(p.cap)) : p.cap;
    for (const owner of owners) {
      // a member's own drum (`P.kv[1]` for `P[1]`), else the array's
      const member = /\[\d+\]$/.exec(owner.id)?.[0];
      const name = member && drumOf(p.name + member) ? p.name + member : (drum?.dataset.pool ?? p.name);
      (owner.pools ??= []).push({ id: p.name, name: dot > 0 ? p.name.slice(dot + 1) : p.name, kind: p.block !== null ? "blocks" : "slots", cap, drawn: drum !== undefined, drum: name });
    }
  }
}

/** A queue's NIC by the name the figure gives it: `P.nic`, or a stacked
 * member's `P.nic[1]` for `P[1]`. */
export function nicOf(id: string): string {
  const m = /^(.*?)(\[\d+\])?$/.exec(id)!;
  return `${m[1]}.nic${m[2] ?? ""}`;
}

/** The queue a NIC is of, by the figure's names: `P` for `P.nic`, `P[1]` for `P.nic[1]`. */
function queueOfNic(id: string): string | undefined {
  const m = /^(.*)\.nic(\[\d+\])?$/.exec(id);
  return m ? m[1] + (m[2] ?? "") : undefined;
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
    const of = n.kind === "nic" ? queueOfNic(n.id) : undefined;
    const queue = of ? nodes.find((q) => q.id === of) : undefined;
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

/** A text of the figure: where serQ wrote it, and what. */
interface Words {
  x: number;
  y: number;
  text: string;
  el: SVGTextElement;
}

/** serQ's words on the figure, on what they are about: a node's name over it
 * and its note under it, a pool's lines beside its drum (and the prefix cache
 * under them), an arrow's condition, an exit's, a copy's way and latency, the
 * arrival's process.
 * Stopgap: a text of the figure says nothing of what it labels, so each is
 * taken by its place as serQ's writer sets it (deployment.rs): a node's name
 * and note on its centre line, just above and below it; a pool's lines just
 * right of its drum; the rest, the nearest arrow's. docs/upstream.md U19 asks
 * serQ to write `data-for` on each, as it writes `data-pool` on a drum. */
function wordsOf(svg: SVGSVGElement, nodes: GraphNode[], edges: GraphEdge[]) {
  const panels = [...svg.querySelectorAll<SVGRectElement>("rect.instance")].map((r) => r.getBBox());
  let left: Words[] = [...svg.querySelectorAll<SVGTextElement>("text")]
    .filter((t) => !t.closest("g[data-node], g[data-pool]"))
    .map((el) => ({ x: Number(el.getAttribute("x")), y: Number(el.getAttribute("y")), text: el.textContent?.trim() ?? "", el }))
    // an instance's words are its panel's (instancesOf)
    .filter((w) => w.text && !panels.some((b) => Math.abs(w.y - (b.y - 7)) < 1 && w.x >= b.x && w.x < b.x + b.width));
  const take = (pick: (w: Words) => boolean, best: (w: Words) => number): Words | undefined => {
    const w = left.filter(pick).sort((a, b) => best(a) - best(b))[0];
    if (w) left = left.filter((x) => x !== w);
    return w;
  };
  // a node's name over it and its note under it, on its centre line
  for (const g of svg.querySelectorAll<SVGGElement>("g[data-node]")) {
    const n = nodes.find((x) => x.id === g.dataset.node);
    if (!n) continue;
    const b = g.getBBox();
    const cx = b.x + b.width / 2;
    const above = take((w) => Math.abs(w.x - cx) < 1 && w.y < b.y && w.y > b.y - 18, (w) => b.y - w.y);
    const under = take((w) => Math.abs(w.x - cx) < 1 && w.y > b.y + b.height && w.y < b.y + b.height + 24, (w) => w.y);
    if (above) n.title = above.text;
    if (under) n.note = under.text;
  }
  // a pool's lines, just right of its drum; its prefix cache, the band just under them
  const caches = [...svg.querySelectorAll<SVGRectElement>("rect.cached")].map((r) => r.getBBox());
  for (const n of nodes)
    for (const p of n.pools ?? []) {
      const drum = svg.querySelector<SVGGElement>(`g[data-pool="${CSS.escape(p.drum)}"][data-role="drum"]`);
      if (!drum) continue;
      const b = drum.getBBox();
      const lines: Words[] = [];
      for (let w; (w = take((w) => w.x > b.x + b.width && w.x < b.x + b.width + 16 && w.y > b.y && w.y < b.y + b.height + 4, (w) => w.y)); ) lines.push(w);
      p.words = lines.sort((a, q) => a.y - q.y).map((w) => w.text);
      p.cache = caches.some((c) => c.x <= b.x + 1 && Math.abs(c.y - (b.y + b.height)) < 6);
    }
  left = left.filter((w) => w.text !== "prefix cache");
  // the rest: the nearest arrow's, if one is near (the arrival's process, a condition, an exit's, a copy's)
  const arrows = [...svg.querySelectorAll<SVGPathElement>("path[data-role]")].map((el) => {
    const r = el.dataset.role;
    const id = r === "arrival" ? `${SOURCE}>${el.dataset.to}` : r === "exit" ? `${el.dataset.from}>${SINK}` : `${el.dataset.from}>${el.dataset.to}`;
    return { id, pts: points(el) };
  });
  const near = new Map<string, Words[]>();
  for (const w of left) {
    let best: { id: string; d: number } | null = null;
    for (const a of arrows) {
      const d = distance(w, a.pts);
      if (d < 16 && (!best || d < best.d)) best = { id: a.id, d };
    }
    if (best) near.set(best.id, [...(near.get(best.id) ?? []), w]);
  }
  for (const [id, ws] of near) {
    const words = ws.sort((a, b) => a.y - b.y || a.x - b.x).map((w) => w.text);
    if (id.startsWith(`${SOURCE}>`)) {
      const src = nodes.find((n) => n.id === SOURCE);
      if (src) src.sub = words.join(" · ");
      continue;
    }
    const e = edges.find((x) => x.id === id);
    if (e) e.words = words;
  }
}

/** How far the point `p` is from the polyline `pts`. */
function distance(p: { x: number; y: number }, pts: { x: number; y: number }[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const k = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    d = Math.min(d, Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy)));
  }
  return d;
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
