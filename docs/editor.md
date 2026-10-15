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
   - *Engines*: Engine, Delay: a draft, dropped on the canvas, where it
     stays until an arrow places it; dropped on a station, that station
     calls it at once and serQ's layout places it. An engine starts
     aggregated (`queue E : agg`: it prefills and decodes) and is made a
     prefiller or a decoder on its toolbar (6). N engines, a family
     `queue E[N]`, are an instance (7) sized in the text.
   - *Memory pools*: KV blocks, Request slots: a memory pool, dropped on
     an engine, declared there (7) by a name its queue has not got.
   - *Routing*: Router, dropped on an engine: each call to it chooses a
     member of its queue (`route` in `edit.ts`; a plain queue becomes a
     family of one, as Make instance does), by the least
     work, until the router is given its keys (8).
   - *Arrows*: Call, dropped on the client or a station: an arrow from
     there follows the pointer, and the station or draft clicked next is
     its end (5). Esc, or a click on the empty canvas, drops it.
   - *KV transfer*: dropped on the source's engine, the reader clicked
     next: the copy (`copy` in `edit.ts`), with the NICs, the connector
     and the relation, a pull; the reader made a decoder (its entry
     `decode (prompt) from P`, its role `decode`); the copy clicked is
     made a push (6).
4. **The Edit view** (React Flow, the Flow tab). serQ's graph as nodes to
   drag and wire: the nodes and arrows are read off serQ's figure
   (`data-node`, `data-from`, `data-to`, `data-copy`), the kinds off the IR,
   the layout is serQ's with its columns and rows kept and tightened
   (`flow/graph.ts`). Each node has an input on its left and an output on
   its right. The client is the workload, one a program: serQ's arrival
   arrow leaves its right, and each exit (`out`) comes back into it from
   underneath, a reply: a session at a tool, thinking, waits under it.
   serQ's decision is the router, an icon with its words (`choose j, i`).
   Everything else is the server, one a program, in a dashed frame.
   (serQ's figure draws the arrival and the `out`s apart and no frame:
   stopgaps, upstream.md U20.) A NIC stands on the edge of its queue's
   panel, half out of it, an add-on on the side its KV leaves (a
   source's right) or comes in by (a reader's left); with no panel, on
   its queue's card. An
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
   the canvas). An engine, or a draft engine: Agg · Prefill · Decode,
   serQ's roles `agg`, `prefill` and `decode`. Between Agg and Prefill,
   a draft is written again under its role's name (`E`, `P`); a queue
   written already has its head's role, its engine's scheduler, its entry
   and its calls' verb rewritten (`retype` in `edit.ts`), unless it is in
   a KV copy, which its entry leases or reads by, or its entry is not the
   one `prefill (prompt)` or `decode (prompt)`: those are left to the
   text. Decode on an aggregated engine is the KV copy from the one
   prefiller there is (5); with none or several, the copy is drawn by
   hand. A draft is made a decoder once placed. An engine in no instance: Make instance (7). A KV copy: pull ⇄
   push (a push dispatches the source's call with `fork`, which serQ
   requires). Delete removes a station (its queue, its calls and its
   copies; serQ names whatever else still refers to it); an instance's
   size, a NIC alone and a station's copy are written in the text.
7. **Instances and pools** (the Edit view's toolbar, or the sidebar).
   An instance is not declared in serQ: it is the panel serQ draws around
   the engine, NIC and pools one `choose` variable indexes. Make instance
   writes that: the queue a family of one (`queue P[1]`), each call
   choosing its member (`choose k in 1 by (work(P[k])); P[k].prefill
   (…);`), a call reading the KV `from P` reading it `from P[k]`; the
   queue at a KV copy's other end stays as it is (serQ copies between a
   family and a single queue, serQ #664). A memory pool declares a pool and
   the capacity serQ sizes it by (`waitq cap 8;` in the engine and `pool
   waitq on P { queue fifo; }`, or `kv cap N;` in the engine's device and
   `pool kv on P.gpu { … }`), after the capacities serQ's outline lists
   there (`engines`, `devices`).
8. **The inspector** (the right of the Flow tab: the router or the client
   clicked). Each property is a piece of the text serQ's outline places
   (`chooses`, `workload_items`, upstream.md U21), shown as written and
   written back on Enter or leaving the field (`web/src/inspect.ts`).
   The router: for each `choose`, the family it picks a member of (`to`:
   another family rewrites its count, its calls and its keys), and its
   keys in order, each typed, picked from serQ's functions (`functions()`
   in `crates/serq-wasm`, serQ's `highlight::functions`: each whose one
   parameter is a stage, on the member, or a pool, on each of its pools,
   with what serQ says it returns), removed, or added; and the calls it
   makes. The client: its
   arrival process, what each session starts with, what each turn draws,
   what each request sends, and what comes between turns (a tool's time);
   for a pair, the workload file's (its outline's `workload_file`), and the
   edit goes into that file.
   With a serQ whose outline places neither, it shows serQ's words and
   sends the edit to Code.

Whether an edit may be made is serQ's to say, not the page's: every edit
from the figure is compiled first, and one serQ refuses is not made; its
refusal, with serQ's code (`error[E-…]`), is said under the canvas and
the text stays as it was. A removal is the exception: it is made, and
serQ's diagnostic names what still refers to what went.

`scripts/check-edits.sh` runs every edit on serQ's examples and asks serQ
to link and draw the result.
