# Editing the deployment

The page draws serQ's deployment of the program in the Flow tab and
replays a run over it there. The deployment is editable
twice over: edit the text (the Code tab) and the figure follows at once;
or, in the Flow tab, drop engines onto serQ's graph and join stations with
arrows, change a family's size, add a NIC or a pool, see a NIXL copy as
the pull or the push it is and turn one into the other.

## The text is the program

Every edit the Flow tab offers is an edit of the `.sq` text, which serQ then
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
  no request runs. An engine added from the palette is a dashed node on
  the canvas until an arrow reaches it; the arrow writes the queue and its
  call together, so the program links at every step.
- **An edit is one step to undo.** It is a CodeMirror transaction: Ctrl+Z
  in the text, or in the Flow tab, takes it back.

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
   serQ refuses keeps the last figure, dimmed, under the diagnostic
   (in the Flow tab, over the canvas); a click on it opens the text there.
2. **Zoom and pan.** React Flow's: wheel or pinch, a drag on the canvas,
   the fit button. The replay's canvas follows its viewport
   (`flow/replay.ts`).
3. **Parts** (the Flow tab's sidebar), each dragged and dropped; a
   click does nothing.
   - *Engines*: Engine, Engine pool, Delay: a draft, dropped on the
     canvas, where it stays until an arrow places it; dropped on a
     station, that station calls it at once and serQ's layout places it.
     An engine starts a decoder (a whole engine: it prefills locally) and
     is made a prefiller or a decoder on its toolbar (6). An engine pool
     is N engines (llm-d's InferencePool), a family `queue D[N]`; its
     call chooses a member (`choose k in N by (work(D[k]))`); N is set
     in the sidebar, and in the text after.
   - *Memory pools*: KV blocks, Request slots: a memory pool, dropped on
     an engine, declared there (7) by a name its queue has not got.
   - *Arrows*: Call, dropped on the arrival or a station: an arrow from
     there follows the pointer, and the station or draft clicked next is
     its end (5). Esc, or a click on the empty canvas, drops it.
   - *KV transfer*: dropped on the source's engine, the reader clicked
     next: the copy (`copy` in `edit.ts`), with the NICs, the connector
     and the relation, a pull; the copy clicked is made a push (6).
4. **The Edit view** (React Flow, the Flow tab). serQ's graph as nodes to
   drag and wire: the nodes and arrows are read off serQ's figure
   (`data-node`, `data-from`, `data-to`, `data-copy`), the kinds off the IR,
   the layout is serQ's with its columns and rows kept and tightened
   (`flow/graph.ts`). Each node has an input on its left and an output on
   its right; the arrival only an output, the exit only an input. An
   instance serQ draws as a panel (`prefill instance P[i]`: the engine,
   its NIC) is a box here, with serQ's words over it, that holds its
   members: dragged, it moves them; a member dragged stays inside it, and
   it fits itself around them. serQ draws such an instance once per
   member (`choose i in NP`: `NP` panels, `P[0]` over `P[1]`, the copy from
   each prefiller to each decoder), and so does this view: an edit on a
   member is written to its array (`P`), and a panel kept clear of the
   one above it once the cards are measured. The arrows are routed by libavoid
   (`flow/route.ts`): orthogonal, around every node and clear of each
   panel's words, and arrows that would share a stretch are nudged apart,
   so no arrow runs through a node or on top of another, after a drag as
   well. Each station lists its memory pools, from the IR: request slots
   (orange) and KV blocks (blue), with their capacity; a pool no hold
   takes yet, which serQ's figure does not draw, is dashed. A node chosen
   has a toolbar (6); a station's has Code, which opens the Code tab on
   where it is written. A
   connection between two handles is an arrow below; a node dragged keeps
   its place in this browser (a layout, not the program); Delete removes a
   station; "serQ's layout" puts every node back. serQ's words are on it
   as its figure writes them (`wordsOf` in `flow/graph.ts`; a stopgap by
   place, upstream.md U19): a node's name over it and note under it, a
   pool's capacity and policy, a branch's condition, an exit's, a copy's
   way and latency, the arrival's process. The run replays over it
   (`flow/replay.ts`): a station's sessions sit in its card's lane and
   wait in a line left of it, its card counts them, an engine's bar shows
   its forward pass, and a session follows a card as it is dragged.
5. **Arrows** (a connection in the Edit view, or a Call part). From the arrival or a
   station to a station or a draft: the target's call after the source's,
   in the gateway's route or the server; a family's call chooses its
   member. From a NIC's draft to a queue: the KV copy (`kvt.nixl_pull`), with the NICs,
   the `use`s, the reader's `connector` and its entry and call `from` the
   source.
6. **Toolbars** (click a node or a copy in the Edit view; nothing above
   the canvas). An engine, or a draft engine: Prefill ⇄ Decode. A draft
   is written again under its role's name (`P`, `D`); a queue written
   already has its head's role, its engine's scheduler, its entry and
   its calls' verb rewritten (`retype` in `edit.ts`), unless it is in a
   KV copy, which its entry leases or reads by, or its entry is not the
   one `prefill (prompt)` or `decode (prompt)`: those are left to the
   text. An engine in no instance: Make instance (7). A KV copy: pull ⇄
   push (a push dispatches the source's call with `fork`, which serQ
   requires). Delete removes a station (its queue, its calls and its
   copies; serQ names whatever else still refers to it); an instance's
   size, a NIC alone and a station's copy are written in the text.
7. **Instances and pools** (the Edit view's toolbar, or the sidebar).
   An instance is not declared in serQ: it is the panel serQ draws around
   the engine, NIC and pools one `choose` variable indexes. Make instance
   writes that: the queue a family of one (`queue P[1]`), each call
   choosing its member (`choose k in 1 by (work(P[k])); P[k].prefill
   (…);`), a call reading the KV `from P` reading it `from P[k]`. serQ
   copies KV between two families or two queues, not one of each, so the
   queue at the copy's other end becomes an instance too, by a variable of
   its own. A queue with no NIC is sent to draw a KV transfer first: serQ
   refuses a NIC that carries no copy. A memory pool declares a pool and the capacity
   serQ sizes it by (`waitq cap 8;` in the engine and `pool waitq on P {
   queue fifo; }`, or `kv cap N;` in the device and `pool kv on gpu { … }`);
   KV blocks only where the device has none, since serQ takes one KV pool
   a device.

`scripts/check-edits.sh` runs every edit on serQ's examples and asks serQ
to link and draw the result.
