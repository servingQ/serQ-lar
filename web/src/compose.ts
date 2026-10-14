// Editing the deployment from the figure (docs/editor.md). The palette makes
// drafts; in Connect mode an arrow dragged from the arrival or a station to
// a station or a draft writes the call (and the draft's declaration) into
// the text; the inspector changes the station chosen in the figure. Every
// change is an edit of the text (edit.ts), which serQ then draws again.

import { apply as _apply, addPool, connect, copy, fresh, remove, resize, toggle, type Draft, type Edit, type From, type To } from "./edit";
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
  /** Whether a drag from a station draws an arrow (Connect) or moves the view. */
  connecting = false;
  private drafts: Draft[] = [];
  private chosen: string | null = null;
  private wire: SVGSVGElement;
  private line: SVGLineElement;
  private dragging: { from: From | null; nic?: Draft; x: number; y: number } | null = null;

  constructor(
    private host: Host,
    private view: HTMLElement,
    private tray: HTMLElement,
    private inspector: HTMLElement,
  ) {
    this.wire = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.wire.classList.add("wire");
    this.line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    this.wire.append(this.line);
    this.wire.style.display = "none";
    document.body.append(this.wire);
    tray.addEventListener("pointerdown", (e) => this.trayDown(e));
    inspector.addEventListener("click", (e) => this.inspectorClick(e));
    inspector.addEventListener("submit", (e) => this.inspectorSubmit(e));
  }

  // ------------------------------------------------------------ palette ----

  /** A draft of `kind`, beside the figure until an arrow reaches it. */
  add(kind: "prefill" | "decode" | "delay") {
    const name = this.freshName(kind === "prefill" ? "P" : kind === "decode" ? "D" : "hop");
    if (kind === "delay") this.drafts.push({ kind: "stage", name, text: snip.delay(name) });
    else this.drafts.push({ kind: "queue", name, role: kind, family: null, text: kind === "prefill" ? snip.prefill(name) : snip.decode(name), relations: [] });
    this.renderTray();
    this.connecting = true;
    this.onMode();
    this.host.say(`Draft ${name}: drag an arrow from the arrival or a station to it (Connect mode, or a handle in the Edit view).`);
  }

  onMode: () => void = () => {};

  private freshName(stem: string): string {
    const taken = this.host.text() + " " + this.drafts.map((d) => (d.kind === "nic" ? "" : d.name)).join(" ");
    return fresh(taken, stem);
  }

  private renderTray() {
    this.tray.innerHTML = "";
    this.drafts.forEach((d, i) => {
      const card = document.createElement("div");
      card.className = `draft ${d.kind}`;
      card.dataset.draft = String(i);
      const what = d.kind === "queue" ? `queue · ${d.role}` : d.kind === "stage" ? "delay stage" : `${d.queue}'s NIC`;
      const hint = d.kind === "nic" ? "drag to the queue that reads its KV" : "drop an arrow here";
      card.innerHTML = `<b>${d.kind === "nic" ? `${d.queue}.nic` : d.name}</b><span>${what}</span><small>${hint}</small><button class="x" title="Discard the draft" aria-label="Discard">×</button>`;
      this.tray.append(card);
    });
    this.tray.hidden = this.drafts.length === 0;
    this.onDrafts();
  }

  private trayDown(e: PointerEvent) {
    const card = (e.target as Element).closest<HTMLElement>(".draft");
    if (!card) return;
    const i = Number(card.dataset.draft);
    if ((e.target as Element).closest(".x")) {
      this.drafts.splice(i, 1);
      this.renderTray();
      return;
    }
    const d = this.drafts[i];
    // a NIC's card is where its copy starts: drag it to the reader
    if (d.kind === "nic") this.startDrag(e, null, d);
  }

  // ------------------------------------------------------------ arrows ----

  /** A press on the figure in Connect mode: an arrow starts if it is on the arrival or a station. */
  down(e: PointerEvent): boolean {
    if (!this.connecting) return false;
    const el = e.target as Element;
    const station = el.closest<SVGGElement>("g[data-stage]");
    const arrival = el.closest('path[data-role="arrival"]') ?? (el.closest("text")?.textContent?.includes("sessions") ? el : null);
    if (station) this.startDrag(e, { kind: "station", stage: station.dataset.stage! });
    else if (arrival) this.startDrag(e, { kind: "arrival" });
    else return false;
    return true;
  }

  private startDrag(e: PointerEvent, from: From | null, nic?: Draft) {
    e.preventDefault();
    e.stopPropagation();
    this.dragging = { from, nic, x: e.clientX, y: e.clientY };
    this.wire.style.display = "block";
    this.drawWire(e.clientX, e.clientY);
    const move = (m: PointerEvent) => {
      this.drawWire(m.clientX, m.clientY);
      this.hover(m.clientX, m.clientY);
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.wire.style.display = "none";
      this.hover(-1, -1);
      this.drop(u.clientX, u.clientY);
      this.dragging = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private drawWire(x: number, y: number) {
    const d = this.dragging!;
    this.line.setAttribute("x1", String(d.x));
    this.line.setAttribute("y1", String(d.y));
    this.line.setAttribute("x2", String(x));
    this.line.setAttribute("y2", String(y));
  }

  /** What is under a point that an arrow can end at. */
  private target(x: number, y: number): To | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const card = el.closest<HTMLElement>(".draft");
    if (card) {
      const d = this.drafts[Number(card.dataset.draft)];
      return d && d.kind !== "nic" ? { kind: "draft", draft: d } : null;
    }
    const g = el.closest<SVGGElement>("g[data-stage]");
    return g && this.view.contains(g) ? { kind: "station", stage: g.dataset.stage! } : null;
  }

  private lit: Element | null = null;
  private hover(x: number, y: number) {
    this.lit?.classList.remove("drop");
    this.lit = null;
    if (x < 0) return;
    const el = document.elementFromPoint(x, y);
    const t = el?.closest(".draft, g[data-stage]") ?? null;
    if (t) t.classList.add("drop");
    this.lit = t;
  }

  private drop(x: number, y: number) {
    const d = this.dragging;
    const to = this.target(x, y);
    if (d && to) this.link(d.from, to, d.nic);
  }

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
    this.renderTray();
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

  /** Discard a draft. */
  discard(d: Draft) {
    this.drafts = this.drafts.filter((x) => x !== d);
    this.renderTray();
  }

  /** The drafts, in the palette's order. */
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
    parts.push(
      `<form class="group pool"><input name="name" placeholder="pool name" size="8" aria-label="Pool name" required pattern="[A-Za-z_][A-Za-z0-9_]*"><select name="kind" aria-label="Pool kind"><option value="slots">request slots</option><option value="blocks">KV blocks</option></select><button>+ Pool</button></form>`,
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
        this.drafts.push({ kind: "nic", queue: q.name });
        this.renderTray();
        return this.host.say(`Draft ${q.name}.nic: drag its card to the queue that reads the KV from ${q.name}.`);
      case "dup": {
        const name = this.freshName(q.name);
        const text = snip.rename(src.slice(q.range[0], q.range[1]), q.name, name);
        const relations = ol.relations.filter((r) => r.reader === q.name).map((r) => snip.rename(src.slice(r.range[0], r.range[1]), r.reader, name));
        this.drafts.push({ kind: "queue", name, role: q.roles[0], family: q.family, text, relations });
        this.renderTray();
        this.connecting = true;
        this.onMode();
        return this.host.say(`Draft ${name}, a copy of ${q.name}: drag an arrow to it to place it.`);
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
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get("name"));
    const kind = data.get("kind") === "blocks" ? "blocks" : "slots";
    const device = it.q.members.find((m) => m.kind === "device")?.name;
    const on = kind === "slots" ? it.q.name : device ?? it.q.name;
    const edits = addPool(this.host.text(), it.ol, it.q.name, snip.pool(name, on, kind));
    if (typeof edits === "string") return this.host.say(edits, true);
    this.host.apply(edits);
    this.host.say(`pool ${name} on ${on}: written into ${it.q.name}. A pool shows in the figure once a hold takes it.`);
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
