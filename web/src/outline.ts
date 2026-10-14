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

export interface Outline {
  main: Block | null;
  uses: { path: string; range: Range }[];
  decls: { kind: string; name: string; range: Range }[];
  queues: Queue[];
  relations: Relation[];
  routes: { gateway: string; range: Range; body: Range }[];
  server: Block | null;
  workload: Range | null;
  calls: Call[];
}

/** The outline serQ wrote for `src`, its byte offsets made string indices. */
export function outline(json: string, src: string): Outline {
  const at = byteIndex(src);
  return JSON.parse(json, (_key, v) =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" ? [at(v[0]), at(v[1])] : v,
  ) as Outline;
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
