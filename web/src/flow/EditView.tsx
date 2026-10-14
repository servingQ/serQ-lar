// The Edit view: serQ's deployment as a graph to drag and wire, in React
// Flow. Nodes and edges are serQ's (graph.ts); a node starts where serQ's
// figure placed it and stays where the viewer drags it (kept in this browser
// only: a layout, not part of the program). An instance serQ draws as a
// panel (an engine with its NIC) is a group here that holds its members and
// moves with them. The arrows are routed by libavoid (route.ts) around the
// nodes, none on top of another. A connection drawn between two handles is
// handed to the page, which writes it into the text; serQ then draws the
// figure again and this view follows it.

import {
  Background,
  BaseEdge,
  type Connection,
  Controls,
  type Edge,
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
import { createContext, type FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Graph, type GraphInstance, type GraphNode, SINK, SOURCE } from "./graph";
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
}

const Host = createContext<EditHost | null>(null);

type SerqNodeT = Node<{ node: GraphNode; nic?: boolean }, "serq">;
type InstanceNodeT = Node<{ instance: GraphInstance }, "instance">;
type FlowNode = SerqNodeT | InstanceNodeT;

/** A node: serQ's name and kind, an input on its left and an output on its
 * right, and the memory pools it holds. A station chosen has its edits on a
 * toolbar above it. */
function SerqNode({ id, data, parentId, selected }: NodeProps<SerqNodeT>) {
  const n = data.node;
  const nicDraft = n.kind === "draft" && n.draft?.kind === "nic";
  const input = n.kind !== "source" && !nicDraft;
  const output = n.kind !== "sink" && (n.kind !== "draft" || nicDraft);
  return (
    <div className={`fnode k-${n.kind}`} title={n.sub}>
      {input && <Handle type="target" position={Position.Left} />}
      <b>{n.label}</b>
      <small>{n.sub}</small>
      {n.pools?.length ? (
        <ul className="fpools" aria-label={`${n.label}'s memory pools`}>
          {n.pools.map((p) => (
            <li
              key={p.id}
              className={`fpool k-${p.kind}${p.drawn ? "" : " unused"}`}
              title={`pool ${p.id}: ${p.kind === "blocks" ? "KV blocks" : "request slots"}, cap ${p.cap}${p.drawn ? "" : "; no hold takes it yet, so serQ's figure does not draw it"}`}
            >
              <i aria-hidden="true" />
              <span>{p.name}</span>
              <small>
                {p.cap} {p.kind === "blocks" ? "tok" : "slots"}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
      {output && <Handle type="source" position={Position.Right} />}
      {(n.kind === "engine" || n.kind === "nic") && (
        <Tools id={id} engine={n.kind === "engine"} inInstance={!!parentId} hasNic={!!data.nic} hasKv={!!n.pools?.some((p) => p.kind === "blocks")} open={!!selected} />
      )}
    </div>
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
    </NodeToolbar>
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

/** An arrow along libavoid's route; until libavoid has loaded, React Flow's own step path. */
function RoutedEdge(p: EdgeProps<Edge<{ route?: Point[]; poster?: string }>>) {
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
  return (
    <BaseEdge
      id={p.id}
      path={path}
      markerEnd={p.markerEnd}
      style={p.style}
      label={p.label}
      labelX={at.x}
      labelY={at.y}
      labelBgPadding={[3, 1]}
      interactionWidth={p.interactionWidth}
    />
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
      label: copy ? e.copy : undefined,
      ariaLabel: copy ? `KV copy ${e.from} to ${e.to}, a ${e.copy}: ${poster} ${e.copy === "pull" ? "starts each read" : "posts each write"}` : undefined,
      interactionWidth: copy ? 24 : 12,
      style: { stroke: colour, strokeWidth: copy ? 2 : 1.4, strokeDasharray: copy ? "6 4" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
      data: { poster: e.poster },
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

function Canvas({ host, bind }: { host: EditHost; bind: (show: (g: Graph) => void) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [routes, setRoutes] = useState<Map<string, Point[]>>(new Map());
  const [A, setA] = useState<Awaited<ReturnType<typeof avoid>> | null>(null);
  const flow = useReactFlow();
  /** The stations shown so far: a new one fits the view again, so that it is in sight. */
  const seen = useRef(new Set<string>());

  useEffect(() => bind(setGraph), [bind]);
  useEffect(() => {
    avoid().then(setA, (e) => console.error("libavoid did not load; the arrows keep React Flow's paths", e));
  }, []);

  /** serQ's graph placed: a node where the viewer dragged it (`layout`, on the canvas), else where serQ's layout has it. */
  const place = useCallback((g: Graph, layout: Layout): FlowNode[] => {
    const serq: SerqNodeT[] = g.nodes.map((n) => ({
      id: n.id,
      type: "serq",
      position: layout[n.id] ?? { x: n.x - W / 2, y: n.y - H / 2 },
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
    return fit([...groups, ...serq], (n) => n.position);
  }, []);

  // a new graph from serQ: a node the viewer dragged stays there, every other goes where serQ's layout puts it now
  useEffect(() => {
    if (!graph) return;
    setNodes(place(graph, load(host.layoutKey())));
    setEdges(edgesOf(graph));
    const fresh = graph.nodes.some((n) => n.kind !== "draft" && !seen.current.has(n.id));
    seen.current = new Set(graph.nodes.map((n) => n.id));
    if (fresh) requestAnimationFrame(() => flow.fitView({ padding: 0.12, maxZoom: 1.1 }));
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

  // only what was dragged is kept, on the canvas: the rest follows serQ's layout as the program changes
  const keep = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const layout = load(host.layoutKey());
      const now = flow.getNodes() as FlowNode[];
      for (const d of dragged) {
        if (d.id.startsWith("draft:")) continue;
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

  const serqLayout = useCallback(() => {
    save(host.layoutKey(), {});
    if (!graph) return;
    setNodes(place(graph, {}));
    requestAnimationFrame(() => flow.fitView({ padding: 0.12, maxZoom: 1.1 }));
  }, [graph, host, place, setNodes, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={routed}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={keep}
      onConnect={(c: Connection) => c.source && c.target && host.connect(c.source, c.target)}
      isValidConnection={(c) => c.source !== c.target && c.target !== SOURCE && c.source !== SINK}
      onNodeClick={(_, n) => host.select(n.type === "instance" ? (n.data.instance.members.find((m) => !m.endsWith(".nic")) ?? null) : n.id)}
      onEdgeClick={(_, e) => {
        const poster = (e.data as { poster?: string } | undefined)?.poster;
        if (poster) host.select(poster);
      }}
      onPaneClick={() => host.select(null)}
      onNodesDelete={(ns) => host.remove(ns.filter((n) => n.type === "serq").map((n) => n.id))}
      deleteKeyCode={["Delete", "Backspace"]}
      colorMode="system"
      minZoom={0.1}
      maxZoom={4}
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={16} />
      <Controls />
      <MiniMap pannable zoomable />
      <Panel position="top-right">
        <button className="flow-btn" onClick={serqLayout} title="Put every node back where serQ's figure has it">
          serQ's layout
        </button>
      </Panel>
    </ReactFlow>
  );
}

/** Mount the Edit view in `el`. `show` gives it serQ's graph, now and after every redraw. */
export function mountEditView(el: HTMLElement, host: EditHost): { show(g: Graph): void } {
  let setGraph: ((g: Graph) => void) | null = null;
  let pending: Graph | null = null;
  const bind = (f: (g: Graph) => void) => {
    setGraph = f;
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
    show(g: Graph) {
      if (setGraph) setGraph(g);
      else pending = g;
    },
  };
}
