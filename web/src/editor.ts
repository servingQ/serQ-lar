// The program's text, in CodeMirror: coloured by serQ's roles
// (`frontend::highlight`, the wasm's `tokens`), serQ's diagnostic
// underlined where it points, and an edit made from the figure one
// transaction, so that it undoes like typing. The editor reads no grammar
// of its own: the colours are what serQ's lexer cut, and the words it
// completes are serQ's vocabulary and the names serQ's lexer cut.

import { acceptCompletion, autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState, Prec, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import type { Edit } from "./edit";

/** serQ's roles left uncoloured: a program's own names, white space, and
 * what follows a lexical error (a string not closed yet). */
const PLAIN = new Set(["name", "space", "unlexed"]);
const marks = new Map<string, Decoration>();
const mark = (role: string) => {
  let m = marks.get(role);
  if (!m) marks.set(role, (m = Decoration.mark({ class: `tok-${role}` })));
  return m;
};

/** New colours, cut by serQ from the text as it is now. */
const recolour = StateEffect.define<DecorationSet>();
/** The colours: serQ's latest cut, moved along with the edits made since. */
const colours = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(recolour)) return e.value;
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", background: "var(--panel)", color: "var(--ink)" },
  ".cm-scroller": { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', lineHeight: "1.45" },
  // the gutter set off from the text, so that a line's number reads as its own
  ".cm-gutters": { background: "var(--bg)", color: "var(--dim)", borderRight: "1px solid var(--line)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px" },
  ".cm-activeLine": { background: "color-mix(in srgb, var(--line) 45%, transparent)" },
  ".cm-activeLineGutter": { background: "color-mix(in srgb, var(--line) 45%, transparent)", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { background: "color-mix(in srgb, var(--decode) 25%, transparent)" },
  ".cm-tooltip": { background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: "4px" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', maxHeight: "14em" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "color-mix(in srgb, var(--decode) 25%, transparent)", color: "inherit" },
  ".cm-completionDetail": { color: "var(--dim)", fontStyle: "normal", fontWeight: "normal", marginLeft: "1.5em", float: "right" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-flash": { background: "color-mix(in srgb, var(--busy) 30%, transparent)", transition: "background 1s" },
});

/** Where completion stays quiet: what serQ cut as a comment or a string. */
const QUIET = new Set(["tok-comment", "tok-string"]);

export class Editor {
  readonly view: EditorView;
  /** The words the language gives, from serQ (`vocabulary`). */
  private words: Completion[] = [];
  /** The program's own names, as serQ's latest cut found them. */
  private names: string[] = [];
  /** What a name is, where the outline says: `queue`, `pool`, … */
  private kinds = new Map<string, string>();

  /** The texts the editor holds and does not show, each with its own undo
   * history: a pair's other file (`show`). */
  private held = new Map<string, EditorState>();
  private shown = "program";
  private readonly extensions: Extension[];

  constructor(parent: HTMLElement, onChange: () => void) {
    this.extensions = [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          // a guide down each level of indentation, the caret's block brighter
          indentationMarkers({
            thickness: 1,
            activeThickness: 1,
            colors: {
              light: "color-mix(in srgb, var(--dim) 28%, transparent)",
              dark: "color-mix(in srgb, var(--dim) 28%, transparent)",
              activeLight: "color-mix(in srgb, var(--dim) 70%, transparent)",
              activeDark: "color-mix(in srgb, var(--dim) 70%, transparent)",
            },
          }),
          bracketMatching(),
          lintGutter(),
          colours,
          autocompletion({
            override: [(c) => this.complete(c)],
            optionClass: (c) => (c.type ? `tok-${c.type}` : ""),
            icons: false,
          }),
          // Tab takes the completion, as Enter does; with no list open it
          // indents (`indentWithTab` below).
          Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorState.tabSize.of(2),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange();
          }),
          EditorView.contentAttributes.of({ "aria-label": "serQ program", spellcheck: "false" }),
    ];
    this.view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions: this.extensions }) });
  }

  /** Which text the editor shows. */
  get showing(): string {
    return this.shown;
  }

  /** Start over with these texts, by name, showing the first: each its own
   * undo history. */
  load(texts: [string, string][]) {
    this.held.clear();
    for (const [key, doc] of texts) this.held.set(key, EditorState.create({ doc, extensions: this.extensions }));
    this.shown = "";
    this.show(texts[0][0]);
  }

  /** Show the text `key`, keeping the one shown as it is, history and all. */
  show(key: string) {
    if (key === this.shown) return;
    if (this.shown) this.held.set(this.shown, this.view.state);
    const next = this.held.get(key) ?? EditorState.create({ doc: "", extensions: this.extensions });
    this.held.delete(key);
    this.view.setState(next);
    this.shown = key;
  }

  /** A text the editor holds, shown or not. */
  textOf(key: string): string | null {
    if (key === this.shown) return this.text;
    return this.held.get(key)?.doc.toString() ?? null;
  }

  /** serQ's pieces of the text, `[role, text]` in order, whose texts make
   * the text up: coloured, unless the text has moved on since they were cut. */
  colour(pieces: [string, string][]) {
    const doc = this.view.state.doc;
    if (pieces.reduce((n, [, t]) => n + t.length, 0) !== doc.length) return;
    const b = new RangeSetBuilder<Decoration>();
    let at = 0;
    for (const [role, text] of pieces) {
      if (text.length && !PLAIN.has(role)) b.add(at, at + text.length, mark(role));
      at += text.length;
    }
    this.view.dispatch({ effects: recolour.of(b.finish()) });
    this.names = [...new Set(pieces.filter(([role, t]) => role === "name" && /^[A-Za-z_]/.test(t)).map(([, t]) => t))];
  }

  /** serQ's vocabulary, `[role, word]`: the words completion offers besides the program's names. */
  set vocabulary(words: [string, string][]) {
    this.words = words.map(([role, word]) => ({ label: word, type: role, detail: role }));
  }

  /** What the outline says each name is, shown beside it when completing. */
  set outlined(kinds: Map<string, string>) {
    this.kinds = kinds;
  }

  /** serQ's words and the program's names that start like the word before the caret. */
  private complete(c: CompletionContext): CompletionResult | null {
    const word = c.matchBefore(/~?[A-Za-z_][\w.]*|~/);
    if (!word && !c.explicit) return null;
    const from = word?.from ?? c.pos;
    let quiet = false;
    c.state.field(colours).between(Math.max(0, from - 1), from, (_a, _b, d) => {
      if (QUIET.has(d.spec.class)) quiet = true;
    });
    if (quiet) return null;
    const typed = word?.text ?? "";
    const words = new Set(this.words.map((w) => w.label));
    const names: Completion[] = this.names
      // the word being typed is in the cut too, unless it was typed since
      .filter((n) => n !== typed && !words.has(n))
      .map((n) => ({ label: n, detail: this.kinds.get(n) ?? "name", boost: 1 }));
    return { from, options: [...names, ...this.words], validFor: /^~?[\w.]*$/ };
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  /** A new program: the whole text, its undo history kept. */
  set text(s: string) {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: s }, selection: { anchor: 0 }, scrollIntoView: true });
  }

  /** Edits from the figure, as one step to undo; the view scrolls to the first. */
  apply(edits: Edit[]) {
    const changes = [...edits].sort((a, b) => a.at[0] - b.at[0]).map((e) => ({ from: e.at[0], to: e.at[1], insert: e.text }));
    // one transaction: its selection is a position in the text after the changes
    const set = this.view.state.changes(changes);
    const first = changes.length ? set.mapPos(changes[0].from, 1) : 0;
    this.view.dispatch({ changes: set, selection: { anchor: first }, scrollIntoView: true, userEvent: "input.figure" });
  }

  /** Undo, or redo, the text's last edit, wherever the focus is. */
  undo() {
    undo(this.view);
  }
  redo() {
    redo(this.view);
  }

  /** serQ's diagnostic (`LINE:COL: message` and a caret line), underlined where it points; `null` clears it. */
  diagnose(message: string | null) {
    const doc = this.view.state.doc;
    if (!message) {
      this.view.dispatch(setDiagnostics(this.view.state, []));
      return;
    }
    const at = position(message);
    if (!at || at.line > doc.lines) {
      this.view.dispatch(setDiagnostics(this.view.state, []));
      return;
    }
    const line = doc.line(at.line);
    const from = Math.min(line.from + at.col - 1, line.to);
    const to = Math.min(from + Math.max(1, at.len), line.to) || from;
    this.view.dispatch(setDiagnostics(this.view.state, [{ from, to: Math.max(to, from), severity: "error", message: message.split("\n")[0] }]));
  }

  /** Put the caret where serQ's diagnostic points. */
  goTo(message: string) {
    const at = position(message);
    if (!at) return;
    const doc = this.view.state.doc;
    const line = doc.line(Math.min(at.line, doc.lines));
    const pos = Math.min(line.from + at.col - 1, line.to);
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    this.view.focus();
  }
}

/** Where serQ's diagnostic points: `12:5: …`, and the width of its `^^^`. */
function position(message: string): { line: number; col: number; len: number } | null {
  const m = /(?:^|\s)(\d+):(\d+):/.exec(message);
  if (!m) return null;
  const carets = /^\s*\|\s*(\^+)/m.exec(message);
  return { line: Number(m[1]), col: Number(m[2]), len: carets ? carets[1].length : 1 };
}
