// The Edit view: serQ's deployment as a graph to drag and wire, in React
// Flow. Nodes and edges are serQ's (graph.ts); a node starts where serQ's
// figure placed it and stays where the viewer drags it (kept in this browser
// only: a layout, not part of the program). A connection drawn between two
// handles is handed to the page, which writes it into the text; serQ then
// draws the figure again and this view follows it.

import {
  Background,
  type Connection,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { type Graph, type GraphNode, SINK, SOURCE } from "./graph";

export interface EditHost {
  /** An arrow drawn from node `from` to node `to`. */
  connect(from: string, to: string): void;
  /** A node clicked (its inspector), or the empty canvas (`null`). */
  select(id: string | null): void;
  /** Nodes deleted with the Delete key. */
  remove(ids: string[]): void;
  /** Where this program's layout is kept in the browser. */
  layoutKey(): string;
}

type Data = { node: GraphNode };
type FlowNode = Node<Data, "serq">;

/** A node: serQ's name and kind, an input on its left and an output on its right. */
function SerqNode({ data }: NodeProps<FlowNode>) {
  const n = data.node;
  const nicDraft = n.kind === "draft" && n.draft?.kind === "nic";
  const input = n.kind !== "source" && !nicDraft;
  const output = n.kind !== "sink" && (n.kind !== "draft" || nicDraft);
  return (
    <div className={`fnode k-${n.kind}`} title={n.sub}>
      {input && <Handle type="target" position={Position.Left} />}
      <b>{n.label}</b>
      <small>{n.sub}</small>
      {output && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
const nodeTypes = { serq: SerqNode };

/** The size the stylesheet gives a node, to centre it on serQ's point. */
const W = 132;
const H = 44;

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
      type: "smoothstep",
      animated: copy,
      deletable: false,
      selectable: copy,
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

function Canvas({ host, bind }: { host: EditHost; bind: (show: (g: Graph) => void) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const flow = useReactFlow();
  /** The stations shown so far: a new one fits the view again, so that it is in sight. */
  const seen = useRef(new Set<string>());

  useEffect(() => bind(setGraph), [bind]);

  // a new graph from serQ: a node the viewer dragged stays there, every other goes where serQ's layout puts it now
  useEffect(() => {
    if (!graph) return;
    const layout = load(host.layoutKey());
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: "serq",
        position: layout[n.id] ?? { x: n.x - W / 2, y: n.y - H / 2 },
        data: { node: n },
        deletable: n.kind !== "source" && n.kind !== "sink" && n.kind !== "decision",
      })),
    );
    setEdges(edgesOf(graph));
    const fresh = graph.nodes.some((n) => n.kind !== "draft" && !seen.current.has(n.id));
    seen.current = new Set(graph.nodes.map((n) => n.id));
    if (fresh) requestAnimationFrame(() => flow.fitView({ padding: 0.12, maxZoom: 1.1 }));
  }, [graph, host, setNodes, setEdges, flow]);

  // only what was dragged is kept: the rest follows serQ's layout as the program changes
  const keep = useCallback(
    (_: unknown, _node: FlowNode, dragged: FlowNode[]) => {
      const layout = load(host.layoutKey());
      for (const n of dragged) if (!n.id.startsWith("draft:")) layout[n.id] = n.position;
      save(host.layoutKey(), layout);
    },
    [host],
  );

  const serqLayout = useCallback(() => {
    save(host.layoutKey(), {});
    if (!graph) return;
    setNodes((prev) => prev.map((n) => {
      const g = graph.nodes.find((x) => x.id === n.id);
      return g ? { ...n, position: { x: g.x - W / 2, y: g.y - H / 2 } } : n;
    }));
    requestAnimationFrame(() => flow.fitView({ padding: 0.12, maxZoom: 1.1 }));
  }, [graph, host, setNodes, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={keep}
      onConnect={(c: Connection) => c.source && c.target && host.connect(c.source, c.target)}
      isValidConnection={(c) => c.source !== c.target && c.target !== SOURCE && c.source !== SINK}
      onNodeClick={(_, n) => host.select(n.id)}
      onEdgeClick={(_, e) => {
        const poster = (e.data as { poster?: string } | undefined)?.poster;
        if (poster) host.select(poster);
      }}
      onPaneClick={() => host.select(null)}
      onNodesDelete={(ns) => host.remove(ns.map((n) => n.id))}
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
      <Canvas host={host} bind={bind} />
    </ReactFlowProvider>,
  );
  return {
    show(g: Graph) {
      if (setGraph) setGraph(g);
      else pending = g;
    },
  };
}
