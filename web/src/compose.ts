// Editing the deployment from the Flow view (docs/editor.md). The palette
// makes drafts; an arrow drawn from the arrival or a station to a station or
// a draft writes the call (and the draft's declaration) into the text; an
// engine clicked takes a role, a KV copy clicked a mode. Every change is an
// edit of the text (edit.ts), which serQ then draws again.

import { apply as _apply, connect, copy, declarePool, engineRole, fresh, instance, remove, retype, route, toggle, type Draft, type Edit, type From, type To } from "./edit";
import { outputParam, type Outline } from "./outline";
import * as snip from "./snippets";
import type { Role } from "./snippets";

export interface Host {
  /** The text as it is now. */
  text(): string;
  /** serQ's outline of it, or null while it does not parse. */
  outline(): Outline | null;
  /** Make the edits, as one step to undo. */
  apply(edits: Edit[]): void;
  /** A line for the viewer: what was done, or why it was not. */
  say(message: string, bad?: boolean): void;
}

export class Compose {
  private drafts: Draft[] = [];
  constructor(private host: Host) {}

  // ------------------------------------------------------------ palette ----

  /** A draft of `kind`, beside the deployment until an arrow reaches it: an
   * engine starts an aggregated one (it prefills and decodes), and takes
   * another role clicked. */
  add(kind: "engine" | "delay"): Draft {
    const name = this.freshName(kind === "engine" ? STEM.agg : "hop");
    const d: Draft = kind === "delay" ? { kind: "stage", name, text: snip.delay(name) } : { kind: "queue", name, role: "agg", family: null, text: snip.agg(name, undefined, this.output()), relations: [] };
    this.drafts.push(d);
    this.onDrafts();
    return d;
  }

  /** What an aggregated draft generates: the server's hidden parameter. */
  private output(): string | undefined {
    return outputParam(this.host.outline()) ?? undefined;
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

  /** A KV copy from station `from`'s queue to station `to`'s, a pull or a
   * push (edit.ts `copy`): the NICs, the connector and the relation written. */
  copyKv(from: string, to: string, mode: "pull" | "push") {
    const ol = this.host.outline();
    if (!ol) return this.host.say("serQ cannot read the text as it is: fix it first.", true);
    const queue = (stage: string) => stage.replace(/\.nic$/, "").replace(/\[.*\]$/, "");
    const [source, reader] = [queue(from), queue(to)];
    if (source === reader) return this.host.say("A KV copy joins two queues.", true);
    const edits = copy(this.host.text(), ol, source, reader, mode);
    if (typeof edits === "string") return this.host.say(edits, true);
    this.host.apply(edits);
    this.host.say(`A KV copy from ${source} to ${reader}, ${mode === "pull" ? "pulled by the reader" : "pushed by the source"}: written into the text. Ctrl+Z undoes it.`);
  }

  /** Remove the queue a station is, with its calls and copies. */
  removeStation(stage: string) {
    const ol = this.host.outline();
    const name = stage.replace(/\.nic$/, "");
    if (!ol || !ol.queues.some((q) => q.name === name)) return this.host.say(`\`${stage}\` is no queue: remove it in the text.`, true);
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
        `; how many is written in the text, \`queue ${name}[1]\`. Ctrl+Z undoes it.`,
    );
  }

  /** Route a station's calls through the router (edit.ts `route`): each chooses a member of its queue. */
  routeTo(stage: string) {
    const ol = this.host.outline();
    if (!ol) return this.host.say("serQ cannot read the text as it is: fix it first.", true);
    const name = stage.replace(/\.nic$/, "");
    const edits = route(this.host.text(), ol, name);
    if (typeof edits === "string") return this.host.say(edits, true);
    this.host.apply(edits);
    this.host.say(`The router chooses a member of ${name} for each call to it, by the least work; click the router to change how. Ctrl+Z undoes it.`);
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

  /** A draft renamed, before it is drawn again. */
  onRename: (from: string, to: string) => void = () => {};

  // ------------------------------------------------------------ roles ----

  /** The engine role a station's queue or a draft engine plays (agg, prefill or decode), if any. */
  roleOf(at: string | Draft): Role | null {
    if (typeof at !== "string") return at.kind === "queue" ? (at.role as Role) : null;
    const q = this.host.outline()?.queues.find((q) => q.name === queueName(at));
    return q ? engineRole(q) : null;
  }

  /** Make a station's queue, or a draft engine, an aggregated engine, a prefiller or a decoder (edit.ts `retype`). */
  setRole(at: string | Draft, role: Role) {
    if (typeof at !== "string") {
      if (at.kind !== "queue" || at.role === role) return;
      if (role === "decode") return this.host.say("A decoder reads the KV a prefiller leased: place this engine, then drag a KV copy to it from a prefiller.", true);
      // not written yet: named after its role, as the palette names one
      const i = this.drafts.indexOf(at);
      const name = this.freshName(STEM[role]);
      this.drafts[i] = { ...at, name, role, text: snip.engine(role, name, at.family === null ? undefined : Number(at.family), this.output()) };
      // where it was dropped, under its new name
      this.onRename(at.name, name);
      return this.onDrafts();
    }
    const ol = this.host.outline();
    if (!ol) return this.host.say("serQ cannot read the text as it is: fix it first.", true);
    const q = queueName(at);
    const edits = retype(this.host.text(), ol, q, role);
    if (typeof edits === "string") return this.host.say(edits, true);
    if (!edits.length) return;
    this.host.apply(edits);
    this.host.say(
      role === "decode"
        ? `${q} is now a decoder: it reads its KV from the prefiller, copied over NIXL. Ctrl+Z undoes it.`
        : `${q} is now ${role === "prefill" ? "a prefiller" : "an aggregated engine"}: its role, scheduler, entry and calls rewritten. Ctrl+Z undoes it.`,
    );
  }

  /** Make the KV copy between two stations' queues a pull or a push (edit.ts `toggle`). */
  setMode(from: string, to: string, mode: "pull" | "push") {
    const ol = this.host.outline();
    if (!ol) return this.host.say("serQ cannot read the text as it is: fix it first.", true);
    const [a, b] = [queueName(from), queueName(to)];
    const r = ol.relations.find((r) => (r.source === a && r.reader === b) || (r.source === b && r.reader === a));
    if (!r) return this.host.say(`No KV copy between ${a} and ${b} is written as a relation: change it in the text.`, true);
    if (r.mode === mode) return;
    this.host.apply(toggle(this.host.text(), ol, r));
    this.host.say(`The copy ${r.source} → ${r.reader} is now a ${mode === "push" ? "push: the source posts each write" : "pull: the reader starts each read"}. Ctrl+Z undoes it.`);
  }
}

/** What an engine of a role is named after: `E` as serQ's aggregated replicas, `P` and `D` as its P/D queues. */
const STEM: Record<Role, string> = { agg: "E", prefill: "P", decode: "D" };

/** The queue a station is: `P` for `P`, `P.nic` and `P[1]`. */
const queueName = (stage: string) => stage.replace(/\.nic$/, "").replace(/\[.*\]$/, "");

export { _apply as applyEdits };
