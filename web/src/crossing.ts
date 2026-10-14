// What crosses between the workload and the deployment: the server's
// signature (serQ's outline), the one thing a workload and a deployment
// share. The workload sends the parameters, the server replies; nothing
// else of either side is the other's (serQ docs/design/request-interface.md).

import type { Outline } from "./outline";

const box = document.querySelector<HTMLElement>("#crossing")!;

function chip(text: string, title: string, cls = ""): HTMLElement {
  const c = document.createElement("span");
  c.className = `x-chip mono ${cls}`.trim();
  c.textContent = text;
  c.title = title;
  return c;
}

function label(text: string): HTMLElement {
  const l = document.createElement("span");
  l.className = "eyebrow";
  l.textContent = text;
  return l;
}

/** Show the signature of the program just outlined; keep the last one while
 * the text does not parse, as the figure does. */
export function showCrossing(o: Outline | null): void {
  if (!o) return;
  const sig = o.signature;
  if (!sig) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren(label("request"));
  if (sig.params.length === 0) box.append(chip("nothing", "server { … } takes nothing of the workload", "x-none"));
  for (const p of sig.params) {
    box.append(
      p.hidden
        ? chip(p.name, `hidden: the engine runs by it, the scheduler may not read it (\`server (…, hidden ${p.name})\`)`, "x-hidden")
        : chip(p.name, `the workload sends it: \`send (${p.name}…)\``),
    );
  }
  if (sig.reply.length) {
    box.append(label("reply"));
    for (const r of sig.reply) box.append(chip(r, `the workload reads it after \`turn;\` as \`reply.${r}\``));
  }
}
