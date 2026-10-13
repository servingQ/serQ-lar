// The request trace serq-lar animates: what happened to each request, when.
// The contract with serQ is docs/trace-format.md; until serQ emits it,
// `synthetic.ts` produces a trace of this shape.

export type Phase = "prefill" | "decode";

export type Event =
  /** A request is issued by its session. */
  | { t: number; kind: "arrive"; req: number }
  /** It waits in the queue ahead of `stage` (the queue of `pool`, if one). */
  | { t: number; kind: "wait"; req: number; stage: string; pool?: string }
  /** It is admitted: resident in `stage`, holding what admission took. */
  | { t: number; kind: "admit"; req: number; stage: string; phase: Phase }
  /** Its prefill has ended: it decodes from now on. */
  | { t: number; kind: "phase"; req: number; phase: Phase }
  /** `stage` runs a forward pass over `reqs` for `dur` seconds. */
  | { t: number; kind: "forward"; stage: string; dur: number; reqs: number[]; tokens: number }
  /** It is preempted: back to the queue ahead of `stage`. */
  | { t: number; kind: "preempt"; req: number; stage: string }
  /** It leaves `stage` (and, for now, the figure). */
  | { t: number; kind: "leave"; req: number; stage: string };

export interface Trace {
  version: 0;
  /** `serq`: emitted by the engine. `synthetic`: made up here. */
  source: "serq" | "synthetic";
  horizon: number;
  /** In time order. */
  events: Event[];
}
