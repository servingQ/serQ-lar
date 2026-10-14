// The text the figure's palette writes: what a person would type, in the
// style of serQ's examples (vllm.sq's engine, llmd_nixl_pull.sq's queues
// and relation). The constants are placeholders to edit; serQ checks the
// result like any other text.

/** A queue that prefills: device, engine, its request slots and KV, and the
 * entry that computes the prompt and leases the KV for a reader. */
export function prefill(name: string): string {
  return `queue ${name} : prefill {
  device gpu { compute (t) = t * 2e-5; hbm (k) = 2e-4 + 2e-9 * k; kv cap 160000; }
  engine on gpu {
    reqs cap 16;
    tokens cap 8192;
    scheduler { advance running; admit waiting while (running.preempted == 0); }
    worker { forward (max(hbm(batch.kv_decode + batch.kv_prefill), compute(batch.tokens))); }
  }
  pool reqs on ${name} { queue fifo; }
  pool kv on gpu { block 16; evict lru; preempt lifo; }
  prefill (prompt) {
    hold reqs (cost(reqs, 1)), kv (cost(kv, prompt)) {
      run ${name} prefill (cost(${name}, prompt)) growing kv;
    } lease kv (inf);
  }
}`;
}

/** A queue that decodes: device, engine, its request slots and KV, and the
 * entry that prefills locally and decodes the workload's hidden \`o\` tokens. */
export function decode(name: string): string {
  return `queue ${name} : decode {
  device gpu { compute (t) = t * 2e-5; hbm (k) = 2e-4 + 2e-9 * k; kv cap 160000; }
  engine on gpu {
    reqs cap 64;
    tokens cap 8192;
    scheduler {
      advance running;
      admit waiting while (running.preempted == 0) taking reqs (1), kv (request.known) reserve (request.known);
    }
    worker { forward (max(hbm(batch.kv_decode + batch.kv_prefill), compute(batch.tokens))); }
  }
  pool reqs on ${name} { queue fifo; }
  pool kv on gpu { block 16; evict lru; preempt lifo; }
  decode (prompt) {
    ${name} (prompt, o);
  }
}`;
}

/** A delay stage: a wait outside any engine (a hop, an API server). */
export function delay(name: string): string {
  return `stage ${name} : delay;`;
}

/** A queue's NIC: its bandwidth in tokens a second, shared by its copies. */
export function nic(): string {
  return "nic ps(2e5);  // NIXL bandwidth, tokens/s";
}

/** An engine's connector to the queue its KV comes from: each request read
 * from it loads what it lacks (llmd_nixl_pull.sq's decoder). */
export function connector(source: string): string {
  return `connector ${source} { load (request.preempted ? 0 : request.input - request.hit); }`;
}

/** A KV copy over NIXL between two queues' NICs: the reader starts each
 * read (pull) or the source posts each write (push). */
export function relation(mode: "pull" | "push", source: string, reader: string): string {
  return `kvt.nixl_${mode} (${source}, ${reader}, share = share.maxmin);`;
}

/** A pool in a queue: a request queue on the engine's slots, or KV blocks on the device. */
export function pool(name: string, on: string, kind: "slots" | "blocks"): string {
  return kind === "slots" ? `pool ${name} on ${on} { queue fifo; }` : `pool ${name} on ${on} { block 16; evict lru; }`;
}

/** A copy of queue `text` (named `from`) named `to`: its name where it names itself. */
export function rename(text: string, from: string, to: string): string {
  // a queue's name is a word: `[A-Za-z_]\w*`, nothing to escape
  return text.replace(new RegExp("\\b" + from + "\\b", "g"), to);
}
