// The figure's edits on serQ's examples: each must leave text serQ links
// and draws with the station the edit meant. Run by scripts/check-edits.sh
// (esbuild bundles this file for Node, with serQ's wasm).

import { readFileSync } from "node:fs";
import { apply, connect, copy, fresh, remove, resize, toggle, type Draft, type Edit } from "../web/src/edit";
import { outline as read, type Outline } from "../web/src/outline";
import * as snip from "../web/src/snippets";
// @ts-ignore: wasm-bindgen's generated module
import { draw, initSync, ir, outline } from "../web/src/wasm/serq_wasm.js";

initSync({ module: readFileSync(new URL("../web/src/wasm/serq_wasm_bg.wasm", import.meta.url)) });

const example = (name: string) => readFileSync(new URL(`../web/src/examples/${name}.sq`, import.meta.url), "utf8");
const ol = (src: string): Outline => read(outline(src), src);
let failed = 0;

function check(name: string, src: string, edits: Edit[] | string, expect: { stages?: string[]; text?: string[]; refused?: RegExp }) {
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
    if (!svg.includes(`data-stage="${s}"`)) {
      failed++;
      console.log(`FAIL ${name}: no station ${s} in the figure`);
      return console.log(diff(src, out));
    }
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
  return { kind: "queue", name, role, family: null, text: role === "prefill" ? snip.prefill(name) : snip.decode(name), relations: [] };
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
  const at = src.lastIndexOf("  server {");
  check("vllm: an engine nothing reaches", src, [{ at: [at, at], text: snip.decode("E") + "\n" }], { refused: /run by no statement/ });
}

// a pool of engines (a family, `queue D[3]`): placed by an arrow, its call chooses a member
{
  const pool = (src: string, role: "prefill" | "decode", stem: string, n: number): Draft => {
    const name = fresh(src, stem);
    return { kind: "queue", name, role, family: String(n), text: role === "prefill" ? snip.prefill(name, n) : snip.decode(name, n), relations: [] };
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

console.log(failed ? `${failed} FAILED` : "all edits ok");
process.exit(failed ? 1 : 0);
