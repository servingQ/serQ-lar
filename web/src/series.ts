// What a run measures, as serQ reports it: the report's rows (`serq run
// --json`, serQ's docs/reference/cli.md) and, under `series`, what the JSON
// leaves out and `--dump` writes: every sample of each client metric and
// `observe` with its time, and each gauge's change points. `crates/serq-wasm`
// adds `series` to `run_logged`'s JSON from serQ's `Report`; nothing here
// is computed by the page.

import type { Log } from "./events";

/** The samples of a client metric or an `observe`, in recording order: value, time, session, turn. */
export interface Samples {
  t: number[];
  v: number[];
  s: number[];
  turn: number[];
}

/** A gauge's change points: `v[i]` holds from `t[i]` to `t[i + 1]`. */
export interface Points {
  t: number[];
  v: number[];
}

export interface Series {
  version: 0;
  /** `ttft`, `tpot`, `response`: what each turn's client saw. */
  client: Record<string, Samples>;
  observes: Record<string, Samples>;
  gauges: Record<string, Points>;
}

/** An `observe`'s or a client metric's statistics (`null`: no sample, or no finite value). */
export interface ObserveRow {
  count: number;
  mean: number | null;
  ci: number | null;
  cv2: number | null;
  p99: number | null;
}

export interface GaugeRow {
  mean: number | null;
  ci: number | null;
  min: number | null;
  max: number | null;
}

export interface StageRow {
  name: string;
  index: number | null;
  mean_number: number | null;
  utilization: number | null;
  completed: number;
  throughput: number | null;
  mean_wait: number | null;
  mean_service: number | null;
  iterations: number;
  prefill_only: number | null;
  decode_only: number | null;
  mixed: number | null;
  mean_decodes: number | null;
  mean_decode_batch: number | null;
  mean_decode_step: number | null;
  mean_itl: number | null;
  itl_p50: number | null;
  itl_p99: number | null;
  idle_with_work: boolean;
}

export interface PoolRow {
  name: string;
  index: number | null;
  mean_used: number | null;
  mean_cached: number | null;
  mean_queue: number | null;
  mean_holders: number | null;
  mean_wait: number | null;
  admissions: number;
  evicted_entries: number;
  evicted_units: number | null;
  preemptions: number;
  spills: number;
  rejected: number;
  stuck: number;
  over_cap: { queue: string; need: number } | null;
  growing_at_end: number;
  growing_stalled: boolean;
}

/** `run_logged`'s JSON: the report with its `log` and `series`. */
export interface Report {
  serq_version: string;
  horizon: number;
  end: number;
  warmup: number;
  seed: number;
  events: number;
  arrivals: number;
  ended: number;
  turns: number;
  mean_live: number | null;
  observes: Record<string, ObserveRow>;
  client: Record<string, ObserveRow>;
  gauges: Record<string, GaugeRow>;
  stages: StageRow[];
  pools: PoolRow[];
  log: Log;
  series: Series;
}

/** What the page reads of the IR (`serq ir`): the pools' capacities, the stages' kinds. */
export interface Ir {
  pools: { name: string; index?: number | null; cap: number | "inf"; admit_via?: number | null }[];
  stages: { name: string; index?: number | null; kind: string | Record<string, unknown> }[];
}
