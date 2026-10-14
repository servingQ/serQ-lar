# Editing the deployment from the figure

The page draws serQ's deployment view of the program in the editor and
replays a run over it. The figure is editable as well: edit the text and
the figure follows at once; add an engine and join stations with arrows
from the figure, change a family's size, add a NIC or a pool; see a NIXL
copy as the pull or the push it is, and turn one into the other; zoom and
pan.

## The text is the program

Every edit the figure offers is an edit of the `.sq` text, which serQ then
compiles and draws again. The page keeps no model of the deployment of
its own: a second model would be a second frontend, and the rules forbid
re-implementing serQ (CLAUDE.md). So:

- **serQ decides what the text means.** The page reads where things are
  written (serQ's outline) and inserts or changes text there
  (`web/src/edit.ts`); whether the result is a program is serQ's answer,
  shown as serQ gives it, underlined in the text.
- **What the page inserts is text a person would write.** The snippets
  (an engine's queue, a NIC, a pool, a connector, a relation) are in
  `web/src/snippets.ts`, in the style of serQ's examples.
- **A node nothing reaches is a draft, not text.** serQ refuses a stage
  no request runs. An engine added from the palette is a card beside the
  figure until an arrow reaches it; the arrow writes the queue and its
  call together, so the program links at every step.
- **An edit is one step to undo.** It is a CodeMirror transaction: Ctrl+Z
  in the text takes it back.

## What serQ provides

| | serQ | |
|---|---|---|
| S1 | a station no request reaches does not link | #616, #617, landed |
| S2 | a NIXL copy says who posts it (`Run.poster`, `data-copy`, `data-poster`) | #618, #619, landed |
| S3 | an outline of the text (`serq::outline`) | #614, #615 |

See [upstream.md](upstream.md), U10.

## What the page does

1. **Live.** An edit redraws in a few milliseconds; the run starts once
   typing pauses, in a worker of its own that a newer edit stops. Text
   serQ refuses keeps the last figure, dimmed, under the diagnostic.
2. **Zoom and pan.** Wheel or pinch about the pointer, drag to pan,
   double-click or Fit to fit. The replay's canvas follows (`camera.ts`).
3. **Palette.** + Prefill, + Decode, + Delay: a draft.
4. **Arrows** (Connect mode). From the arrival or a station to a station
   or a draft: the target's call after the source's, in the gateway's
   route or the server; a family's call chooses its member. From a NIC's
   draft card to a queue: the KV copy (`kvt.nixl_pull`), with the NICs,
   the `use`s, the reader's `connector` and its entry and call `from` the
   source.
5. **Inspector** (click a station or a copy). Instances −/+ (the family's
   `let`), pull ⇄ push (a push dispatches the source's call with `fork`,
   which serQ requires), + NIC, + Pool, Duplicate (a draft copy, with the
   relations it reads by), Remove (the queue, its calls and its copies;
   serQ names whatever else still refers to it).

`scripts/check-edits.sh` runs every edit on serQ's examples and asks serQ
to link and draw the result.
