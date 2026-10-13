# The request trace (version 0)

What serq-lar animates, and what it asks serQ to emit (upstream.md, U1).
Types: `web/src/events.ts`.

```json
{
  "version": 0,
  "source": "serq",
  "horizon": 120,
  "events": [
    { "t": 0.31, "kind": "arrive",  "req": 0 },
    { "t": 0.31, "kind": "wait",    "req": 0, "stage": "vllm", "pool": "reqs" },
    { "t": 0.31, "kind": "admit",   "req": 0, "stage": "vllm", "phase": "prefill" },
    { "t": 0.31, "kind": "forward", "stage": "vllm", "dur": 0.042, "reqs": [0], "tokens": 1873 },
    { "t": 0.35, "kind": "phase",   "req": 0, "phase": "decode" },
    { "t": 2.10, "kind": "leave",   "req": 0, "stage": "vllm" }
  ]
}
```

| kind | means | the animation |
|---|---|---|
| `arrive` | a session issues a request | a circle appears at the source |
| `wait` | it waits in the queue ahead of `stage` (of `pool`) | hollow, in the queue lane |
| `admit` | admitted: resident in `stage` | filled, inside the station |
| `phase` | its prefill has ended | orange → blue |
| `forward` | `stage` runs a forward pass over `reqs` for `dur` | halo on those requests, progress bar on the station |
| `preempt` | evicted back to the queue | back to hollow, orange (recompute) |
| `leave` | done at `stage` | moves out and fades |

`req` is unique within a trace (serQ: session and turn). `t` and `dur` are
simulated seconds. Events are in time order; ties keep emission order.

Open questions for version 1: multi-stage paths (P/D: a request leaves the
prefiller and waits at the decoder - `leave` then `wait` at another stage
already says it); transfers (a `transfer` kind with source and destination
NICs); chunked prefill (`phase` only on the last chunk; `forward` carries
per-request token counts?); size, a columnar encoding past ~10⁵ events.
