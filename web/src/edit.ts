// What an edit made from the figure does to the text. Each function takes
// the source and serQ's outline of it and returns the replacements to make,
// or the reason it cannot: it puts text a person would write (snippets.ts)
// where serQ's outline says the thing is written. Whether the result is a
// program is serQ's answer, when the page compiles it.

import { outputParam, promptParam, type Call, type Outline, type Queue, type Range, type Relation } from "./outline";
import * as snip from "./snippets";

export interface Edit {
  at: Range;
  text: string;
}

/** Something a palette made that is not in the text yet: written there
 * when an arrow first reaches it, so the program links at every step. */
export type Draft =
  | { kind: "queue"; name: string; role: string; family: string | null; text: string; /** relations the copy reads by */ relations: string[] }
  | { kind: "stage"; name: string; text: string }
  | { kind: "nic"; queue: string };

/** Where an arrow starts: where sessions arrive, or a station (by stage name). */
export type From = { kind: "arrival" } | { kind: "station"; stage: string };
/** Where an arrow ends: a station in the figure, or a draft. */
export type To = { kind: "station"; stage: string } | { kind: "draft"; draft: Draft };

/** The text with the edits made, the last first so the ranges hold. */
export function apply(src: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.at[0] - a.at[0] || b.at[1] - a.at[1]);
  let out = src;
  for (const e of sorted) out = out.slice(0, e.at[0]) + e.text + out.slice(e.at[1]);
  return out;
}

// ------------------------------------------------------------ where ----

const lineStart = (src: string, i: number) => src.lastIndexOf("\n", i - 1) + 1;
function lineEnd(src: string, i: number): number {
  const n = src.indexOf("\n", i);
  return n < 0 ? src.length : n;
}
const indentOf = (src: string, i: number) => /^[ \t]*/.exec(src.slice(lineStart(src, i)))![0];

/** A statement on its own line after the one ending at `end` (after its comment, if any). */
function after(src: string, end: number, stmt: string): Edit {
  const at = lineEnd(src, end);
  return { at: [at, at], text: "\n" + reindent(stmt, indentOf(src, end)) };
}

/** A statement or declaration on its own line before the line holding `i`. */
function before(src: string, i: number, text: string, gap = ""): Edit {
  const at = lineStart(src, i);
  return { at: [at, at], text: reindent(text, indentOf(src, i)) + "\n" + gap };
}

/** First in a block's body: the indentation of the body's first line, or two more than the block's. */
function first(src: string, body: Range, stmt: string): Edit {
  const inside = src.slice(body[0], body[1]);
  const m = /\n([ \t]*)\S/.exec(inside);
  if (m) {
    const at = body[0] + inside.indexOf("\n") + 1;
    return { at: [at, at], text: reindent(stmt, m[1]) + "\n" };
  }
  // `{ x; }` on one line: put the statement after the brace
  return { at: [body[0], body[0]], text: ` ${stmt}` };
}

/** Last in a block's body, before its closing brace. */
function last(src: string, body: Range, stmt: string): Edit {
  const close = body[1];
  const inside = src.slice(body[0], close);
  const lines = inside.split("\n").filter((l) => l.trim());
  const indent = lines.length ? /^[ \t]*/.exec(lines[lines.length - 1])![0] : indentOf(src, close) + "  ";
  const at = src.lastIndexOf("\n", close - 1);
  if (at < body[0]) return { at: [close, close], text: ` ${stmt} ` };
  return { at: [at, at], text: "\n" + reindent(stmt, indent) };
}

/** `text`'s lines, each after `indent` (its own indentation kept relative). */
function reindent(text: string, indent: string): string {
  const lines = text.split("\n");
  const base = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => (l.trim() ? indent + l.slice(base) : "")).join("\n");
}

/** Where a new declaration goes in `main`: before the workload, else the server, else at its end. */
function declare(src: string, ol: Outline, text: string): Edit | string {
  if (!ol.main) return "the program has no `fn main() { … }` to declare it in";
  // after the last queue, so that a queue declared above it (a `from`) is
  const lastQueue = ol.queues.reduce<Queue | null>((a, q) => (!a || q.range[1] > a.range[1] ? q : a), null);
  if (lastQueue) {
    const at = lineEnd(src, lastQueue.range[1]);
    return { at: [at, at], text: "\n\n" + reindent(text, indentOf(src, lastQueue.range[0])) };
  }
  const anchor = ol.workload?.[0] ?? ol.server?.range[0];
  if (anchor !== undefined) return before(src, anchor, text, "\n");
  return last(src, ol.main.body, text);
}

// ------------------------------------------------------------ names ----

/** The queue a station is: `P` for `P`, `P`'s NIC for `P.nic`. */
export function queueOf(ol: Outline, stage: string): { queue: Queue; nic: boolean } | null {
  const nic = stage.endsWith(".nic");
  const name = nic ? stage.slice(0, -4) : stage;
  const queue = ol.queues.find((q) => q.name === name);
  return queue ? { queue, nic } : null;
}

/** A word no name in `src` already is. */
export function fresh(src: string, stem: string): string {
  const taken = new Set(src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  if (!taken.has(stem)) return stem;
  for (let i = 2; ; i++) if (!taken.has(`${stem}${i}`)) return `${stem}${i}`;
}

/** A choice variable no name in `src` is: `k`, `m`, … */
function freshVar(src: string): string {
  const taken = new Set(src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  for (const v of ["k", "m", "u", "v", "w", "q"]) if (!taken.has(v)) return v;
  return fresh(src, "k");
}

/** The calls that bring a request to queue `q` along its way: in the server or a route. */
function callsOf(ol: Outline, q: string): Call[] {
  return ol.calls.filter((c) => c.queue === q && c.block !== "entry");
}

/** The first argument a call passes (`prompt` in `P[i].prefill (prompt);`). */
function argOf(src: string, c: Call): string | null {
  const text = src.slice(c.range[0], c.range[1]);
  const open = text.indexOf("(", text.indexOf(c.verb) + c.verb.length);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) {
      const inside = text.slice(open + 1, i).trim();
      return inside || null;
    }
  }
  return null;
}

/** The body the request's way is written in: the gateway's route the server enters, else the server. */
function wayBody(ol: Outline): Range | null {
  const entered = ol.calls.find((c) => c.block === "server" && c.verb === "route");
  const route = entered && ol.routes.find((r) => r.gateway === entered.queue);
  return route?.body ?? ol.server?.body ?? null;
}

// ------------------------------------------------------------ calls ----

const VERB: Record<string, string> = { gateway: "route", prefill: "prefill", agg: "decode", decode: "decode", link: "transfer" };

/** The statements that send a request to queue `name` of `role` (`family` members), passing `arg`. */
function callText(src: string, name: string, role: string, family: string | null, arg: string, from = ""): string {
  const verb = VERB[role];
  const args = role === "gateway" ? "()" : ` (${arg})`;
  if (!family) return `${name}.${verb}${args}${from};`;
  const v = freshVar(src);
  return `choose ${v} in ${family} by (work(${name}[${v}]));\n${name}[${v}].${verb}${args}${from};`;
}

/** The roles a queue has an entry for, the first being the one a call uses. */
function roleOf(q: Queue): string | null {
  for (const r of q.roles) if (VERB[r]) return r;
  return null;
}

/** Send requests on from `from` to queue `name`: its call after the call
 * of `from`'s queue, or first on the way for an arrival. */
function sendTo(src: string, ol: Outline, from: From, name: string, role: string, family: string | null, fromClause = ""): Edit | string {
  const way = wayBody(ol);
  if (from.kind === "arrival") {
    const firstCall = ol.calls.find((c) => c.block !== "entry" && c.verb !== "route");
    const arg = (firstCall && argOf(src, firstCall)) ?? promptParam(ol) ?? "n";
    const stmt = callText(src, name, role, family, arg, fromClause);
    if (way) return first(src, way, stmt);
    if (!ol.main) return "the program has no `fn main() { … }`";
    return last(src, ol.main.body, `server {\n  ${stmt}\n}`);
  }
  const q = queueOf(ol, from.stage);
  const prev = q ? callsOf(ol, q.queue.name)[0] : undefined;
  const prompt = promptParam(ol) ?? "prompt";
  if (prev) return after(src, prev.range[1], callText(src, name, role, family, argOf(src, prev) ?? prompt, fromClause));
  if (!way) return `\`${from.stage}\` is called nowhere the figure can follow: write the call in the text`;
  return last(src, way, callText(src, name, role, family, prompt, fromClause));
}

// ------------------------------------------------------------ edits ----

/** Draw an arrow from `from` to `to`: what the text then says. */
export function connect(src: string, ol: Outline, from: From, to: To): Edit[] | string {
  if (to.kind === "draft") {
    const d = to.draft;
    if (d.kind === "nic") {
      if (from.kind !== "station") return "a NIC's copy starts at a queue: drag from its NIC card to the queue that reads";
      return copy(src, ol, d.queue, queueOf(ol, from.stage)?.queue.name ?? from.stage, "pull");
    }
    const decl = declare(src, ol, d.text);
    if (typeof decl === "string") return decl;
    if (d.kind === "stage") {
      const stmt = `run ${d.name} (cost(${d.name}, 0.01));`;
      const at = from.kind === "station" ? callsOf(ol, queueOf(ol, from.stage)?.queue.name ?? "")[0] : undefined;
      const way = wayBody(ol);
      const call = at ? after(src, at.range[1], stmt) : way ? (from.kind === "arrival" ? first(src, way, stmt) : last(src, way, stmt)) : null;
      if (!call) return "the program has no server to run the stage from";
      return [decl, call];
    }
    // a queue: its declaration, the relations it reads by, and its call
    const edits: Edit[] = [decl];
    const rel = d.relations.length ? relationsAfter(src, ol, d.relations) : null;
    if (rel) edits.push(...rel);
    const source = d.relations.length ? /\(\s*([A-Za-z_]\w*)/.exec(d.relations[0])?.[1] : undefined;
    const fromClause = source && from.kind === "station" && queueOf(ol, from.stage)?.queue.name === source ? ` from ${memberOf(ol, source)}` : "";
    const send = sendTo(src, ol, from, d.name, d.role, d.family, fromClause);
    if (typeof send === "string") return send;
    edits.push(send);
    return edits;
  }
  const target = queueOf(ol, to.stage);
  if (!target) return `\`${to.stage}\` is no queue: the figure calls a queue's entry, so write a call to this stage in the text`;
  if (from.kind === "station") {
    const source = queueOf(ol, from.stage);
    if (source && source.queue.name === target.queue.name) return "a station to itself: a loop is written in the text (`while`)";
    // NIC to NIC, or a prefiller to a decoder with NICs: the KV copy between them
    if (source && (from.stage.endsWith(".nic") || to.stage.endsWith(".nic"))) return copy(src, ol, source.queue.name, target.queue.name, "pull");
  }
  const role = roleOf(target.queue);
  if (!role) return `queue \`${target.queue.name}\` has no entry a request is sent to`;
  const send = sendTo(src, ol, from, target.queue.name, role, target.queue.family);
  return typeof send === "string" ? send : [send];
}

/** The member a call of queue `q` names (`P[i]`), or `q` if none does. */
function memberOf(ol: Outline, q: string): string {
  const c = callsOf(ol, q)[0];
  return c?.index ? `${q}[${c.index}]` : q;
}

/** The relations' text after the last of the queues they name, and the `use`s they need. */
function relationsAfter(src: string, ol: Outline, texts: string[]): Edit[] {
  const out: Edit[] = [...needUses(src, ol)];
  const anchor = ol.relations.length ? ol.relations[ol.relations.length - 1].range[1] : null;
  if (anchor !== null) for (const t of texts) out.push(after(src, anchor, t));
  // otherwise they follow the new queue, which `declare` puts after the last one
  else {
    const lastQueue = ol.queues.reduce<Queue | null>((a, q) => (!a || q.range[1] > a.range[1] ? q : a), null);
    if (lastQueue) for (const t of texts) out.push({ at: [lineEnd(src, lastQueue.range[1]), lineEnd(src, lastQueue.range[1])], text: "\n" + reindent(t, indentOf(src, lastQueue.range[0])) });
  }
  return out;
}

/** `use "std/kvt";` and `use "std/share";`, where missing. */
function needUses(src: string, ol: Outline): Edit[] {
  const have = new Set(ol.uses.map((u) => u.path));
  const want = ["std/kvt", "std/share"].filter((p) => !have.has(p));
  if (!want.length) return [];
  const text = want.map((p) => `use "${p}";`).join("\n");
  const lastUse = ol.uses[ol.uses.length - 1];
  if (lastUse) return [{ at: [lineEnd(src, lastUse.range[1]), lineEnd(src, lastUse.range[1])], text: "\n" + text }];
  return [{ at: [0, 0], text: text + "\n" }];
}

/** The KV copy from queue `source` to queue `reader` over NIXL: the
 * relation, a NIC on each side, the reader's entry `from` the source, and
 * the reader's call `from` the source's member; a push, the source's call
 * a leg of its own (`legs`). */
export function copy(src: string, ol: Outline, source: string, reader: string, mode: "pull" | "push"): Edit[] | string {
  const S = ol.queues.find((q) => q.name === source);
  const R = ol.queues.find((q) => q.name === reader);
  if (!S || !R) return "a KV copy joins two queues";
  if (ol.relations.some((r) => r.reader === reader)) return `\`${reader}\` already reads its KV from a queue: a reader has one source`;
  const edits: Edit[] = [...needUses(src, ol)];
  for (const q of [S, R]) if (!q.members.some((m) => m.kind === "nic")) edits.push(memberEdit(src, q, snip.nic()));
  // the reader's engine reads the KV with a connector to the source
  const engine = R.members.find((m) => m.kind === "engine");
  if (!engine?.body) return `\`${reader}\` has no engine to read the KV into`;
  if (!new RegExp(`\\bconnector\\s+${source}\\b`).test(src.slice(engine.body[0], engine.body[1]))) {
    const body = src.slice(engine.body[0], engine.body[1]);
    const sched = /\n([ \t]*)scheduler\b/.exec(body);
    edits.push(sched ? before(src, engine.body[0] + sched.index + 1 + sched[1].length, snip.connector(source)) : last(src, engine.body, snip.connector(source)));
  }
  // the reader becomes a decoder: its local entry reads the KV from the
  // source (`decode (prompt) from P`), and its role is serQ's for that entry
  if (!R.members.some((m) => m.kind === "entry" && m.from === source)) {
    const local = R.members.find((m) => m.kind === "entry" && !m.from);
    if (!local) return `\`${reader}\` has no entry to read the KV into`;
    const header = /^\s*\w+\s*\([^)]*\)/.exec(src.slice(local.range[0], local.range[1]));
    if (!header) return `${reader}'s entry is not written where serQ's outline says`;
    const end = local.range[0] + header[0].length;
    edits.push({ at: [end, end], text: ` from ${source}` });
    if (R.roles.includes("agg")) {
      const role = roleEdit(src, R, "agg", "decode");
      if (typeof role === "string") return role;
      edits.push(role);
    }
  }
  // the relation, after the later of the two queues and any relation there is
  const anchor = Math.max(S.range[1], R.range[1], ...ol.relations.map((r) => r.range[1]));
  edits.push(after(src, anchor, snip.relation(mode, source, reader)));
  // the reader's calls take the KV from the source's member
  for (const c of callsOf(ol, reader)) {
    if (c.from) continue;
    const semi = src.lastIndexOf(";", c.range[1]);
    edits.push({ at: [semi, semi], text: ` from ${memberOf(ol, source)}` });
  }
  if (mode === "push") edits.push(...legs(src, ol, source, true));
  return edits;
}

/** A line in a queue, before its entries (or at its end). */
function memberEdit(src: string, q: Queue, text: string): Edit {
  const entry = q.members.find((m) => m.kind === "entry");
  if (entry) return before(src, entry.range[0], text);
  return last(src, q.body, text);
}

/** Turn a copy's pull into push and back. In a push the source posts into
 * blocks the reader allocated, so the reader is asked before the source is
 * done: the source's call becomes a leg of its own (`fork { … }`, as in
 * serQ's vllm_nixl_push.sq), which serQ requires of a push. Back to a pull,
 * a fork holding the source's call alone goes. */
export function toggle(src: string, ol: Outline, r: Relation): Edit[] {
  return [{ at: r.function, text: r.mode === "pull" ? "nixl_push" : "nixl_pull" }, ...legs(src, ol, r.source, r.mode === "pull")];
}

/** Each call of queue `source` made a leg of its own (`fork { … }`), or,
 * `fork` false, a fork holding the call alone taken away. */
function legs(src: string, ol: Outline, source: string, fork: boolean): Edit[] {
  const out: Edit[] = [];
  for (const c of callsOf(ol, source)) {
    const head = /fork\s*\{\s*$/.exec(src.slice(lineStart(src, c.range[0]), c.range[0]));
    const tail = /^\s*\}/.exec(src.slice(c.range[1]));
    const forked = head !== null && tail !== null;
    if (fork && !forked) {
      out.push({ at: [c.range[0], c.range[0]], text: "fork { " }, { at: [c.range[1], c.range[1]], text: " }" });
    } else if (!fork && forked) {
      const start = c.range[0] - head[0].length;
      out.push({ at: [start, c.range[0]], text: "" }, { at: [c.range[1], c.range[1] + tail[0].length], text: "" });
    }
  }
  return out;
}

/** The engine role queue `q` plays: a decoder's where it reads a
 * prefiller's KV (llm-d's pod plays `agg, decode`), else an aggregated
 * engine's or a prefiller's. */
export function engineRole(q: Queue): snip.Role | null {
  return (["decode", "agg", "prefill"] as const).find((r) => q.roles.includes(r)) ?? null;
}

/** Make queue `q` an engine of `role`: an aggregated engine or a
 * prefiller, the role its head declares, its engine's scheduler, its entry
 * (snippets.ts), and the verb its calls send by; a decoder, the KV copy
 * from the one prefiller there is (`copy`), which makes its reader one. A
 * queue in a KV copy reads or leases by its entry's role, and an entry
 * written by hand is the writer's: both are left to the text. */
export function retype(src: string, ol: Outline, q: string, role: snip.Role): Edit[] | string {
  const Q = ol.queues.find((x) => x.name === q);
  if (!Q) return `\`${q}\` is no queue`;
  const was = engineRole(Q);
  if (!was) return `\`${q}\` is no engine of a role (agg, prefill or decode): its role is written in the text`;
  if (was === role) return [];
  if (ol.relations.some((r) => r.source === q || r.reader === q)) return `${q} is in a KV copy, which its entry leases or reads by: change its role in the text`;
  if (role === "decode") {
    if (was !== "agg") return `a decoder reads the KV a prefiller leased: make ${q} an aggregated engine first`;
    const prefillers = ol.queues.filter((x) => x.name !== q && x.roles.includes("prefill"));
    if (prefillers.length !== 1)
      return prefillers.length
        ? `a decoder reads its KV from a prefiller: drag a KV copy to ${q} from the one it reads (${prefillers.map((x) => x.name).join(", ")})`
        : `a decoder reads its KV from a prefiller, and there is none: add one first`;
    return copy(src, ol, prefillers[0].name, q, "pull");
  }
  const entries = Q.members.filter((m) => m.kind === "entry");
  if (entries.length !== 1 || entries[0].from || entries[0].name !== VERB[was]) return `${q}'s entries are not one \`${VERB[was]} (prompt)\`: change its role in the text`;
  const edits: Edit[] = [];
  const head = roleEdit(src, Q, was, role);
  if (typeof head === "string") return head;
  edits.push(head);
  const engine = Q.members.find((m) => m.kind === "engine");
  if (engine?.body) {
    const sched = /\bscheduler\s*\{/.exec(src.slice(engine.body[0], engine.body[1]));
    if (sched) {
      const start = engine.body[0] + sched.index;
      const end = closing(src, start + sched[0].length - 1);
      if (end < 0) return `${q}'s scheduler has no closing brace`;
      edits.push({ at: [start, end + 1], text: reindent(snip.scheduler(role), indentOf(src, start)).trimStart() });
    }
  }
  const e = entries[0];
  edits.push({ at: e.range, text: reindent(snip.entry(role, q, outputParam(ol) ?? undefined), indentOf(src, e.range[0])).trimStart() });
  const [from, to] = [VERB[was], VERB[role]];
  if (from !== to)
    for (const c of callsOf(ol, q)) {
      const m = new RegExp(`\\.\\s*${from}\\b`).exec(src.slice(c.range[0], c.range[1]));
      if (m) edits.push({ at: [c.range[0] + m.index + m[0].length - from.length, c.range[0] + m.index + m[0].length], text: to });
    }
  return edits;
}

/** Role `was` in queue `Q`'s head (`queue Q[N] : was {`) made `role`. */
function roleEdit(src: string, Q: Queue, was: string, role: string): Edit | string {
  const head = new RegExp(`^(\\s*queue\\s+${Q.name}\\b[^:{]*:[^{]*?)\\b${was}\\b`).exec(src.slice(Q.range[0], Q.body[0]));
  if (!head) return `\`queue ${Q.name} : ${was}\` is not written where serQ's outline says`;
  const at = Q.range[0] + head[1].length;
  return { at: [at, at + was.length], text: role };
}

/** The brace closing the one at `open`, or -1. */
function closing(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** A pool in queue `q`. */
export function addPool(src: string, ol: Outline, q: string, text: string): Edit[] | string {
  const Q = ol.queues.find((x) => x.name === q);
  if (!Q) return `no queue \`${q}\``;
  // after the queue's last pool, else before its entries
  const pools = Q.members.filter((m) => m.kind === "pool");
  if (pools.length) return [after(src, pools[pools.length - 1].range[1], text)];
  return [memberEdit(src, Q, text)];
}

/** Declare a memory pool `name` in queue `q`, and the capacity serQ sizes
 * it by (a pool is one of its device's or engine's capacities): request
 * slots, `name cap N;` in the engine and the pool on the queue; KV blocks,
 * `name cap N;` (tokens) in the device and the pool on it. serQ takes one KV
 * pool per device. */
export function declarePool(src: string, ol: Outline, q: string, name: string, kind: "slots" | "blocks", cap: string): Edit[] | string {
  const Q = ol.queues.find((x) => x.name === q);
  if (!Q) return `no queue \`${q}\``;
  if (Q.members.some((m) => m.kind === "pool" && m.name === name)) return `${q} has a pool \`${name}\` already`;
  const holder = Q.members.find((m) => m.kind === (kind === "slots" ? "engine" : "device"));
  if (!holder?.body) return `queue \`${q}\` has no ${kind === "slots" ? "engine" : "device"} to size the pool by`;
  const pool = addPool(src, ol, q, snip.pool(name, kind === "slots" ? q : holder.name ?? "gpu", kind));
  if (typeof pool === "string") return pool;
  return [capacity(src, holder.body, snip.capacity(name, cap)), ...pool];
}

/** A capacity in a device's or an engine's body: after the last one there, or the body's first line. */
function capacity(src: string, body: Range, stmt: string): Edit {
  const inside = src.slice(body[0], body[1]);
  // `device gpu { …; kv cap X; }` on one line: before its closing brace
  if (!inside.includes("\n")) return { at: [body[1], body[1]], text: `${/\s$/.test(inside) ? "" : " "}${stmt} ` };
  const caps = [...inside.matchAll(/\b[A-Za-z_]\w*\s+cap\b[^;{}]*;/g)];
  const lastCap = caps[caps.length - 1];
  return lastCap ? after(src, body[0] + lastCap.index + lastCap[0].length, stmt) : first(src, body, stmt);
}

/** The size of a family: the `let` it names, or the number in its brackets. */
export function resize(src: string, ol: Outline, q: string, by: number): Edit[] | string {
  const Q = ol.queues.find((x) => x.name === q);
  if (!Q?.family) return `\`${q}\` is one queue, not a family: write \`queue ${q}[N]\` and call its members by index`;
  const lit = /^\s*(\d+)\s*$/.exec(Q.family);
  if (lit) {
    const n = Math.max(1, Number(lit[1]) + by);
    const at = src.indexOf("[", Q.range[0]) + 1;
    return [{ at: [at, at + Q.family.length], text: String(n) }];
  }
  const name = Q.family.trim();
  const decl = ol.decls.find((d) => d.kind === "let" && d.name === name);
  if (!decl) return `\`${q}\`'s size is \`${name}\`, which is no \`let\` of the program`;
  const text = src.slice(decl.range[0], decl.range[1]);
  const m = /=\s*(\d+)\s*;/.exec(text);
  if (!m) return `\`${name}\` is not a number to step: edit it in the text`;
  const n = Math.max(1, Number(m[1]) + by);
  const at = decl.range[0] + m.index + m[0].indexOf(m[1]);
  return [{ at: [at, at + m[1].length], text: String(n) }];
}

/** Make queue `q`'s engine and NIC an instance, the panel serQ draws around
 * what one `choose` variable indexes: the queue a family of one (`queue
 * P[1]`), each call choosing its member (`choose k in 1 by (work(P[k]));
 * P[k].prefill (…);`), and a call reading the KV `from P` reading it from
 * that member. serQ runs a KV copy between two families or two queues, not
 * one of each, so the queue at the copy's other end becomes an instance
 * too, by a variable of its own. A NIC carries a copy (serQ refuses one that
 * carries none): a queue without one is sent to + NIC first. The instances
 * stay one each: the −/+ beside them makes them more. */
export function instance(src: string, ol: Outline, q: string): Edit[] | string {
  const Q = ol.queues.find((x) => x.name === q);
  if (!Q) return `\`${q}\` is no queue: an instance is a queue's engine with its NIC`;
  if (!Q.members.some((m) => m.kind === "engine")) return `queue \`${q}\` has no engine to make an instance of`;
  if (!Q.members.some((m) => m.kind === "nic")) return `\`${q}\` has no NIC to bundle: draw a KV transfer from it first, then make the instance`;
  if (Q.family) return `\`${q}[${Q.family}]\` is a family with its NIC already: serQ draws its instance when its calls choose a member (\`choose k in … ; ${q}[k]…\`)`;
  return route(src, ol, q);
}

/** Route queue `q`'s calls through a router: each call chooses a member of
 * its family (`choose k in ND by (work(D[k])); D[k].decode (…);`), by the
 * least work until the router is given other keys. A plain queue becomes a
 * family of one; so does the queue at a KV copy's other end, by a variable
 * of its own, since serQ runs a copy between two families or two queues. */
export function route(src: string, ol: Outline, q: string): Edit[] | string {
  const Q = ol.queues.find((x) => x.name === q);
  if (!Q) return `\`${q}\` is no queue: a router chooses among a queue's members`;
  if (Q.family) {
    const calls = callsOf(ol, q).filter((c) => c.index === null);
    if (!calls.length) return `every call to \`${q}\` chooses its member already: click the router to change how`;
    const v = freshVar(src);
    const edits: Edit[] = [];
    for (const c of calls) {
      if (src.slice(c.range[0], c.range[0] + q.length) !== q) return `a call to \`${q}\` is not written as \`${q}.…\`: edit it in the text`;
      edits.push(before(src, c.range[0], `choose ${v} in ${Q.family} by (work(${q}[${v}]));`));
      edits.push({ at: [c.range[0], c.range[0] + q.length], text: `${q}[${v}]` });
    }
    return edits;
  }
  const ends = [Q, ...ol.relations.flatMap((r) => (r.source === q ? [r.reader] : r.reader === q ? [r.source] : [])).map((n) => ol.queues.find((x) => x.name === n)!)].filter(
    (x, i, all) => x && !x.family && all.indexOf(x) === i,
  );
  const edits: Edit[] = [];
  let taken = src;
  for (const X of ends) {
    const v = freshVar(taken);
    taken += ` ${v}`;
    const e = familyOfOne(src, ol, X, v);
    if (typeof e === "string") return e;
    edits.push(...e);
  }
  return edits;
}

/** Queue `X` a family of one whose calls choose their member by `v`. */
function familyOfOne(src: string, ol: Outline, X: Queue, v: string): Edit[] | string {
  const q = X.name;
  const calls = callsOf(ol, q);
  if (!calls.length) return `\`${q}\` is called nowhere the figure can follow: write its call in the text`;
  const head = new RegExp(`\\bqueue\\s+${q}\\b`).exec(src.slice(X.range[0], X.body[0]));
  if (!head) return `\`queue ${q}\` is not written where serQ's outline says`;
  const name = X.range[0] + head.index + head[0].length;
  const edits: Edit[] = [{ at: [name, name], text: "[1]" }];
  for (const c of calls) {
    if (src.slice(c.range[0], c.range[0] + q.length) !== q) return `a call to \`${q}\` is not written as \`${q}.…\`: edit it in the text`;
    edits.push(before(src, c.range[0], `choose ${v} in 1 by (work(${q}[${v}]));`));
    edits.push({ at: [c.range[0], c.range[0] + q.length], text: `${q}[${v}]` });
  }
  for (const c of ol.calls) {
    if (c.block === "entry" || c.from !== q) continue;
    const m = new RegExp(`\\bfrom\\s+${q}\\b(?!\\s*\\[)`).exec(src.slice(c.range[0], c.range[1]));
    if (m) {
      const end = c.range[0] + m.index + m[0].length;
      edits.push({ at: [end, end], text: `[${v}]` });
    }
  }
  return edits;
}

/** Remove queue `q`: its declaration, the calls to it, the copies it is in. serQ says what else must go. */
export function remove(src: string, ol: Outline, q: string): Edit[] {
  const out: Edit[] = [];
  // the range with its line, when nothing but space (and a comment after) shares it
  const whole = (r: Range): Edit => {
    const s = lineStart(src, r[0]);
    const e = lineEnd(src, r[1]);
    const alone = src.slice(s, r[0]).trim() === "" && /^\s*(\/\/.*)?$/.test(src.slice(r[1], e));
    return alone ? { at: [s, Math.min(src.length, e + 1)], text: "" } : { at: r, text: "" };
  };
  const Q = ol.queues.find((x) => x.name === q);
  if (Q) out.push(whole(Q.range));
  for (const c of ol.calls) if (c.queue === q && c.block !== "entry") out.push(whole(c.range));
  for (const r of ol.relations) if (r.source === q || r.reader === q) out.push(whole(r.range));
  for (const x of ol.queues) for (const m of x.members) if (m.kind === "entry" && m.from === q) out.push(whole(m.range));
  for (const c of ol.calls) {
    if (c.queue === q || !c.from || c.from.replace(/\[.*$/, "") !== q) continue;
    const text = src.slice(c.range[0], c.range[1]);
    const m = /\s+from\s+[^;]+(?=;)/.exec(text);
    if (m) out.push({ at: [c.range[0] + m.index, c.range[0] + m.index + m[0].length], text: "" });
  }
  // overlapping ranges (an entry inside a removed queue): keep the outermost
  return out.filter((e) => !out.some((o) => o !== e && o.at[0] <= e.at[0] && o.at[1] >= e.at[1] && (o.at[0] < e.at[0] || o.at[1] > e.at[1])));
}
