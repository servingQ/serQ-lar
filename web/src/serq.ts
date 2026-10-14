// A serQ in a worker, asked by message. The page keeps two: one draws, which
// takes milliseconds and answers every edit, and one runs, which can take
// seconds and is thrown away when a newer edit wants the run instead.

import type { Request, Response } from "./worker";

type Ask = Request extends infer R ? (R extends unknown ? Omit<R, "id"> : never) : never;

export class Serq {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (r: Response) => void>();

  /** The answer to `q`. One that a `kill` overtook never comes. */
  ask(q: Ask): Promise<Response> {
    const w = this.worker ?? this.start();
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      w.postMessage({ ...q, id });
    });
  }

  /** Whether a question is still unanswered. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Stop whatever it is doing: the next question starts a fresh worker. */
  kill() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private start(): Worker {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (m: MessageEvent<Response>) => {
      this.pending.get(m.data.id)?.(m.data);
      this.pending.delete(m.data.id);
    };
    this.worker = w;
    return w;
  }
}
