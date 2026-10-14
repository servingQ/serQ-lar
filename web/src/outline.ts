// serQ's outline of a program's text (`serq::outline`, serQ's
// docs/reference/outline.md): where each declaration, relation and entry
// call is written. The page edits the text there; what the edit means is
// serQ's to say when it compiles the result. serQ counts in UTF-8 bytes and
// a JavaScript string in UTF-16 units, so `outline` turns the one into the
// other on the way in.

/** `[start, end)` into the source, as string indices once `outline` has read it. */
export type Range = [number, number];

export interface Block {
  range: Range;
  body: Range;
}

export interface Member {
  /** `device`, `engine`, `pool`, `nic`, `serve`, or `entry`. */
  kind: string;
  /** A device's or a pool's name; an entry's verb. */
  name?: string;
  from?: string;
  range: Range;
  body?: Range;
}

export interface Queue {
  name: string;
  roles: string[];
  /** The text between a family's brackets (`NP` in `queue P[NP]`). */
  family: string | null;
  range: Range;
  body: Range;
  members: Member[];
}

export interface Relation {
  mode: "pull" | "push";
  source: string;
  reader: string;
  range: Range;
  /** The function's name, `nixl_pull` or `nixl_push`. */
  function: Range;
}

export interface Call {
  queue: string;
  index: string | null;
  verb: string;
  from: string | null;
  /** The statement, to its `;`. */
  range: Range;
  block: "server" | "route" | "entry";
  owner?: string;
}

/** A `choose` statement: a router's pick of a family's member. */
export interface Choose {
  /** Its variable (`j`), what it is chosen among (`ND`), each key of `by (…)`, and the parenthesised list. */
  var: string;
  count: Range;
  keys: Range[];
  by: Range;
  /** The statement, to its `;`. */
  range: Range;
  block: "server" | "route" | "entry";
  owner?: string;
}

/** A statement of the workload: its arrival process, a turn's draw, a tool call. */
export interface WorkloadItem {
  kind: string;
  name?: string;
  block: "workload" | "init" | "turn" | "session";
  /** The expression: `poisson(Lambda)`, a set's value, a tool's time. */
  value: Range | null;
  range: Range;
}

/** The server's signature: what a request carries, and its reply. */
export interface Signature {
  params: { name: string; hidden: boolean }[];
  reply: string[];
}

export interface Outline {
  main: Block | null;
  uses: { path: string; range: Range }[];
  decls: { kind: string; name: string; range: Range }[];
  queues: Queue[];
  relations: Relation[];
  routes: { gateway: string; range: Range; body: Range }[];
  server: Block | null;
  /** Absent before serQ's outline said it; empty for a bare `server`. */
  signature?: Signature | null;
  workload: Range | null;
  calls: Call[];
  /** Absent before serQ's outline said them (docs/upstream.md U21). */
  chooses?: Choose[];
  workload_items?: WorkloadItem[];
}

/** The outline serQ wrote for `src`, its byte offsets made string indices. */
export function outline(json: string, src: string): Outline {
  const at = byteIndex(src);
  return JSON.parse(json, (_key, v) =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" ? [at(v[0]), at(v[1])] : v,
  ) as Outline;
}

/** What a request carries as its prompt: the server's first parameter the
 * scheduler may read (`input` in `server (input, hidden output)`). */
export function promptParam(o: Outline | null): string | null {
  return o?.signature?.params.find((p) => !p.hidden)?.name ?? null;
}

/** What the model generates and the scheduler may not read: the server's
 * hidden parameter (`output`), which a decode runs by. */
export function outputParam(o: Outline | null): string | null {
  return o?.signature?.params.find((p) => p.hidden)?.name ?? null;
}

/** What each name the outline declares is: `queue`, a declaration's kind, a member's kind. */
export function kinds(o: Outline): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of o.decls) m.set(d.name, d.kind);
  for (const q of o.queues) {
    m.set(q.name, "queue");
    for (const x of q.members) if (x.name && x.kind !== "entry") m.set(x.name, x.kind);
  }
  return m;
}

/** A function from a UTF-8 byte offset of `src` to its string index. */
function byteIndex(src: string): (b: number) => number {
  // ASCII text: the two are the same
  if (!/[^\x00-\x7f]/.test(src)) return (b) => b;
  const starts: number[] = [];
  let bytes = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src.codePointAt(i)!;
    starts.push(bytes);
    if (c >= 0x10000) {
      starts.push(bytes); // the low surrogate: no byte of its own
      i++;
    }
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  starts.push(bytes);
  return (b) => {
    // the first index whose byte offset is b
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < b) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}
