// The figure's edits on serQ's examples: each must leave text serQ links
// and draws with the station the edit meant. Run by scripts/check-edits.sh
// (esbuild bundles this file for Node, with serQ's wasm).

import { readFileSync } from "node:fs";
import { apply, connect, copy, declarePool, fresh, instance, remove, resize, retype, toggle, type Draft, type Edit } from "../web/src/edit";
import { outline as read, outputParam, type Outline } from "../web/src/outline";
import * as snip from "../web/src/snippets";
// @ts-ignore: wasm-bindgen's generated module
import { draw, initSync, ir, outline } from "../web/src/wasm/serq_wasm.js";

initSync({ module: readFileSync(new URL("../web/src/wasm/serq_wasm_bg.wasm", import.meta.url)) });

const example = (name: string) => readFileSync(new URL(`../web/src/examples/${name}.sq`, import.meta.url), "utf8");
const ol = (src: string): Outline => read(outline(src), src);
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
    ir(out);
    svg = draw(out);
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

const queueDraft = (src: string, role: "prefill" | "decode", stem: string): Draft => {
  const name = fresh(src, stem);
  return { kind: "queue", name, role, family: null, text: role === "prefill" ? snip.prefill(name) : snip.decode(name, undefined, outputParam(ol(src)) ?? undefined), relations: [] };
};

// vllm.sq: one engine, no queue; a decoder put before it from the arrival
{
  const src = example("vllm");
  check("vllm: arrival → new decoder", src, connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: queueDraft(src, "decode", "E") }), { stages: ["E", "vllm"] });
  check("vllm: arrival → new delay", src, connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: { kind: "stage", name: "hop", text: snip.delay("hop") } }), { stages: ["hop", "vllm"] });
}

// a queue no arrow reaches is not a program (serQ #617): why the palette keeps a draft
{
  const src = example("vllm");
  const at = src.lastIndexOf("  server ");
  check("vllm: an engine nothing reaches", src, [{ at: [at, at], text: snip.decode("E", undefined, outputParam(ol(src)) ?? undefined) + "\n" }], { refused: /run by no statement/ });
}

// a pool of engines (a family, `queue D[3]`): placed by an arrow, its call chooses a member
{
  const pool = (src: string, role: "prefill" | "decode", stem: string, n: number): Draft => {
    const name = fresh(src, stem);
    return { kind: "queue", name, role, family: String(n), text: role === "prefill" ? snip.prefill(name, n) : snip.decode(name, n, outputParam(ol(src)) ?? undefined), relations: [] };
  };
  let src = example("vllm");
  const e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: pool(src, "decode", "E", 3) });
  check("vllm: arrival → a pool of 3 decoders", src, e, { stages: ["E", "vllm"], text: ["queue E[3] : decode", " in 3 by (work(E[", "].decode ("] });
  if (typeof e !== "string") {
    src = apply(src, e);
    check("vllm: the pool grows to 4", src, resize(src, ol(src), "E", 1), { stages: ["E"], text: ["queue E[4] : decode"] });
  }
  const l = example("llmd_nixl_pull");
  check("llmd: P → a pool of 2 prefillers", l, connect(l, ol(l), { kind: "station", stage: "P" }, { kind: "draft", draft: pool(l, "prefill", "Q", 2) }), { stages: ["Q", "P", "D"], text: ["queue Q[2] : prefill"] });
}

// llmd_nixl_pull.sq
{
  const src = example("llmd_nixl_pull");
  const o = ol(src);
  check("llmd: P → new decoder", src, connect(src, o, { kind: "station", stage: "P" }, { kind: "draft", draft: queueDraft(src, "decode", "E") }), { stages: ["E", "P", "D"] });
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
  const e = connect(v, ol(v), { kind: "arrival" }, { kind: "draft", draft: queueDraft(v, "decode", "D") });
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
  }
}

// built up from nothing but the palette: a prefiller, a decoder after it, the copy between them
{
  let src = example("vllm");
  const P = queueDraft(src, "prefill", "P");
  let e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: P });
  check("palette: arrival → prefiller", src, e, { stages: ["P"] });
  if (typeof e !== "string") src = apply(src, e);
  const D = queueDraft(src, "decode", "D");
  e = connect(src, ol(src), { kind: "station", stage: "P" }, { kind: "draft", draft: D });
  check("palette: prefiller → decoder", src, e, { stages: ["P", "D"] });
  if (typeof e !== "string") src = apply(src, e);
  e = connect(src, ol(src), { kind: "station", stage: "D" }, { kind: "draft", draft: { kind: "nic", queue: "P" } });
  check("palette: P's NIC → D, a pull", src, e, { stages: ["P", "D", "P.nic", "D.nic"], text: ["kvt.nixl_pull (P, D", "from P"] });
  if (typeof e !== "string") {
    src = apply(src, e);
    const o = ol(src);
    check("palette: the pull made a push", src, toggle(src, o, o.relations[0]), { stages: ["P.nic", "D.nic"], text: ["kvt.nixl_push (P, D"] });
  }
}

// an engine clicked takes the other role: its head, scheduler, entry and calls; one in a KV copy is left to the text
{
  let src = example("vllm");
  const e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: queueDraft(src, "decode", "E") });
  if (typeof e !== "string") src = apply(src, e);
  const p = retype(src, ol(src), "E", "prefill");
  check("roles: decoder E made a prefiller", src, p, { stages: ["E", "vllm"], text: ["queue E : prefill", "lease kv (inf)", "E.prefill ("] });
  if (typeof p !== "string") {
    const back = apply(src, p);
    check("roles: and back to a decoder", back, retype(back, ol(back), "E", "decode"), { stages: ["E"], text: ["queue E : decode", "E (prompt, output);", "E.decode ("] });
    const again = apply(back, retype(back, ol(back), "E", "decode") as Edit[]);
    if (again !== src) {
      failed++;
      console.log("FAIL roles: there and back is not the text it started from");
      console.log(diff(src, again));
    } else console.log("ok   roles: there and back is the same text");
  }
  let f = example("vllm");
  const pool = connect(f, ol(f), { kind: "arrival" }, { kind: "draft", draft: { kind: "queue", name: "E", role: "decode", family: "3", text: snip.decode("E", 3, outputParam(ol(f)) ?? undefined), relations: [] } });
  if (typeof pool !== "string") f = apply(f, pool);
  check("roles: a pool of 3 decoders made prefillers", f, retype(f, ol(f), "E", "prefill"), { stages: ["E"], text: ["queue E[3] : prefill", "].prefill ("] });
  const l = example("llmd_nixl_pull");
  check("roles: a prefiller in a KV copy", l, retype(l, ol(l), "P", "decode"), { refused: /KV copy/ });
}

// the palette's KV copy arrows, drawn from one station to another: a pull, and a push with the source's call a leg of its own
{
  let src = example("vllm");
  const P = queueDraft(src, "prefill", "P");
  let e = connect(src, ol(src), { kind: "arrival" }, { kind: "draft", draft: P });
  if (typeof e !== "string") src = apply(src, e);
  const D = queueDraft(src, "decode", "D");
  e = connect(src, ol(src), { kind: "station", stage: "P" }, { kind: "draft", draft: D });
  if (typeof e !== "string") src = apply(src, e);
  check("arrows: KV copy P → D, a pull", src, copy(src, ol(src), "P", "D", "pull"), { stages: ["P.nic", "D.nic"], text: ["kvt.nixl_pull (P, D", "from P"] });
  check("arrows: KV copy P → D, a push", src, copy(src, ol(src), "P", "D", "push"), { stages: ["P.nic", "D.nic"], text: ["kvt.nixl_push (P, D", "fork { P"] });
}

console.log(failed ? `${failed} FAILED` : "all edits ok");
process.exit(failed ? 1 : 0);
