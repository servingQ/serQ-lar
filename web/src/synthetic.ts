// A made-up trace of one vLLM-like engine, so the animation has something
// to play before serQ emits request events (docs/upstream.md). It is not a
// serQ run: a Poisson stream, a FIFO waiting queue, `maxSeqs` slots, and an
// iteration that prefills what it admitted and decodes one token for the
// rest. Its only job is to exercise every event kind.

import type { Event, Trace } from "./events";

export interface Synthetic {
  stage: string;
  rate: number; // requests per second
  maxSeqs: number;
  budget: number; // tokens per iteration
  horizon: number; // seconds
  seed: number;
}

export const defaults = (stage: string): Synthetic => ({
  stage,
  rate: 6,
  maxSeqs: 16,
  budget: 8192,
  horizon: 120,
  seed: 1,
});

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Req {
  id: number;
  input: number;
  output: number;
  done: number; // tokens generated
  prefilled: boolean;
}

export function synthetic(o: Synthetic): Trace {
  const u = rng(o.seed);
  const exp = (mean: number) => -Math.log(1 - u()) * mean;
  const ev: Event[] = [];
  const waiting: Req[] = [];
  const running: Req[] = [];
  let next = exp(1 / o.rate);
  let id = 0;
  let t = 0;
  const arriveUntil = (until: number) => {
    while (next <= until && next < o.horizon) {
      // an input over the budget would never be admitted and stall the queue
      const r = { id: id++, input: Math.min(o.budget, Math.ceil(200 + exp(1500))), output: Math.ceil(1 + exp(60)), done: 0, prefilled: false };
      ev.push({ t: next, kind: "arrive", req: r.id });
      ev.push({ t: next, kind: "wait", req: r.id, stage: o.stage });
      waiting.push(r);
      next += exp(1 / o.rate);
    }
  };
  while (t < o.horizon) {
    arriveUntil(t);
    // admit in arrival order while a slot and the token budget allow
    let tokens = running.length;
    while (waiting.length && running.length < o.maxSeqs && tokens + waiting[0].input <= o.budget) {
      const r = waiting.shift()!;
      running.push(r);
      tokens += r.input;
      ev.push({ t, kind: "admit", req: r.id, stage: o.stage, phase: "prefill" });
    }
    if (!running.length) {
      if (next >= o.horizon) break;
      t = next;
      continue;
    }
    const kv = running.reduce((k, r) => k + r.input + r.done, 0);
    const dur = Math.max(2e-4 + 2e-9 * kv * 50, 2e-5 * tokens) * 4;
    ev.push({ t, kind: "forward", stage: o.stage, dur, reqs: running.map((r) => r.id), tokens });
    t += dur;
    for (const r of [...running]) {
      if (!r.prefilled) {
        r.prefilled = true;
        r.done = 1;
        ev.push({ t, kind: "phase", req: r.id, phase: "decode" });
      } else r.done += 1;
      if (r.done >= r.output) {
        running.splice(running.indexOf(r), 1);
        ev.push({ t, kind: "leave", req: r.id, stage: o.stage });
      }
    }
  }
  ev.sort((a, b) => a.t - b.t);
  return { version: 0, source: "synthetic", horizon: o.horizon, events: ev };
}
