// Where each stage is in the deployment view's SVG.
//
// Stopgap: `serq draw` writes no stage ids, so a station is found as a
// `.station` shape whose label - the stage's name - sits centred 8 points
// above it (src/view/deployment.rs). Once the SVG carries
// `data-stage="…"` (docs/upstream.md, U2) this reads that instead. Only a
// label that names one of the program's stages (`stages`, from serQ's IR)
// counts: a routing diamond is drawn as a station too.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Anchors {
  width: number;
  height: number;
  stations: Map<string, Box>;
}

export function anchors(svg: SVGSVGElement, stages: string[]): Anchors {
  const vb = svg.viewBox.baseVal;
  const stations = new Map<string, Box>();
  const texts = [...svg.querySelectorAll("text")].map((t) => ({
    x: Number(t.getAttribute("x")),
    y: Number(t.getAttribute("y")),
    text: t.textContent ?? "",
  }));
  for (const el of svg.querySelectorAll<SVGGraphicsElement>("[data-stage]")) {
    const b = el.getBBox();
    stations.set(el.dataset.stage!, { x: b.x, y: b.y, w: b.width, h: b.height });
  }
  if (stations.size === 0) {
    for (const el of svg.querySelectorAll<SVGGraphicsElement>(".station")) {
      const b = el.getBBox();
      const cx = b.x + b.width / 2;
      const label = texts.find((t) => Math.abs(t.x - cx) < 0.5 && Math.abs(t.y - (b.y - 8)) < 0.5);
      const name = label?.text.replace(/\[.*$/, "");
      if (name && stages.includes(name)) stations.set(name, { x: b.x, y: b.y, w: b.width, h: b.height });
    }
  }
  return { width: vb.width, height: vb.height, stations };
}
