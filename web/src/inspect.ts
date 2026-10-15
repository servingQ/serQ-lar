// What the Flow view's inspector shows for a router or the client, and the
// edits it makes: each property is a piece of the text serQ's outline places
// (a `choose`'s keys, the workload's arrival), shown as it is written and
// written back as the viewer types it. What it means is serQ's to say when it
// compiles the result; the keys offered are calls of serQ's functions.

import type { Edit } from "./edit";
import type { Outline, Range, WorkloadItem } from "./outline";

/** A property as the text writes it. */
export interface Prop {
  label: string;
  value: string;
  /** Write a new value in its place: absent where serQ's outline does not place it. */
  set?: (text: string) => void;
  remove?: () => void;
  /** Ready-made values to pick from. */
  presets?: Preset[];
  hint?: string;
}

export interface Section {
  title: string;
  props: Prop[];
  note?: string;
  /** What a router's choice picks a member of, and the families it could pick from. */
  target?: { value: string; options: string[]; set: (family: string) => void };
  /** A new key, from the presets or typed. */
  add?: { presets: Preset[]; put: (text: string) => void };
}

export interface Inspect {
  kind: "router" | "client";
  title: string;
  sub: string;
  sections: Section[];
}

const text = (src: string, r: Range) => src.slice(r[0], r[1]);

/** The router: each `choose` of the server and its gateways, what it picks a
 * member of and by what keys; and the calls the server makes. `fns` are
 * serQ's functions, which the keys offered call. */
export function routerOf(ol: Outline, src: string, fns: SerqFunction[], apply: (edits: Edit[]) => void): Inspect {
  const sections: Section[] = [];
  const families = ol.queues.filter((q) => q.family !== null).map((q) => q.name);
  for (const c of ol.chooses ?? []) {
    if (c.block === "entry") continue;
    const calls = ol.calls.filter((k) => k.index === c.var && k.block === c.block && k.owner === c.owner);
    const of = calls[0]?.queue ?? "";
    const keys = c.keys.map((r) => text(src, r));
    const presets = presetsOf(ol, of, c.var, fns);
    const by = (list: string[]) => apply([{ at: c.by, text: `(${list.join(", ")})` }]);
    sections.push({
      title: `choose ${c.var}${c.owner ? ` · ${c.owner}` : ""}`,
      note: `among ${text(src, c.count)}; the member that sorts first by the keys, in turn`,
      target: of
        ? {
            value: of,
            options: families,
            set: (to) => {
              const Q = ol.queues.find((q) => q.name === to);
              if (!Q || to === of) return;
              const edits: Edit[] = [{ at: c.count, text: Q.family! }];
              for (const k of calls) if (src.startsWith(of, k.range[0])) edits.push({ at: [k.range[0], k.range[0] + of.length], text: to });
              const was = new RegExp(`\\b${of}\\[`, "g");
              c.keys.forEach((r, i) => edits.push({ at: r, text: keys[i].replace(was, `${to}[`) }));
              apply(edits);
            },
          }
        : undefined,
      props: keys.map((k, i) => ({
        label: `key ${i + 1}`,
        value: k,
        set: (t) => apply([{ at: c.keys[i], text: t }]),
        remove: keys.length > 1 ? () => by(keys.filter((_, j) => j !== i)) : undefined,
        presets,
      })),
      add: { presets, put: (t) => by([...keys, t]) },
    });
  }
  const calls = ol.calls.filter((k) => k.block !== "entry");
  sections.push({
    title: "Calls",
    props: calls.map((k) => ({ label: k.block === "route" ? `route ${k.owner ?? ""}`.trim() : "server", value: text(src, k.range) })),
    note: ol.chooses ? undefined : "This serQ does not place a choose in its outline: the keys are edited in Code until it does (docs/upstream.md U21).",
  });
  const gateways = ol.routes.map((r) => r.gateway);
  return { kind: "router", title: gateways.length ? `router · ${gateways.join(", ")}` : "router", sub: "the server's choice of where each request goes", sections };
}

/** Keys a router's choice can be made by, over family `of`'s member `v`:
 * each of serQ's functions (`fns`) whose one parameter is a stage, called on
 * the member, or a pool, called on each of the member's pools. Which they
 * are, and what each returns, is serQ's to say; the member that sorts first
 * is the one with the least. */
function presetsOf(ol: Outline, of: string, v: string, fns: SerqFunction[]): Preset[] {
  if (!of) return [];
  const m = `${of}[${v}]`;
  const pools = ol.queues.find((q) => q.name === of)?.members.filter((x) => x.kind === "pool" && x.name) ?? [];
  const out: Preset[] = [];
  for (const f of fns) {
    if (f.params.length !== 1) continue;
    const kind = f.params[0].kind;
    if (kind === "stage") out.push({ label: `${f.name}(${m})`, value: `${f.name}(${m})`, title: f.summary });
    else if (kind === "pool") for (const p of pools) out.push({ label: `${f.name}(${m}.${p.name})`, value: `${f.name}(${m}.${p.name})`, title: f.summary });
  }
  return out;
}

/** A function of serQ's, as `serq::frontend::highlight::functions` says it. */
export interface SerqFunction {
  name: string;
  params: { name: string; kind: "expr" | "stage" | "pool" | "observe" | string }[];
  group: string;
  summary: string;
}

/** A ready-made value, and what serQ says it is. */
export interface Preset {
  label: string;
  value: string;
  title?: string;
}

/** The client: the workload's arrival, what each turn draws, its tool
 * calls; `arrival` is serQ's words on the arrival arrow, for a serQ whose
 * outline does not place them. */
export function clientOf(ol: Outline, src: string, arrival: string, apply: (edits: Edit[]) => void, signature = ol.signature): Inspect {
  const items = ol.workload_items;
  const sig = signature;
  const sends = sig?.params.length ? `sends ${sig.params.map((p) => (p.hidden ? `hidden ${p.name}` : p.name)).join(", ")}` : "";
  const sub = ["the workload: one a program", sends].filter(Boolean).join(" · ");
  if (!items?.length) {
    return {
      kind: "client",
      title: "client",
      sub,
      sections: [{ title: "Arrival", props: [{ label: "arrive", value: arrival }], note: "This serQ does not place the workload's statements in its outline: they are edited in Code until it does (docs/upstream.md U21)." }],
    };
  }
  const prop = (label: string, at: Range | null | undefined): Prop => ({ label, value: at ? text(src, at) : "", set: at ? (t) => apply([{ at, text: t }]) : undefined });
  const of = (pick: (k: WorkloadItem) => boolean, label: (k: WorkloadItem) => string) => items.filter((k) => k.value && pick(k)).map((k) => prop(label(k), k.value));
  const sections: Section[] = [
    { title: "Arrival", props: of((k) => k.kind === "arrive", () => "arrive") },
    { title: "Each session starts with", props: of((k) => k.block === "init" && k.kind === "set", (k) => k.name ?? "set") },
    { title: "Each turn draws", props: of((k) => k.block === "turn" && k.kind === "set", (k) => k.name ?? "set") },
    { title: "Each request sends", props: of((k) => k.kind === "send", () => "send") },
    { title: "Between turns", props: of((k) => k.block === "session" && (k.kind === "tool" || k.kind === "set"), (k) => (k.kind === "tool" ? "tool time" : (k.name ?? k.kind))) },
  ];
  return { kind: "client", title: "client", sub, sections: sections.filter((s) => s.props.length) };
}
