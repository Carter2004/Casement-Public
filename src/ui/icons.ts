// icons.ts — THE single icon source. Every glyph the chrome uses (catalog rows, top-bar
// buttons) comes from here — no second icon source, ever; future icons join this module.
// Hand-drawn inline SVG line glyphs on one 16x16 grid, stroke="currentColor" so the token layer
// (and disabled-state opacity) colors them for free, exactly like every other chrome element.
// Built via createElementNS (matching the app's existing SVG-building convention in
// drawCabinetRect.ts/planView.ts) rather than innerHTML — one declarative spec per icon, one
// shared builder.

const SVG_NS = "http://www.w3.org/2000/svg";

export type IconName =
  | "base-cabinet"
  | "wall-cabinet"
  | "fill"
  | "fridge"
  | "range"
  | "dishwasher"
  | "sink"
  | "hood"
  | "oven-stack"
  | "window"
  | "door"
  | "doorway"
  | "island"
  | "template-single-wall"
  | "template-galley"
  | "template-l-shape"
  | "template-u-shape"
  | "undo"
  | "redo"
  | "cube-3d"
  | "trash"
  | "chevron-left"
  | "chevron-right"
  | "tall-cabinet"
  | "glass-upper"
  | "open-shelf";

interface ElementSpec {
  tag: "path" | "line" | "rect" | "circle" | "polyline";
  attrs: Record<string, string>;
}

/** One room-outline + emphasized-wall(s) pattern, reused by all four template icons — every
 * template glyph is "a room square with its filled walls thicker," never a bespoke drawing. */
function templateGlyph(...boldEdges: Array<"top" | "bottom" | "left" | "right">): ElementSpec[] {
  const edges: Record<"top" | "bottom" | "left" | "right", ElementSpec> = {
    top: { tag: "line", attrs: { x1: "2", y1: "2", x2: "14", y2: "2" } },
    bottom: { tag: "line", attrs: { x1: "2", y1: "14", x2: "14", y2: "14" } },
    left: { tag: "line", attrs: { x1: "2", y1: "2", x2: "2", y2: "14" } },
    right: { tag: "line", attrs: { x1: "14", y1: "2", x2: "14", y2: "14" } },
  };
  return [
    { tag: "rect", attrs: { x: "2", y: "2", width: "12", height: "12", "stroke-width": "1" } },
    ...boldEdges.map((edge) => ({ ...edges[edge], attrs: { ...edges[edge].attrs, "stroke-width": "2.5" } })),
  ];
}

const ICONS: Record<IconName, ElementSpec[]> = {
  "base-cabinet": [
    { tag: "rect", attrs: { x: "2", y: "4", width: "12", height: "10" } },
    { tag: "line", attrs: { x1: "8", y1: "4", x2: "8", y2: "14" } },
    { tag: "line", attrs: { x1: "6.5", y1: "8.5", x2: "6.5", y2: "9.5" } },
    { tag: "line", attrs: { x1: "9.5", y1: "8.5", x2: "9.5", y2: "9.5" } },
  ],
  "wall-cabinet": [
    { tag: "rect", attrs: { x: "2", y: "3", width: "12", height: "7" } },
    { tag: "line", attrs: { x1: "8", y1: "3", x2: "8", y2: "10" } },
    { tag: "line", attrs: { x1: "6.5", y1: "6", x2: "6.5", y2: "7" } },
    { tag: "line", attrs: { x1: "9.5", y1: "6", x2: "9.5", y2: "7" } },
  ],
  fill: [
    { tag: "rect", attrs: { x: "2", y: "5", width: "12", height: "7" } },
    { tag: "line", attrs: { x1: "6", y1: "5", x2: "6", y2: "12" } },
    { tag: "line", attrs: { x1: "10", y1: "5", x2: "10", y2: "12" } },
  ],
  fridge: [
    { tag: "rect", attrs: { x: "3", y: "2", width: "10", height: "12" } },
    { tag: "line", attrs: { x1: "3", y1: "6", x2: "13", y2: "6" } },
    { tag: "line", attrs: { x1: "10.5", y1: "3", x2: "10.5", y2: "5" } },
    { tag: "line", attrs: { x1: "10.5", y1: "7", x2: "10.5", y2: "9" } },
  ],
  range: [
    { tag: "rect", attrs: { x: "2", y: "3", width: "12", height: "10" } },
    { tag: "circle", attrs: { cx: "5.5", cy: "6.5", r: "1" } },
    { tag: "circle", attrs: { cx: "10.5", cy: "6.5", r: "1" } },
    { tag: "circle", attrs: { cx: "5.5", cy: "10", r: "1" } },
    { tag: "circle", attrs: { cx: "10.5", cy: "10", r: "1" } },
  ],
  dishwasher: [
    { tag: "rect", attrs: { x: "2", y: "3", width: "12", height: "11" } },
    { tag: "line", attrs: { x1: "2", y1: "6.5", x2: "14", y2: "6.5" } },
    { tag: "circle", attrs: { cx: "8", cy: "4.7", r: "0.7" } },
  ],
  sink: [
    { tag: "rect", attrs: { x: "3", y: "7", width: "10", height: "6" } },
    { tag: "polyline", attrs: { points: "8,7 8,3 11,3 11,5" } },
  ],
  hood: [
    { tag: "path", attrs: { d: "M3,10 L6,3 H10 L13,10" } },
    { tag: "line", attrs: { x1: "3", y1: "10", x2: "13", y2: "10" } },
    { tag: "line", attrs: { x1: "8", y1: "10", x2: "8", y2: "13" } },
  ],
  "oven-stack": [
    { tag: "rect", attrs: { x: "3", y: "2", width: "10", height: "12" } },
    { tag: "line", attrs: { x1: "3", y1: "8", x2: "13", y2: "8" } },
    { tag: "circle", attrs: { cx: "8", cy: "5", r: "1.4" } },
    { tag: "line", attrs: { x1: "8", y1: "10.5", x2: "8", y2: "11.5" } },
  ],
  window: [
    { tag: "rect", attrs: { x: "2", y: "2", width: "12", height: "12" } },
    { tag: "line", attrs: { x1: "8", y1: "2", x2: "8", y2: "14" } },
    { tag: "line", attrs: { x1: "2", y1: "8", x2: "14", y2: "8" } },
  ],
  door: [
    { tag: "rect", attrs: { x: "4", y: "2", width: "8", height: "12" } },
    { tag: "circle", attrs: { cx: "10", cy: "8", r: "0.7", fill: "currentColor" } },
  ],
  doorway: [
    { tag: "line", attrs: { x1: "3", y1: "2", x2: "3", y2: "14" } },
    { tag: "line", attrs: { x1: "13", y1: "2", x2: "13", y2: "14" } },
    { tag: "line", attrs: { x1: "3", y1: "2", x2: "13", y2: "2" } },
  ],
  island: [
    { tag: "rect", attrs: { x: "3", y: "5", width: "10", height: "6" } },
    { tag: "circle", attrs: { cx: "5.5", cy: "13", r: "1" } },
    { tag: "circle", attrs: { cx: "10.5", cy: "13", r: "1" } },
  ],
  "template-single-wall": templateGlyph("bottom"),
  "template-galley": templateGlyph("top", "bottom"),
  "template-l-shape": templateGlyph("bottom", "right"),
  "template-u-shape": templateGlyph("left", "bottom", "right"),
  undo: [
    { tag: "polyline", attrs: { points: "6,3 3,6 6,9" } },
    { tag: "path", attrs: { d: "M3,6 H9 A4,4 0 0 1 9,14 H7" } },
  ],
  redo: [
    { tag: "polyline", attrs: { points: "10,3 13,6 10,9" } },
    { tag: "path", attrs: { d: "M13,6 H7 A4,4 0 0 0 7,14 H9" } },
  ],
  "cube-3d": [
    { tag: "polyline", attrs: { points: "4,5 8,3 12,5 8,7 4,5" } },
    { tag: "polyline", attrs: { points: "4,5 4,11 8,13 8,7" } },
    { tag: "polyline", attrs: { points: "8,7 8,13 12,11 12,5" } },
  ],
  trash: [
    { tag: "line", attrs: { x1: "2", y1: "5", x2: "14", y2: "5" } },
    { tag: "rect", attrs: { x: "4", y: "5", width: "8", height: "9" } },
    { tag: "rect", attrs: { x: "6", y: "2.5", width: "4", height: "2" } },
    { tag: "line", attrs: { x1: "6.5", y1: "7.5", x2: "6.5", y2: "11.5" } },
    { tag: "line", attrs: { x1: "9.5", y1: "7.5", x2: "9.5", y2: "11.5" } },
  ],
  "chevron-left": [{ tag: "polyline", attrs: { points: "9,3 5,8 9,13" } }],
  "chevron-right": [{ tag: "polyline", attrs: { points: "7,3 11,8 7,13" } }],
  // Tall cabinet (cycle 016) — a full-height double-door cabinet, two sets of pulls (top and
  // bottom) reading as "tall" rather than the standard base-cabinet proportions.
  "tall-cabinet": [
    { tag: "rect", attrs: { x: "3", y: "1", width: "10", height: "14" } },
    { tag: "line", attrs: { x1: "8", y1: "1", x2: "8", y2: "15" } },
    { tag: "line", attrs: { x1: "6.5", y1: "4", x2: "6.5", y2: "5" } },
    { tag: "line", attrs: { x1: "9.5", y1: "4", x2: "9.5", y2: "5" } },
    { tag: "line", attrs: { x1: "6.5", y1: "11", x2: "6.5", y2: "12" } },
    { tag: "line", attrs: { x1: "9.5", y1: "11", x2: "9.5", y2: "12" } },
  ],
  // Glass upper (cycle 016) — the wall-cabinet silhouette with a diagonal pane-reflection line
  // in each door instead of a pull, reading as glass rather than a solid front.
  "glass-upper": [
    { tag: "rect", attrs: { x: "2", y: "3", width: "12", height: "7" } },
    { tag: "line", attrs: { x1: "8", y1: "3", x2: "8", y2: "10" } },
    { tag: "line", attrs: { x1: "3.5", y1: "4.5", x2: "6.5", y2: "8.5" } },
    { tag: "line", attrs: { x1: "9.5", y1: "4.5", x2: "12.5", y2: "8.5" } },
  ],
  // Open shelf (cycle 016) — the same wall-cabinet silhouette with horizontal shelf lines and
  // no door divider, reading as open shelving.
  "open-shelf": [
    { tag: "rect", attrs: { x: "2", y: "3", width: "12", height: "7" } },
    { tag: "line", attrs: { x1: "2", y1: "5.5", x2: "14", y2: "5.5" } },
    { tag: "line", attrs: { x1: "2", y1: "8", x2: "14", y2: "8" } },
  ],
};

/** Build one icon as an SVG element. Every glyph shares the same 16x16 viewBox, 1.5px stroke,
 * round joins, and `stroke="currentColor"` — set once at the root so CSS `color` (including
 * `:disabled` opacity, already handled by the shared button/row rules) colors every icon for
 * free, with no per-icon color code anywhere. */
export function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");

  for (const spec of ICONS[name]) {
    const el = document.createElementNS(SVG_NS, spec.tag);
    for (const [key, value] of Object.entries(spec.attrs)) el.setAttribute(key, value);
    svg.appendChild(el);
  }
  return svg;
}
