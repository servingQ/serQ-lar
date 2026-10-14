// The figure's edits on serQ's examples: each must leave text serQ links
// and draws with the station the edit meant. Run by scripts/check-edits.sh
// (esbuild bundles this file for Node, with serQ's wasm).

import { readdirSync, readFileSync } from "node:fs";
import { apply, connect, copy, declarePool, fresh, instance, remove, resize, retype, route, toggle, type Draft, type Edit } from "../web/src/edit";
import { outline as read, outputParam, type Outline } from "../web/src/outline";
import * as snip from "../web/src/snippets";
// @ts-ignore: wasm-bindgen's generated module
import { draw, initSync, ir, outline } from "../web/src/wasm/serq_wasm.js";

initSync({ module: readFileSync(new URL("../web/src/wasm/serq_wasm_bg.wasm", import.meta.url)) });

const example = (name: string) => readFileSync(new URL(`../web/src/examples/deployments/${name}.sq`, import.meta.url), "utf8");
const ol = (src: string): Outline => read(outline(src), src);

/** serQ's workloads: a deployment, edited, is checked under one its server's
 * signature takes, since an edit may change what a request carries. */
const workloadDir = `${process.env.SERQ_DIR}/examples/workloads`;
const workloadTexts = readdirSync(workloadDir)
  .filter((f) => f.endsWith(".sq"))
  .sort()
  .map((f) => readFileSync(`${workloadDir}/${f}`, "utf8"));
/** What a workload sends, by the server's parameters' names, and the reply it reads. */
const sends = (w: string) => (/\bsend \(([^;]*)\);/.exec(w)?.[1] ?? "").split(",").map((b) => b.split(":")[0].trim()).filter(Boolean);
const reads = (w: string) => [...w.matchAll(/\breply\.(\w+)/g)].map((m) => m[1]);
function workloadFor(src: string): string {
  const sig = ol(src).signature;
  const params = (sig?.params ?? []).map((p) => p.name).sort().join();
  const reply = sig?.reply ?? [];
  const w = workloadTexts.find((w) => sends(w).sort().join() === params && reads(w).every((r) => reply.includes(r)));
  if (w === undefined) throw new Error(`no serQ workload sends what the server takes: (${params})`);
  return w;
}
let failed = 0;

function check(name: string, src: string, edits: Edit[] | string, expect: { stages?: string[]; text?: string[]; refused?: RegExp; instances?: number }) {
  if (typeof edits === "string") {
    if (expect.refused?.test(edits)) return console.log(`ok   ${name}: refused as meant: ${edits}`);
    failed++;
    return console.log(`FAIL ${name}: the edit was refused: ${edits}`);
  }
  const out = apply(src, edits);
  for (const t of expect.text ?? []) {
    if (!out.includes(t)) {
      failed++;
      console.log(`FAIL ${name}: the text lacks ${JSON.stringify(t)}`);
      return console.log(diff(src, out));
    }
  }
  let svg: string;
  try {
    const workload = workloadFor(out);
    ir(out, workload);
    svg = draw(out, workload);
  } catch (e) {
    if (expect.refused?.test(String((e as Error).message ?? e))) return console.log(`ok   ${name}: serQ refused as meant`);
    failed++;
    console.log(`FAIL ${name}: serQ refused the result:\n${(e as Error).message ?? e}`);
    return console.log(diff(src, out));
  }
  for (const s of expect.stages ?? []) {
    // a stacked instance's station is named by its member: `P[0]` is `P`'s first
    if (!svg.includes(`data-stage="${s}"`) && !svg.includes(`data-stage="${s}[0]"`)) {
      failed++;
      console.log(`FAIL ${name}: no station ${s} in the figure`);
      return console.log(diff(src, out));
    }
  }
  const panels = (svg.match(/class="instance"/g) ?? []).length;
  if (expect.instances !== undefined && panels !== expect.instances) {
    failed++;
    console.log(`FAIL ${name}: ${panels} instance panels in the figure, not ${expect.instances}`);
    return console.log(diff(src, out));
  }
  console.log(`ok   ${name}`);
}

/** The lines that changed, for a failure. */
function diff(a: string, b: string): string {
  const x = a.split("\n");
  const y = b.split("\n");
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return y.slice(Math.max(0, i - 2), y.length - j + 2).map((l) => "  | " + l).join("\n");
}

const queueDraft = (src: string, role: snip.Own, stem: string): Draft => {
  const name = fresh(src, stem);
  return { kind: "queue", name, role, family: null, text: role === "prefill" ? snip.prefill(name) : snip.agg(name, undefined, outputParam(ol(src)) ?? undefined), relations: [] };
};

// vllm.sq: one engine, no queue; an aggregated engine put before it from the arrival
{
  const src = example("vllm");
  check("vllm: arrival → new aggregated engine", src, connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: queueDraft(src, "agg", "E") }), { stages: ["E", "vllm"] });
  check("vllm: arrival → new delay", src, connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: { kind: "stage", name: "hop", text: snip.delay("hop") } }), { stages: ["hop", "vllm"] });
}

// a queue no arrow reaches is not a program (serQ #617): why the palette keeps a draft
{
  const src = example("vllm");
  const at = src.lastIndexOf("  server ");
  check("vllm: an engine nothing reaches", src, [{ at: [at, at], text: snip.agg("E", undefined, outputParam(ol(src)) ?? undefined) + "\n" }], { refused: /run by no statement/ });
}

// a pool of engines (a family, `queue D[3]`): placed by an arrow, its call chooses a member
{
  const pool = (src: string, role: snip.Own, stem: string, n: number): Draft => {
    const name = fresh(src, stem);
    return { kind: "queue", name, role, family: String(n), text: role === "prefill" ? snip.prefill(name, n) : snip.agg(name, n, outputParam(ol(src)) ?? undefined), relations: [] };
  };
  let src = example("vllm");
  const e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: pool(src, "agg", "E", 3) });
  check("vllm: arrival → a pool of 3 aggregated engines", src, e, { stages: ["E", "vllm"], text: ["queue E[3] : agg", " in 3 by (work(E[", "].decode ("] });
  if (typeof e !== "string") {
    src = apply(src, e);
    check("vllm: the pool grows to 4", src, resize(src, ol(src), "E", 1), { stages: ["E"], text: ["queue E[4] : agg"] });
  }
  const l = example("llmd_nixl_pull");
  check("llmd: P → a pool of 2 prefillers", l, connect(l, ol(l), { kind: "station", stage: "P" }, { kind: "draft", draft: pool(l, "prefill", "Q", 2) }), { stages: ["Q", "P", "D"], text: ["queue Q[2] : prefill"] });
}

// llmd_nixl_pull.sq
{
  const src = example("llmd_nixl_pull");
  const o = ol(src);
  check("llmd: P → new aggregated engine", src, connect(src, o, { kind: "station", stage: "P" }, { kind: "draft", draft: queueDraft(src, "agg", "E") }), { stages: ["E", "P", "D"] });
  check("llmd: pull → push", src, toggle(src, o, o.relations[0]), { text: ["kvt.nixl_push (P, D"] });
  check("llmd: one more prefiller", src, resize(src, o, "P", 1), { text: ["let NP = 3;"] });
  check("llmd: one decoder fewer", src, resize(src, o, "D", -1), { text: ["let ND = 1;"] });
  check("llmd: remove D", src, remove(src, o, "D"), { refused: /D/ });
  check("llmd: D reads twice", src, copy(src, o, "P", "D", "push"), { refused: /one source/ });
}

// vllm_nixl_push.sq
{
  const src = readFileSync(`${process.env.SERQ_DIR}/examples/pd-disaggregation/vllm_nixl_push.sq`, "utf8");
  const o = ol(src);
  check("push: push → pull", src, toggle(src, o, o.relations[0]), { text: ["kvt.nixl_pull (P, D"] });
  // P and D are one queue each, with a NIC, in no instance: P made one, and D with it (the copy joins two families)
  check("push: P an instance, and D", src, instance(src, o, "P"), { stages: ["P", "P.nic", "D", "D.nic"], text: ["queue P[1] : prefill", "queue D[1] : decode", "fork { P[k].prefill (prompt); }", "from P[k];", "D[m].decode"], instances: 2 });
}

// a memory pool declared, with the capacity it is sized by; a second KV pool on one device is refused
{
  const l = example("llmd_nixl_pull");
  check("llmd: P's pool of waitq slots", l, declarePool(l, ol(l), "P", "waitq", "slots", "8"), { stages: ["P"], text: ["waitq cap 8;", "pool waitq on P { queue fifo; }"] });
  check("llmd: a second KV pool on P's device", l, declarePool(l, ol(l), "P", "kv2", "blocks", "1000"), { refused: /both on/ });
  check("llmd: a pool P has", l, declarePool(l, ol(l), "P", "kv", "blocks", "1000"), { refused: /already/ });
  const v = example("vllm");
  const e = connect(v, ol(v), { kind: "arrival" }, { kind: "draft", draft: queueDraft(v, "agg", "D") });
  if (typeof e !== "string") {
    const s = apply(v, e);
    check("palette: D's pool of waitq slots", s, declarePool(s, ol(s), "D", "waitq", "slots", "4"), { stages: ["D"], text: ["waitq cap 4;"] });
  }
}

// an instance refused: one already, no queue, a queue with no NIC
{
  const l = example("llmd_nixl_pull");
  check("llmd: D is an instance already", l, instance(l, ol(l), "D"), { refused: /already/ });
  const v = example("vllm");
  check("vllm: the engine is no queue", v, instance(v, ol(v), "vllm"), { refused: /no queue/ });
  let src = v;
  const e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: queueDraft(src, "prefill", "P") });
  if (typeof e !== "string") {
    src = apply(src, e);
    check("palette: P without a NIC", src, instance(src, ol(src), "P"), { refused: /no NIC/ });
    // the router dropped on it: no NIC wanted, P a family of one its call chooses from
    check("router: P a family of one", src, route(src, ol(src), "P"), { stages: ["P"], text: ["in 1 by (work(P["] });
  }
  check("router: llmd's D is routed already", l, route(l, ol(l), "D"), { refused: /chooses its member already/ });
  // a pool of engines the palette makes: its call chooses a member already
  const E = fresh(v, "E");
  const d: Draft = { kind: "queue", name: E, role: "decode", family: "3", text: snip.decode(E, 3, outputParam(ol(v)) ?? undefined), relations: [] };
  const f = connect(v, ol(v), { kind: "arrival" }, { kind: "draft", draft: d });
  if (typeof f !== "string") {
    const s = apply(v, f);
    check("router: the palette's pool is routed already", s, route(s, ol(s), E), { refused: /already/ });
  }
}

// built up from nothing but the palette: a prefiller, an aggregated engine after it, the copy between them making it a decoder
{
  let src = example("vllm");
  const P = queueDraft(src, "prefill", "P");
  let e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: P });
  check("palette: arrival → prefiller", src, e, { stages: ["P"] });
  if (typeof e !== "string") src = apply(src, e);
  const D = queueDraft(src, "agg", "D");
  e = connect(src, ol(src), { kind: "station", stage: "P" }, { kind: "draft", draft: D });
  check("palette: prefiller → aggregated engine", src, e, { stages: ["P", "D"] });
  if (typeof e !== "string") src = apply(src, e);
  e = connect(src, ol(src), { kind: "station", stage: "D" }, { kind: "draft", draft: { kind: "nic", queue: "P" } });
  check("palette: P's NIC → D, a pull", src, e, { stages: ["P", "D", "P.nic", "D.nic"], text: ["kvt.nixl_pull (P, D", "queue D : decode", "decode (prompt) from P {", "from P;"] });
  if (typeof e !== "string") {
    src = apply(src, e);
    const o = ol(src);
    check("palette: the pull made a push", src, toggle(src, o, o.relations[0]), { stages: ["P.nic", "D.nic"], text: ["kvt.nixl_push (P, D"] });
  }
}

// an engine clicked takes the other role: its head, scheduler, entry and calls; one in a KV copy is left to the text
{
  let src = example("vllm");
  const e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: queueDraft(src, "agg", "E") });
  if (typeof e !== "string") src = apply(src, e);
  const p = retype(src, ol(src), "E", "prefill");
  check("roles: aggregated E made a prefiller", src, p, { stages: ["E", "vllm"], text: ["queue E : prefill", "lease kv (inf)", "E.prefill ("] });
  if (typeof p !== "string") {
    const back = apply(src, p);
    check("roles: and back to aggregated", back, retype(back, ol(back), "E", "agg"), { stages: ["E"], text: ["queue E : agg", "E (prompt, output);", "E.decode ("] });
    const again = apply(back, retype(back, ol(back), "E", "agg") as Edit[]);
    if (again !== src) {
      failed++;
      console.log("FAIL roles: there and back is not the text it started from");
      console.log(diff(src, again));
    } else console.log("ok   roles: there and back is the same text");
  }
  let f = example("vllm");
  const pool = connect(f, ol(f), { kind: "arrival" }, { kind: "draft", draft: { kind: "queue", name: "E", role: "agg", family: "3", text: snip.agg("E", 3, outputParam(ol(f)) ?? undefined), relations: [] } });
  if (typeof pool !== "string") f = apply(f, pool);
  check("roles: a pool of 3 aggregated engines made prefillers", f, retype(f, ol(f), "E", "prefill"), { stages: ["E"], text: ["queue E[3] : prefill", "].prefill ("] });
  const l = example("llmd_nixl_pull");
  check("roles: a prefiller in a KV copy", l, retype(l, ol(l), "P", "decode"), { refused: /KV copy/ });
  check("roles: llm-d's pod (agg, decode) reads its KV", l, retype(l, ol(l), "D", "agg"), { refused: /KV copy/ });
  // a decoder is the KV copy from the one prefiller there is; with none, nothing to read from
  check("roles: aggregated E made a decoder, no prefiller", src, retype(src, ol(src), "E", "decode"), { refused: /there is none/ });
  let pd = example("vllm");
  const e1 = connect(pd, ol(pd), { kind: "arrival" }, { kind: "draft", draft: queueDraft(pd, "prefill", "P") });
  if (typeof e1 !== "string") pd = apply(pd, e1);
  const e2 = connect(pd, ol(pd), { kind: "station", stage: "P" }, { kind: "draft", draft: queueDraft(pd, "agg", "E") });
  if (typeof e2 !== "string") pd = apply(pd, e2);
  check("roles: aggregated E made a decoder of P's KV", pd, retype(pd, ol(pd), "E", "decode"), { stages: ["P", "E", "P.nic", "E.nic"], text: ["queue E : decode", "decode (prompt) from P {", "kvt.nixl_pull (P, E", "E.decode (input) from P;"] });
}

// the palette's KV copy arrows, drawn from one station to another: a pull, and a push with the source's call a leg of its own
{
  let src = example("vllm");
  const P = queueDraft(src, "prefill", "P");
  let e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: P });
  if (typeof e !== "string") src = apply(src, e);
  const D = queueDraft(src, "agg", "D");
  e = connect(src, ol(src), { kind: "station", stage: "P" }, { kind: "draft", draft: D });
  if (typeof e !== "string") src = apply(src, e);
  check("arrows: KV copy P → D, a pull", src, copy(src, ol(src), "P", "D", "pull"), { stages: ["P.nic", "D.nic"], text: ["kvt.nixl_pull (P, D", "from P"] });
  check("arrows: KV copy P → D, a push", src, copy(src, ol(src), "P", "D", "push"), { stages: ["P.nic", "D.nic"], text: ["kvt.nixl_push (P, D", "fork { P"] });
}

console.log(failed ? `${failed} FAILED` : "all edits ok");
process.exit(failed ? 1 : 0);
