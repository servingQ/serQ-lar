// Editing the deployment from the Flow view (docs/editor.md). The palette
// makes drafts; an arrow drawn from the arrival or a station to a station or
// a draft writes the call (and the draft's declaration) into the text; the
// inspector changes the station chosen. Every change is an edit of the text
// (edit.ts), which serQ then draws again.

import { apply as _apply, connect, copy, declarePool, fresh, instance, remove, resize, toggle, type Draft, type Edit, type From, type To } from "./edit";
import type { Outline, Queue } from "./outline";
import * as snip from "./snippets";

export interface Host {
  /** The text as it is now. */
  text(): string;
  /** serQ's outline of it, or null while it does not parse. */
  outline(): Outline | null;
  /** Make the edits, as one step to undo. */
  apply(edits: Edit[]): void;
  /** Put the caret on a range of the text. */
  reveal(at: [number, number]): void;
  /** A line for the viewer: what was done, or why it was not. */
  say(message: string, bad?: boolean): void;
}

export class Compose {
  private drafts: Draft[] = [];
  private chosen: string | null = null;

  constructor(
    private host: Host,
    private inspector: HTMLElement,
  ) {
    inspector.addEventListener("click", (e) => this.inspectorClick(e));
    inspector.addEventListener("submit", (e) => this.inspectorSubmit(e));
  }

  // ------------------------------------------------------------ palette ----

  /** A draft of `kind`, beside the deployment until an arrow reaches it. */
  add(kind: "prefill" | "decode" | "delay"): Draft {
    const name = this.freshName(kind === "prefill" ? "P" : kind === "decode" ? "D" : "hop");
    const d: Draft =
      kind === "delay"
        ? { kind: "stage", name, text: snip.delay(name) }
        : { kind: "queue", name, role: kind, family: null, text: kind === "prefill" ? snip.prefill(name) : snip.decode(name), relations: [] };
    this.drafts.push(d);
    this.onDrafts();
    this.host.say(`Draft ${name}: draw an arrow from the arrival or a station to it.`);
    return d;
  }

  /** A pool of `count` engines playing `role`, a family (`queue D[3]`): a
   * draft like an engine; its call chooses a member (`choose k in 3 by
   * (work(D[k]))`), and its inspector steps its size. */
  addPool(role: "prefill" | "decode", count: number): Draft {
    const name = this.freshName(role === "prefill" ? "P" : "D");
    const n = Math.max(1, Math.round(count));
    const text = role === "prefill" ? snip.prefill(name, n) : snip.decode(name, n);
    const d: Draft = { kind: "queue", name, role, family: String(n), text, relations: [] };
    this.drafts.push(d);
    this.onDrafts();
    this.host.say(`Draft ${name}[${n}], a pool of ${n} ${role} engines: draw an arrow from the arrival or a station to it.`);
    return d;
  }

  private freshName(stem: string): string {
    const taken = this.host.text() + " " + this.drafts.map((d) => (d.kind === "nic" ? "" : d.name)).join(" ");
    return fresh(taken, stem);
  }

  // ------------------------------------------------------------ arrows ----

  /** An arrow from `from`, or from a NIC draft `nic` to the queue that reads
   * its KV, to `to`: written into the text. Whether it was; why not is said. */
  link(from: From | null, to: To, nic?: Draft): boolean {
    const ol = this.host.outline();
    if (!ol) {
      this.host.say("serQ cannot read the text as it is: fix it first.", true);
      return false;
    }
    const src = this.host.text();
    let edits: Edit[] | string;
    if (nic && nic.kind === "nic") {
      if (to.kind !== "station") return false;
      const reader = to.stage.replace(/\.nic$/, "");
      edits = copy(src, ol, nic.queue, reader, "pull");
      if (typeof edits !== "string") this.drafts = this.drafts.filter((x) => x !== nic);
    } else if (from) {
      edits = connect(src, ol, from, to);
      if (typeof edits !== "string" && to.kind === "draft") this.drafts = this.drafts.filter((x) => x !== to.draft);
    } else return false;
    if (typeof edits === "string") {
      this.host.say(edits, true);
      return false;
    }
    this.host.apply(edits);
    this.onDrafts();
    const what = to.kind === "draft" ? (to.draft.kind === "nic" ? "" : to.draft.name) : to.stage;
    this.host.say(nic && nic.kind === "nic" ? `A KV copy from ${nic.queue} to ${what}, pulled by the reader: written into the text.` : `An arrow to ${what}: written into the text. Ctrl+Z undoes it.`);
    return true;
  }

  /** Remove the queue a station is, with its calls and copies. */
  removeStation(stage: string) {
    const ol = this.host.outline();
    const name = stage.replace(/\.nic$/, "");
    if (!ol || !ol.queues.some((q) => q.name === name)) return this.host.say(`\`${stage}\` is no queue: remove it in the text.`, true);
    if (this.chosen === stage) this.chosen = null;
    this.host.apply(remove(this.host.text(), ol, name));
    this.host.say(`${name} removed, with its calls and copies; serQ says if anything else names it. Ctrl+Z undoes it.`);
  }

  /** Make a station's queue, engine and NIC, an instance (edit.ts `instance`). */
  makeInstance(stage: string) {
    const ol = this.host.outline();
    if (!ol) return this.host.say("serQ cannot read the text as it is: fix it first.", true);
    const name = stage.replace(/\.nic$/, "");
    const edits = instance(this.host.text(), ol, name);
    if (typeof edits === "string") return this.host.say(edits, true);
    const others = ol.relations.flatMap((r) => (r.source === name ? [r.reader] : r.reader === name ? [r.source] : [])).filter((x) => !ol.queues.find((q) => q.name === x)?.family);
    this.host.apply(edits);
    this.host.say(
      `${name} and ${name}.nic: an instance, ${name}[1], its calls choosing a member` +
        (others.length ? `; ${others.join(", ")} too, at the other end of its KV copy (serQ copies between two families)` : "") +
        `. + beside its instances makes more. Ctrl+Z undoes it.`,
    );
  }

  /** A draft NIC for a station's queue: placed by dragging it to the queue that reads its KV. */
  nicDraft(stage: string) {
    const name = stage.replace(/\.nic$/, "");
    if (!this.drafts.some((d) => d.kind === "nic" && d.queue === name)) this.drafts.push({ kind: "nic", queue: name });
    this.onDrafts();
    this.host.say(`Draft ${name}.nic: draw an arrow from it to the queue that reads the KV from ${name}.`);
  }

  /** Declare a memory pool in a station's queue, with its capacity: request slots on its engine, or KV blocks on its device. */
  declarePool(stage: string, name: string, kind: "slots" | "blocks", cap: string) {
    const ol = this.host.outline();
    if (!ol) return this.host.say("serQ cannot read the text as it is: fix it first.", true);
    const q = ol.queues.find((x) => x.name === stage.replace(/\.nic$/, ""));
    if (!q) return this.host.say(`\`${stage}\` is no queue: declare its pool in the text.`, true);
    const edits = declarePool(this.host.text(), ol, q.name, name, kind, cap);
    if (typeof edits === "string") return this.host.say(edits, true);
    this.host.apply(edits);
    this.host.say(
      `Memory pool ${q.name}.${name}: ${kind === "slots" ? `${cap} request slots on its engine` : `${cap} tokens of KV blocks on its device`}, declared; dashed in the Edit view until a hold takes it. Ctrl+Z undoes it.`,
    );
  }

  /** Discard a draft. */
  discard(d: Draft) {
    this.drafts = this.drafts.filter((x) => x !== d);
    this.onDrafts();
  }

  /** The drafts, in the order they were made. */
  get draftList(): readonly Draft[] {
    return this.drafts;
  }

  /** The drafts changed (one made, placed or discarded). */
  onDrafts: () => void = () => {};

  // ------------------------------------------------------------ inspector ----

  /** The station the viewer chose, or none. */
  choose(stage: string | null) {
    this.chosen = stage;
    this.renderInspector();
  }

  /** The text changed: the inspector reads it again. */
  refresh() {
    this.renderInspector();
  }

  private queue(): { q: Queue; ol: Outline } | null {
    const ol = this.host.outline();
    if (!ol || !this.chosen) return null;
    const name = this.chosen.replace(/\.nic$/, "");
    const q = ol.queues.find((x) => x.name === name);
    return q ? { q, ol } : null;
  }

  private renderInspector() {
    const it = this.queue();
    if (!this.chosen) {
      this.inspector.hidden = true;
      return;
    }
    this.inspector.hidden = false;
    if (!it) {
      this.inspector.innerHTML = `<b class="mono">${esc(this.chosen)}</b> <span class="dim">is not a queue: edit it in the text.</span>`;
      return;
    }
    const { q, ol } = it;
    const src = this.host.text();
    const parts: string[] = [];
    parts.push(`<b class="mono">queue ${esc(q.name)}${q.family ? `[${esc(q.family)}]` : ""}</b> <span class="dim">${esc(q.roles.join(", "))}</span>`);
    parts.push(`<button data-act="show">Show in text</button>`);
    if (q.family) parts.push(`<span class="group">instances <button data-act="less" aria-label="One instance fewer">−</button><span class="mono">${esc(familySize(src, ol, q))}</span><button data-act="more" aria-label="One instance more">+</button></span>`);
    for (const r of ol.relations.filter((r) => r.source === q.name || r.reader === q.name)) {
      parts.push(
        `<span class="group">KV copy ${esc(r.source)} → ${esc(r.reader)} <span class="seg"><button data-act="mode" data-rel="${ol.relations.indexOf(r)}" aria-pressed="${r.mode === "pull"}" title="The reader starts each read">pull</button><button data-act="mode" data-rel="${ol.relations.indexOf(r)}" aria-pressed="${r.mode === "push"}" title="The source posts each write">push</button></span></span>`,
      );
    }
    if (!q.members.some((m) => m.kind === "nic")) parts.push(`<button data-act="nic" title="A NIC for a KV copy out of this queue">+ NIC</button>`);
    if (!q.family && q.members.some((m) => m.kind === "engine")) parts.push(`<button data-act="instance" title="Bundle the engine and its NIC as an instance: the queue a family its calls choose a member of">⊞ Make instance</button>`);
    parts.push(
      `<form class="group pool"><input name="name" placeholder="pool name" size="8" aria-label="Pool name" required pattern="[A-Za-z_][A-Za-z0-9_]*"><select name="kind" aria-label="Pool kind"><option value="slots">request slots</option><option value="blocks">KV blocks</option></select><input name="cap" value="16" size="5" aria-label="Capacity: slots, or tokens of KV" required><button title="A memory pool in this queue: request slots on its engine, or KV blocks on its device">+ Memory pool</button></form>`,
    );
    if (q.roles.some((r) => r === "prefill" || r === "decode")) parts.push(`<button data-act="dup" title="A draft copy of this queue, to place with an arrow">Duplicate</button>`);
    parts.push(`<button data-act="remove" class="danger">Remove</button>`);
    this.inspector.innerHTML = parts.join(" ");
  }

  private inspectorClick(e: MouseEvent) {
    const b = (e.target as Element).closest<HTMLButtonElement>("button[data-act]");
    const it = this.queue();
    if (!b || !it) return;
    const { q, ol } = it;
    const src = this.host.text();
    const act = b.dataset.act;
    const run = (edits: Edit[] | string, done: string) => {
      if (typeof edits === "string") return this.host.say(edits, true);
      this.host.apply(edits);
      this.host.say(done);
    };
    switch (act) {
      case "show":
        return this.host.reveal(q.range);
      case "less":
      case "more":
        return run(resize(src, ol, q.name, act === "more" ? 1 : -1), `${q.name}: one instance ${act === "more" ? "more" : "fewer"}.`);
      case "mode": {
        const r = ol.relations[Number(b.dataset.rel)];
        if ((b.textContent === "pull") === (r.mode === "pull")) return;
        return run(toggle(src, ol, r), `The copy ${r.source} → ${r.reader} is now a ${r.mode === "pull" ? "push: the source posts each write" : "pull: the reader starts each read"}.`);
      }
      case "nic":
        return this.nicDraft(q.name);
      case "instance":
        return this.makeInstance(q.name);
      case "dup": {
        const name = this.freshName(q.name);
        const text = snip.rename(src.slice(q.range[0], q.range[1]), q.name, name);
        const relations = ol.relations.filter((r) => r.reader === q.name).map((r) => snip.rename(src.slice(r.range[0], r.range[1]), r.reader, name));
        this.drafts.push({ kind: "queue", name, role: q.roles[0], family: q.family, text, relations });
        this.onDrafts();
        return this.host.say(`Draft ${name}, a copy of ${q.name}: draw an arrow to it to place it.`);
      }
      case "remove":
        this.chosen = null;
        return run(remove(src, ol, q.name), `${q.name} removed, with its calls and copies; serQ says below if anything else names it. Ctrl+Z undoes it.`);
    }
  }

  private inspectorSubmit(e: SubmitEvent) {
    e.preventDefault();
    const it = this.queue();
    if (!it) return;
    const data = new FormData(e.target as HTMLFormElement);
    this.declarePool(it.q.name, String(data.get("name")), data.get("kind") === "blocks" ? "blocks" : "slots", String(data.get("cap")).trim() || "16");
  }
}

/** A family's size as written: the `let`'s value, or the number. */
function familySize(src: string, ol: Outline, q: Queue): string {
  const f = q.family!.trim();
  if (/^\d+$/.test(f)) return f;
  const d = ol.decls.find((x) => x.kind === "let" && x.name === f);
  const m = d && /=\s*([^;]+);/.exec(src.slice(d.range[0], d.range[1]));
  return m ? `${f} = ${m[1].trim()}` : f;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export { _apply as applyEdits };
