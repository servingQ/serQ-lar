// The Edit view: serQ's deployment as a graph to drag and wire, in React
// Flow. Nodes and edges are serQ's (graph.ts); a node starts where serQ's
// figure placed it and stays where the viewer drags it (kept in this browser
// only: a layout, not part of the program). An instance serQ draws as a
// panel (an engine with its NIC) is a group here that holds its members and
// moves with them. The arrows are routed by libavoid (route.ts) around the
// nodes, none on top of another. A connection drawn between two handles is
// handed to the page, which writes it into the text; serQ then draws the
// figure again and this view follows it. The parts in the sidebar are
// dragged and dropped, never clicked: an engine or a pool of engines on the
// canvas is a draft where it lands, on a station called by it; a memory
// pool on an engine is declared there; an arrow or a KV transfer on a
// station starts there, and the station clicked next is its other end.
// The run plays over it (replay.ts): a canvas above the nodes and edges,
// under the panels, which the page's player draws on.

import {
  Background,
  BaseEdge,
  type Connection,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  NodeToolbar,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createContext, type DragEvent, type FormEvent, type MouseEvent, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Draft } from "../edit";
import type { View } from "../player";
import { type Graph, type GraphInstance, type GraphNode, SINK, SOURCE } from "./graph";
import { flowTransform, type Placed, toAnchor } from "./replay";
import { avoid, labelAt, type Point, pathOf, route } from "./route";

export interface EditHost {
  /** An arrow drawn from node `from` to node `to`. */
  connect(from: string, to: string): void;
  /** A node clicked (its inspector), or the empty canvas (`null`). */
  select(id: string | null): void;
  /** Nodes deleted with the Delete key. */
  remove(ids: string[]): void;
  /** Where this program's layout is kept in the browser. */
  layoutKey(): string;
  /** Make a station's engine and NIC an instance. */
  instance(id: string): void;
  /** A NIC for a station's queue (a draft, until its copy is drawn). */
  nic(id: string): void;
  /** Declare a memory pool in a station's queue, with its capacity (slots, or tokens of KV). */
  pool(id: string, name: string, kind: "slots" | "blocks", cap: string): void;
  /** A KV copy from one station's queue to another's, a pull or a push. */
  copy(from: string, to: string, mode: "pull" | "push"): void;
  /** A part from the sidebar made a draft: the draft, and its node's id. */
  add(part: Part): { draft: Draft; id: string };
  /** A line for the viewer: what was done, or why it was not. */
  say(message: string, bad?: boolean): void;
  /** Open the Code tab on where a node is written. */
  code(id: string): void;
  /** A pool chosen: its part of the run's report. */
  report(pool: string): void;
  /** The nodes moved, were measured, or their arrows were drawn again: the replay is placed again. */
  placed(): void;
}

/** What the replay draws over the Flow view with: its canvas, the viewport,
 * each node as it stands, and the anchor point under a point of the screen. */
export interface ReplaySurface {
  canvas: HTMLCanvasElement;
  view: View;
  placed(): Map<string, Placed>;
  toAnchor(clientX: number, clientY: number): Point;
}

/** A node the sidebar makes: an engine, a delay, or a pool of `count` engines. */
export type Part = { kind: "prefill" | "decode" | "delay" } | { kind: "pool"; role: "prefill" | "decode"; count: number };

/** What a part in the sidebar does where it is dropped: a node (`Part`); a
 * memory pool, on an engine; an arrow (a call) or a KV transfer, from a
 * station, to the station clicked next. */
type Tool = { kind: "node"; part: Part } | { kind: "memory"; pool: "blocks" | "slots" } | { kind: "arrow"; arrow: Arrow };
type Arrow = "call" | "pull" | "push";

/** The type a part is dragged as: the canvas takes nothing else. */
const PART = "application/x-serq-part";

/** Whether node `n` takes tool `t` dropped on it. */
function takes(t: Tool, n: GraphNode): boolean {
  if (t.kind === "node") return n.kind !== "sink" && n.kind !== "draft";
  if (t.kind === "memory") return n.kind === "engine";
  if (t.arrow === "call") return n.kind !== "sink" && n.kind !== "draft" && n.kind !== "nic";
  return n.kind === "engine" || n.kind === "nic";
}

/** What an arrow being drawn says it wants next. */
const WANTS: Record<Arrow, (from: string) => string> = {
  call: (f) => `A call from ${f}: click the station or draft it calls`,
  pull: (f) => `KV from ${f}, pulled: click the queue that reads it`,
  push: (f) => `KV from ${f}, pushed: click the queue it goes to`,
};

const Host = createContext<EditHost | null>(null);

type SerqNodeT = Node<{ node: GraphNode; nic?: boolean }, "serq">;
type InstanceNodeT = Node<{ instance: GraphInstance }, "instance">;
type FlowNode = SerqNodeT | InstanceNodeT;

/** A node: serQ's name and kind and its note, an input on its left and an
 * output on its right, and the memory pools it holds. A station has a lane
 * its sessions sit in during the replay, and a count of them the page keeps
 * (`.fcount`); an engine, the bar its forward pass fills. A station chosen
 * has its edits on a toolbar above it. */
function SerqNode({ id, data, parentId, selected }: NodeProps<SerqNodeT>) {
  const n = data.node;
  const host = useContext(Host)!;
  const nicDraft = n.kind === "draft" && n.draft?.kind === "nic";
  const input = n.kind !== "source" && !nicDraft;
  const output = n.kind !== "sink" && (n.kind !== "draft" || nicDraft);
  const station = n.kind === "engine" || n.kind === "nic" || n.kind === "station" || n.kind === "delay";
  return (
    <div className={`fnode k-${n.kind}`} title={[n.title ?? n.label, n.sub, n.note].filter(Boolean).join("\n")}>
      {input && <Handle type="target" position={Position.Left} />}
      <div className="fhead">
        <b>{n.title ?? n.label}</b>
        {station && <span className="fcount" aria-live="off" />}
      </div>
      <small>{n.sub}</small>
      {n.note && <small className="fnote">{n.note}</small>}
      {station && <div className="flane" aria-hidden="true" />}
      {n.kind === "engine" && (
        <div className="fbudget" aria-hidden="true">
          <i />
          <s />
        </div>
      )}
      {n.pools?.length ? (
        <ul className="fpools" aria-label={`${n.label}'s memory pools`}>
          {n.pools.map((p) => (
            <li
              key={p.id}
              className={`fpool k-${p.kind}${p.drawn ? "" : " unused"}`}
              title={
                (p.words?.length ? p.words.join("\n") : `pool ${p.id}: ${p.kind === "blocks" ? "KV blocks" : "request slots"}, cap ${p.cap}`) +
                (p.cache ? "\nprefix cache" : "") +
                (p.drawn ? "\n(click: its part of the report)" : "\nno hold takes it yet, so serQ's figure does not draw it")
              }
              onClick={(e) => {
                e.stopPropagation();
                host.report(p.id);
              }}
            >
              <i aria-hidden="true" />
              <span>{p.name}</span>
              <small>
                {p.cap} {p.kind === "blocks" ? "tok" : "slots"}
                {p.cache ? " · cache" : ""}
              </small>
              {p.words?.[1] && <em>{p.words[1].replace(/^cap \S+( · )?/, "")}</em>}
            </li>
          ))}
        </ul>
      ) : null}
      {output && <Handle type="source" position={Position.Right} />}
      {n.kind === "engine" || n.kind === "nic" ? (
        <Tools id={id} engine={n.kind === "engine"} inInstance={!!parentId} hasNic={!!data.nic} hasKv={!!n.pools?.some((p) => p.kind === "blocks")} open={!!selected} />
      ) : (
        (n.kind === "station" || n.kind === "delay") && (
          <NodeToolbar isVisible={!!selected} position={Position.Top} className="ftools">
            <CodeButton id={id} />
          </NodeToolbar>
        )
      )}
    </div>
  );
}

/** Open the Code tab on where the node is written. */
function CodeButton({ id }: { id: string }) {
  const host = useContext(Host)!;
  return (
    <button onClick={() => host.code(id)} title={`Show where ${id} is written, in the Code tab`}>
      {"</>"} Code
    </button>
  );
}

/** The edits of a chosen station: bundle it with its NIC as an instance,
 * give it a NIC, declare a memory pool (KV blocks only where the device has
 * none: serQ takes one KV pool a device). */
function Tools(props: { id: string; engine: boolean; inInstance: boolean; hasNic: boolean; hasKv: boolean; open: boolean }) {
  const { id, engine, inInstance, hasNic, hasKv, open } = props;
  const host = useContext(Host)!;
  const [form, setForm] = useState(false);
  const [kind, setKind] = useState<"slots" | "blocks">(hasKv ? "slots" : "blocks");
  const [name, setName] = useState(hasKv ? "waitq" : "kv");
  const [cap, setCap] = useState(hasKv ? "16" : "160000");
  useEffect(() => setForm(false), [open]);
  const station = id.replace(/\.nic$/, "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[A-Za-z_]\w*$/.test(name)) return;
    host.pool(station, name, kind, cap.trim() || "16");
    setForm(false);
  };
  return (
    <NodeToolbar isVisible={open} position={Position.Top} className="ftools">
      {!inInstance && (
        <button onClick={() => host.instance(station)} title={`Bundle ${station} and ${station}.nic as an instance: ${station} becomes a family its calls choose a member of`}>
          ⊞ Make instance
        </button>
      )}
      {engine && !hasNic && (
        <button onClick={() => host.nic(id)} title="A NIC for a KV copy out of this queue">
          + NIC
        </button>
      )}
      {form ? (
        <form onSubmit={submit} className="fpool-form">
          <select
            value={kind}
            aria-label="Pool kind"
            onChange={(e) => {
              const k = e.target.value === "slots" ? "slots" : "blocks";
              setKind(k);
              setName(k === "slots" ? "waitq" : "kv");
              setCap(k === "slots" ? "16" : "160000");
            }}
          >
            {!hasKv && <option value="blocks">KV blocks</option>}
            <option value="slots">request slots</option>
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} size={6} aria-label="Pool name" pattern="[A-Za-z_][A-Za-z0-9_]*" required autoFocus />
          <label>
            cap <input value={cap} onChange={(e) => setCap(e.target.value)} size={6} aria-label={kind === "slots" ? "Capacity in requests" : "Capacity in tokens of KV"} required />
          </label>
          <button>Declare</button>
        </form>
      ) : (
        <button onClick={() => setForm(true)} title={`Declare a memory pool in ${station}: KV blocks on its device, or request slots on its engine`}>
          + Memory pool
        </button>
      )}
      {!form && <CodeButton id={id} />}
    </NodeToolbar>
  );
}

/** The sidebar of parts, by what they are: each dragged and dropped onto
 * the canvas (it does nothing clicked). A pool of engines' size is set here. */
function Parts() {
  const [count, setCount] = useState(2);
  const n = Math.min(64, Math.max(1, Math.round(count) || 1));
  type Item = { key: string; label: string; hint: string; title: string; tool: Tool; note?: string };
  const groups: { title: string; items: Item[]; extra?: ReactNode }[] = [
    {
      title: "Engines",
      items: [
        { key: "prefill", label: "Prefill", hint: "canvas or a station", title: "A prefill engine: a queue with its device, engine and pools", tool: { kind: "node", part: { kind: "prefill" } } },
        { key: "decode", label: "Decode", hint: "canvas or a station", title: "A decode engine: a queue with its device, engine and pools", tool: { kind: "node", part: { kind: "decode" } } },
        { key: "delay", label: "Delay", hint: "canvas or a station", title: "A delay stage: a wait outside the engines", tool: { kind: "node", part: { kind: "delay" } } },
      ],
    },
    {
      title: "Pools",
      items: [
        { key: "prefill", label: "Prefill pool", note: `×${n}`, hint: "canvas or a station", title: `A pool of ${n} prefill engines, a call choosing one (llm-d's InferencePool)`, tool: { kind: "node", part: { kind: "pool", role: "prefill", count: n } } },
        { key: "decode", label: "Decode pool", note: `×${n}`, hint: "canvas or a station", title: `A pool of ${n} decode engines, a call choosing one (llm-d's InferencePool)`, tool: { kind: "node", part: { kind: "pool", role: "decode", count: n } } },
        { key: "blocks", label: "KV blocks", hint: "on an engine", title: "A memory pool of KV blocks on an engine's device (one a device)", tool: { kind: "memory", pool: "blocks" } },
        { key: "slots", label: "Request slots", hint: "on an engine", title: "A memory pool of request slots on an engine", tool: { kind: "memory", pool: "slots" } },
      ],
      extra: (
        <label className="fparts-n">
          engines in a pool <input type="number" min={1} max={64} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Engines in a pool" />
        </label>
      ),
    },
    {
      title: "Arrows",
      items: [{ key: "call", label: "Call", hint: "on a station, then click", title: "An arrow: the station dropped on calls the one clicked next", tool: { kind: "arrow", arrow: "call" } }],
    },
    {
      title: "KV transfer",
      items: [
        { key: "pull", label: "KV pull", hint: "on the source, then click", title: "A KV copy over NIXL the reader pulls: drop on the source queue, click the reader", tool: { kind: "arrow", arrow: "pull" } },
        { key: "push", label: "KV push", hint: "on the source, then click", title: "A KV copy over NIXL the source pushes: drop on the source queue, click the reader", tool: { kind: "arrow", arrow: "push" } },
      ],
    },
  ];
  return (
    <aside className="fparts" aria-label="Parts: drag one onto the canvas">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="eyebrow">{g.title}</h3>
          {g.items.map((p) => (
            <div
              key={p.label}
              className={`fpart k-${p.key}`}
              draggable
              title={`${p.title}. Drag it ${p.hint === "canvas or a station" ? "onto the canvas, or onto a station to call it from there" : p.hint === "on an engine" ? "onto an engine" : "onto a station, then click the other end"}.`}
              onDragStart={(e) => {
                e.dataTransfer.setData(PART, JSON.stringify(p.tool));
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              <i aria-hidden="true" />
              <span>
                {p.label}
                {p.note && <small className="fpart-note">{p.note}</small>}
              </span>
              <small>{p.hint}</small>
            </div>
          ))}
          {g.extra}
        </section>
      ))}
    </aside>
  );
}

/** An instance: serQ's panel around an engine and its NIC, with serQ's words over it. */
function InstanceNode({ data }: NodeProps<InstanceNodeT>) {
  const i = data.instance;
  return (
    <div className="finstance" title={`${i.title}: ${i.members.join(", ")}`}>
      <span>
        {i.title} {i.note && <small>{i.note}</small>}
      </span>
    </div>
  );
}
const nodeTypes = { serq: SerqNode, instance: InstanceNode };

/** An arrow along libavoid's route; until libavoid has loaded, React Flow's
 * own step path. serQ's words on it stand over its middle, a line each. */
function RoutedEdge(p: EdgeProps<Edge<{ route?: Point[]; poster?: string; words?: string[] }>>) {
  const r = p.data?.route;
  let path: string;
  let at: Point;
  if (r && r.length > 1) {
    path = pathOf(r);
    at = labelAt(r);
  } else {
    const [d, x, y] = getSmoothStepPath(p);
    path = d;
    at = { x, y };
  }
  const words = p.data?.words;
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} style={p.style} interactionWidth={p.interactionWidth} />
      {words?.length ? (
        <EdgeLabelRenderer>
          <div className="flabel" style={{ transform: `translate(-50%, -100%) translate(${at.x}px, ${at.y - 3}px)` }}>
            {words.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
const edgeTypes = { routed: RoutedEdge };

/** The size the stylesheet gives a node, to centre it on serQ's point. */
const W = 132;
const H = 44;
/** An instance's margin around its members, the band its words take above
 * them, and its foot: deeper than the routes' clearance (route.ts), so an
 * arrow under the members runs inside the panel, clear of its edge. */
const PAD = 14;
const HEAD = 20;
const FOOT = 30;

type Layout = Record<string, { x: number; y: number }>;
function load(key: string): Layout {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Layout;
  } catch {
    return {};
  }
}
/** Where a part was dropped, by the name its draft declares: the draft
 * stands there, and so does the station it becomes, once an arrow places
 * it (then kept with the layout). */
const dropped = new Map<string, { x: number; y: number }>();
const draftName = (d: Draft) => (d.kind === "nic" ? `${d.queue}.nic` : d.name);

function save(key: string, layout: Layout) {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // a private window: the layout lasts as long as the page
  }
}

function edgesOf(g: Graph): Edge[] {
  return g.edges.map((e) => {
    const copy = e.kind === "copy";
    const colour = copy ? (e.copy === "pull" ? "var(--decode)" : "var(--prefill)") : e.kind === "flow" ? "var(--ink)" : "var(--dim)";
    const poster = e.poster?.replace(/\.nic$/, "");
    return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: "routed",
      animated: copy,
      deletable: false,
      selectable: copy,
      // over the instances' panels, which an arrow may cross
      zIndex: 1,
      className: copy ? `copy ${e.copy}` : e.kind,

      ariaLabel: copy ? `KV copy ${e.from} to ${e.to}, a ${e.copy}: ${poster} ${e.copy === "pull" ? "starts each read" : "posts each write"}` : undefined,
      interactionWidth: copy ? 24 : 12,
      style: { stroke: colour, strokeWidth: copy ? 2 : 1.4, strokeDasharray: copy ? "6 4" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
      // serQ's words on the arrow: a condition, an exit's, a copy's way and latency
      data: { poster: e.poster, words: e.words?.length ? e.words : copy && e.copy ? [e.copy] : undefined },
    };
  });
}

const sizeOf = (n: FlowNode) => ({ w: n.measured?.width ?? W, h: n.measured?.height ?? H });

/** Each instance fitted around its members as they stand (`abs`, on the
 * canvas), and each member placed in its instance. Instances come first:
 * React Flow wants a parent before its children. */
function fit(nodes: FlowNode[], abs: (n: SerqNodeT) => { x: number; y: number }): FlowNode[] {
  const groups = nodes.filter((n): n is InstanceNodeT => n.type === "instance");
  const at = new Map<string, { x: number; y: number }>();
  const out: FlowNode[] = [];
  for (const g of groups) {
    const members = nodes.filter((n): n is SerqNodeT => n.type === "serq" && g.data.instance.members.includes(n.id));
    const boxes = members.map((m) => ({ ...abs(m), ...sizeOf(m) }));
    const x = Math.min(...boxes.map((b) => b.x)) - PAD;
    const y = Math.min(...boxes.map((b) => b.y)) - PAD - HEAD;
    const width = Math.max(...boxes.map((b) => b.x + b.w)) + PAD - x;
    const height = Math.max(...boxes.map((b) => b.y + b.h)) + FOOT - y;
    at.set(g.id, { x, y });
    out.push({ ...g, position: { x, y }, width, height, style: { width, height } });
  }
  for (const n of nodes) {
    if (n.type !== "serq") continue;
    const g = groups.find((g) => g.data.instance.members.includes(n.id));
    const p = abs(n);
    const o = g ? at.get(g.id)! : null;
    out.push({ ...n, parentId: g?.id, expandParent: !!g, position: o ? { x: p.x - o.x, y: p.y - o.y } : p });
  }
  return out;
}

/** Where a node stands on the canvas: its position, or its instance's plus its own. */
function absolute(nodes: FlowNode[], n: FlowNode) {
  const g = n.parentId ? nodes.find((p) => p.id === n.parentId) : undefined;
  return g ? { x: g.position.x + n.position.x, y: g.position.y + n.position.y } : n.position;
}

/** The whole graph in view, with room on the right for the sessions parked past the out node. */
const fitOptions = () => ({ padding: { top: 0.12, bottom: 0.12, left: 0.12, right: "110px" as const }, maxZoom: 1.1 });

function Canvas({ host, bind }: { host: EditHost; bind: (show: (g: Graph) => void, surface: ReplaySurface) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [routes, setRoutes] = useState<Map<string, Point[]>>(new Map());
  const [A, setA] = useState<Awaited<ReturnType<typeof avoid>> | null>(null);
  const flow = useReactFlow();
  /** The stations shown so far: a new one fits the view again, so that it is in sight. */
  const seen = useRef(new Set<string>());

  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(
    () =>
      bind(setGraph, {
        canvas: canvas.current!,
        view: { transform: (dpr) => flowTransform(flow.getViewport(), dpr) },
        placed() {
          const now = flow.getNodes() as FlowNode[];
          const { zoom } = flow.getViewport();
          const out = new Map<string, Placed>();
          for (const n of now) {
            if (n.type !== "serq") continue;
            const p = absolute(now, n);
            const box = { x: p.x, y: p.y, ...sizeOf(n) };
            const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(n.id)}"]`);
            const lane = el?.querySelector<HTMLElement>(".flane");
            let laneBox;
            if (el && lane) {
              const r = el.getBoundingClientRect();
              const l = lane.getBoundingClientRect();
              laneBox = { x: p.x + (l.left - r.left) / zoom, y: p.y + (l.top - r.top) / zoom, w: l.width / zoom, h: l.height / zoom };
            }
            out.set(n.id, { box: { x: box.x, y: box.y, w: box.w, h: box.h }, lane: laneBox, bar: el?.querySelector<HTMLElement>(".fbudget") ?? undefined });
          }
          return out;
        },
        toAnchor: (x, y) => toAnchor(flow.screenToFlowPosition({ x, y })),
      }),
    [bind, flow],
  );
  useEffect(() => {
    avoid().then(setA, (e) => console.error("libavoid did not load; the arrows keep React Flow's paths", e));
  }, []);

  /** serQ's graph placed: a node where the viewer dragged it (`layout`, on
   * the canvas) or dropped its part, else where serQ's layout has it. */
  const place = useCallback(
    (g: Graph, layout: Layout): FlowNode[] => {
      let kept = false;
      const at = (n: GraphNode) => {
        if (n.draft) return dropped.get(draftName(n.draft));
        if (layout[n.id]) return layout[n.id];
        // a station a dropped part became; a pool's members stacked under the first
        const [, name, k] = /^(.*?)(?:\[(\d+)\])?$/.exec(n.id)!;
        const d = dropped.get(name);
        if (!d) return undefined;
        kept = true;
        return (layout[n.id] = { x: d.x, y: d.y + Number(k ?? 0) * (H + 24) });
      };
      const serq: SerqNodeT[] = g.nodes.map((n) => ({
        id: n.id,
        type: "serq",
        position: at(n) ?? { x: n.x - W / 2, y: n.y - H / 2 },
        data: { node: n, nic: g.nodes.some((x) => x.id === `${n.id}.nic`) },
        deletable: n.kind !== "source" && n.kind !== "sink" && n.kind !== "decision",
      }));
      const groups: InstanceNodeT[] = g.instances.map((i) => ({
        id: i.id,
        type: "instance",
        position: { x: 0, y: 0 },
        data: { instance: i },
        deletable: false,
        selectable: false,
        zIndex: 0,
      }));
      if (kept) save(host.layoutKey(), layout);
      return fit([...groups, ...serq], (n) => n.position);
    },
    [host],
  );

  // a new graph from serQ: a node the viewer dragged stays there, every other goes where serQ's layout puts it now
  useEffect(() => {
    if (!graph) return;
    setNodes(place(graph, load(host.layoutKey())));
    setEdges(edgesOf(graph));
    const fresh = graph.nodes.some((n) => n.kind !== "draft" && !seen.current.has(n.id));
    seen.current = new Set(graph.nodes.map((n) => n.id));
    if (fresh) requestAnimationFrame(() => flow.fitView(fitOptions()));
  }, [graph, host, place, setNodes, setEdges, flow]);

  // the routes follow the nodes: after a new graph, a drag, a node's size measured
  useEffect(() => {
    if (!A) return;
    const id = requestAnimationFrame(() => {
      const boxes = nodes.flatMap((n) => {
        const p = absolute(nodes, n);
        // an instance's words are kept clear; its members are reached through its sides and its foot
        return [n.type === "serq" ? { id: n.id, x: p.x, y: p.y, ...sizeOf(n) } : { id: n.id, x: p.x, y: p.y, w: n.width ?? 0, h: HEAD }];
      });
      setRoutes(route(A, boxes, edges.map((e) => ({ id: e.id, from: e.source, to: e.target }))));
    });
    return () => cancelAnimationFrame(id);
  }, [A, nodes, edges]);

  const routed = useMemo(() => edges.map((e) => ({ ...e, data: { ...e.data, route: routes.get(e.id) } })), [edges, routes]);

  // a node dragged or measured, an arrow routed again: the replay follows, once React Flow has drawn them
  useEffect(() => {
    const id = requestAnimationFrame(() => host.placed());
    return () => cancelAnimationFrame(id);
  }, [nodes, routed, host]);

  // only what was dragged is kept, on the canvas: the rest follows serQ's layout as the program changes
  const keep = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const layout = load(host.layoutKey());
      const now = flow.getNodes() as FlowNode[];
      for (const d of dragged) {
        if (d.type === "serq" && d.data.node.draft) {
          dropped.set(draftName(d.data.node.draft), d.position);
          continue;
        }
        // an instance moves its members
        const moved = d.type === "instance" ? now.filter((n) => n.parentId === d.id) : [now.find((n) => n.id === d.id) ?? d];
        for (const n of moved) layout[n.id] = absolute(now, n);
      }
      save(host.layoutKey(), layout);
      // and is fitted again around them, should a member have moved out to its edge or back in
      setNodes(fit(now, (n) => absolute(now, n)));
    },
    [host, flow, setNodes],
  );

  /** A node part dropped (`at`, on the screen): a draft there; on a
   * station `on`, called from it at once, where serQ's layout puts it. */
  const make = useCallback(
    (part: Part, at: { x: number; y: number }, on: SerqNodeT | undefined) => {
      const { draft, id } = host.add(part);
      if (on) return host.connect(on.id, id);
      const p = flow.screenToFlowPosition(at);
      dropped.set(draftName(draft), { x: p.x - W / 2, y: p.y - H / 2 });
    },
    [host, flow],
  );

  /** A memory pool dropped on engine `on`: declared in its queue, by a name it has not got. */
  const memory = useCallback(
    (pool: "blocks" | "slots", on: SerqNodeT) => {
      const n = on.data.node;
      if (pool === "blocks" && n.pools?.some((q) => q.kind === "blocks")) return host.say(`${n.label}'s device has its KV pool: serQ takes one a device.`, true);
      const stem = pool === "blocks" ? "kv" : "waitq";
      const taken = new Set((n.pools ?? []).map((q) => q.name));
      let name = stem;
      for (let i = 2; taken.has(name); i++) name = `${stem}${i}`;
      host.pool(on.id.replace(/\.nic$/, ""), name, pool, pool === "blocks" ? "160000" : "16");
    },
    [host],
  );

  /** An arrow being drawn: from where its part was dropped, to the next station clicked; and where the pointer is. */
  const [wire, setWire] = useState<{ arrow: Arrow; from: string } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wire) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setWire(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [wire]);
  /** The arrow drawn to node `to`: written into the text. */
  const finish = (to: string) => {
    if (!wire) return;
    setWire(null);
    if (wire.arrow === "call") host.connect(wire.from, to);
    else host.copy(wire.from, to, wire.arrow);
  };

  /** The tool being dragged, and the node under it that takes it. */
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef<Tool | null>(null);
  const under = (e: DragEvent | MouseEvent, t: Tool | null) => {
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    return (flow.getIntersectingNodes({ x: p.x, y: p.y, width: 1, height: 1 }) as FlowNode[]).find(
      (n): n is SerqNodeT => n.type === "serq" && (t ? takes(t, n.data.node) : true),
    );
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(PART)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const id = under(e, dragged.current)?.id ?? null;
    if (id !== over) setOver(id);
  };
  const onDrop = (e: DragEvent) => {
    setOver(null);
    const raw = e.dataTransfer.getData(PART);
    if (!raw) return;
    e.preventDefault();
    const t = JSON.parse(raw) as Tool;
    const on = under(e, t);
    if (t.kind === "node") return make(t.part, { x: e.clientX, y: e.clientY }, on);
    if (!on) return host.say(t.kind === "memory" ? "A memory pool goes on an engine: drop it on one." : t.arrow === "call" ? "An arrow starts at a station: drop it on one." : "A KV transfer starts at the queue whose KV it copies: drop it on an engine.", true);
    if (t.kind === "memory") return memory(t.pool, on);
    setPointer({ x: e.clientX, y: e.clientY });
    setWire({ arrow: t.arrow, from: on.id });
  };
  // the parts' drag starts outside the canvas: what it carries is read when it starts
  useEffect(() => {
    const start = (e: globalThis.DragEvent) => {
      const raw = (e.target as Element | null)?.closest?.(".fpart") ? e.dataTransfer?.getData(PART) : "";
      dragged.current = raw ? (JSON.parse(raw) as Tool) : null;
    };
    const end = () => {
      dragged.current = null;
      setOver(null);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
    };
  }, []);
  const shown = useMemo(
    () => nodes.map((n) => (n.id === over || n.id === wire?.from ? { ...n, className: "drop-on" } : n.className ? { ...n, className: undefined } : n)),
    [nodes, over, wire],
  );

  /** Where the arrow being drawn starts, on the pane: the right of its node. */
  const start = (() => {
    if (!wire || !pane.current) return null;
    const n = nodes.find((x) => x.id === wire.from);
    if (!n) return null;
    const a = absolute(nodes, n);
    const s = flow.flowToScreenPosition({ x: a.x + sizeOf(n).w, y: a.y + sizeOf(n).h / 2 });
    const r = pane.current.getBoundingClientRect();
    return { x: s.x - r.left, y: s.y - r.top, r };
  })();

  const serqLayout = useCallback(() => {
    save(host.layoutKey(), {});
    dropped.clear();
    if (!graph) return;
    setNodes(place(graph, {}));
    requestAnimationFrame(() => flow.fitView(fitOptions()));
  }, [graph, host, place, setNodes, flow]);

  return (
    <div className="fedit">
      <Parts />
      <div
        ref={pane}
        className={`fcanvas${wire ? " wiring" : ""}`}
        onMouseMove={(e) => {
          if (wire) setPointer({ x: e.clientX, y: e.clientY });
        }}
      >
        <ReactFlow
          nodes={shown}
          edges={routed}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={keep}
          onConnect={(c: Connection) => c.source && c.target && host.connect(c.source, c.target)}
          isValidConnection={(c) => c.source !== c.target && c.target !== SOURCE && c.source !== SINK}
          onNodeClick={(_, n) => {
            const id = n.type === "instance" ? (n.data.instance.members.find((m) => !m.endsWith(".nic")) ?? null) : n.id;
            if (wire) return id && finish(id);
            host.select(id);
          }}
          onEdgeClick={(_, e) => {
            const poster = (e.data as { poster?: string } | undefined)?.poster;
            if (poster) host.select(poster);
          }}
          onPaneClick={() => (wire ? setWire(null) : host.select(null))}
          onNodesDelete={(ns) => host.remove(ns.filter((n) => n.type === "serq").map((n) => n.id))}
          deleteKeyCode={["Delete", "Backspace"]}
          onDragOver={onDragOver}
          onDragLeave={() => setOver(null)}
          onDrop={onDrop}
          colorMode="system"
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={32} size={1} />
          <canvas ref={canvas} className="flow-replay" aria-hidden="true" />
          <Controls />
          <MiniMap pannable zoomable />
          <Panel position="top-right">
            <button className="flow-btn" onClick={serqLayout} title="Put every node back where serQ's figure has it">
              serQ's layout
            </button>
          </Panel>
          {wire && (
            <Panel position="top-center" className="fwire-say">
              {WANTS[wire.arrow](wire.from)} · <kbd>Esc</kbd> cancels
            </Panel>
          )}
        </ReactFlow>
        {start && pointer && (
          <svg className={`fwire k-${wire!.arrow}`} aria-hidden="true">
            <line x1={start.x} y1={start.y} x2={pointer.x - start.r.left} y2={pointer.y - start.r.top} />
          </svg>
        )}
      </div>
    </div>
  );
}

/** Mount the Edit view in `el`. `show` gives it serQ's graph, now and after
 * every redraw; `surface` is what the replay draws over it with, once mounted. */
export function mountEditView(el: HTMLElement, host: EditHost): { show(g: Graph): void; surface: Promise<ReplaySurface> } {
  let setGraph: ((g: Graph) => void) | null = null;
  let pending: Graph | null = null;
  let ready!: (s: ReplaySurface) => void;
  const surface = new Promise<ReplaySurface>((r) => (ready = r));
  const bind = (f: (g: Graph) => void, s: ReplaySurface) => {
    setGraph = f;
    ready(s);
    if (pending) f(pending);
  };
  createRoot(el).render(
    <ReactFlowProvider>
      <Host.Provider value={host}>
        <Canvas host={host} bind={bind} />
      </Host.Provider>
    </ReactFlowProvider>,
  );
  return {
    surface,
    show(g: Graph) {
      if (setGraph) setGraph(g);
      else pending = g;
    },
  };
}
