// The text the figure's palette writes: what a person would type, in the
// style of serQ's examples (vllm.sq's engine, llmd_nixl_pull.sq's queues
// and relation). The constants are placeholders to edit; serQ checks the
// result like any other text.

/** `NAME`, or `NAME[N]` for a pool of `N` instances (a family, as
 * llmd_nixl_pull.sq's `queue P[NP]`): each member its own device, engine
 * and pools, a call choosing one. */
const head = (name: string, count?: number) => (count === undefined ? name : `${name}[${count}]`);

/** An engine's role: a prefiller computes the prompt and leases the KV for
 * a reader; a decoder prefills locally and decodes the request's hidden
 * `output` tokens (the server's hidden parameter, `o` where it has none). */
export type Role = "prefill" | "decode";

/** A queue that prefills or decodes: device, engine, its request slots and KV, and its role's entry. */
export function engine(role: Role, name: string, count?: number, output = "o"): string {
  return `queue ${head(name, count)} : ${role} {
  device gpu { compute (t) = t * 2e-5; hbm (k) = 2e-4 + 2e-9 * k; kv cap 160000; }
  engine on gpu {
    reqs cap ${role === "prefill" ? 16 : 64};
    tokens cap 8192;
${indent(scheduler(role), "    ")}
    worker { forward (max(hbm(batch.kv_decode + batch.kv_prefill), compute(batch.tokens))); }
  }
  pool reqs on ${name} { queue fifo; }
  pool kv on gpu { block 16; evict lru; preempt lifo; }
${indent(entry(role, name, output), "  ")}
}`;
}

export const prefill = (name: string, count?: number) => engine("prefill", name, count);
export const decode = (name: string, count?: number, output = "o") => engine("decode", name, count, output);

/** A role's scheduler: a decoder takes its slots and KV as it admits; a prefiller's entry holds them. */
export function scheduler(role: Role): string {
  return role === "prefill"
    ? "scheduler { advance running; admit waiting while (running.preempted == 0); }"
    : `scheduler {
  advance running;
  admit waiting while (running.preempted == 0) taking reqs (1), kv (request.known) reserve (request.known);
}`;
}

/** A role's entry in queue `name`; a decoder's generates `output` tokens. */
export function entry(role: Role, name: string, output = "o"): string {
  return role === "prefill"
    ? `prefill (prompt) {
  hold reqs (cost(reqs, 1)), kv (cost(kv, prompt)) {
    run ${name} prefill (cost(${name}, prompt)) growing kv;
  } lease kv (inf);
}`
    : `decode (prompt) {
  ${name} (prompt, ${output});
}`;
}

const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((l) => by + l)
    .join("\n");

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

/** A capacity of a device or an engine, which a pool of that name is sized by. */
export function capacity(name: string, cap: string): string {
  return `${name} cap ${cap};`;
}

/** A copy of queue `text` (named `from`) named `to`: its name where it names itself. */
export function rename(text: string, from: string, to: string): string {
  // a queue's name is a word: `[A-Za-z_]\w*`, nothing to escape
  return text.replace(new RegExp("\\b" + from + "\\b", "g"), to);
}
