// The run log serQ emits (`serq run --log`, docs/reference/log.md in serQ,
// version 0): what each session did, when. serq-lar replays it; nothing
// here is made up.

/** A stage or a pool: its name and, in an array, its index. */
export interface Named {
  name: string;
  index: number | null;
}

/** Who an event is about: a session by its serial; a leg of it (`fork`) by its leg number too. */
export interface About {
  s: number;
  leg?: number;
}

export type LogEvent =
  | ({ t: number; ev: "arrive" | "fork" } & About)
  | ({ t: number; ev: "turn"; turn: number } & About)
  | ({ t: number; ev: "wait" | "admit" | "preempt" | "revoke"; pool: number } & About)
  | ({ t: number; ev: "refuse" | "end" } & About)
  | ({ t: number; ev: "run"; stages: number[]; mode?: "prefill" | "decode" } & About)
  | ({ t: number; ev: "done"; stage: number } & About)
  /** `reqs`: each request as `[serial]`, or `[serial, leg]` for a leg's. */
  | { t: number; ev: "iter"; stage: number; dur: number; tokens: number; reqs: number[][] };

export interface Log {
  version: 0;
  stages: Named[];
  pools: Named[];
  /** The event cap stopped the log before the run ended. */
  truncated: boolean;
  /** In time order. */
  events: LogEvent[];
}

/** The key of a session or a leg in a map. */
export function who(e: About): string {
  return e.leg === undefined ? String(e.s) : `${e.s}/${e.leg}`;
}

/** The key of a request in an iteration's batch. */
export function whoOf(r: number[]): string {
  return r.length > 1 ? `${r[0]}/${r[1]}` : String(r[0]);
}

/** `P[0]`, `tool`. */
export function label(n: Named): string {
  return n.index === null ? n.name : `${n.name}[${n.index}]`;
}
