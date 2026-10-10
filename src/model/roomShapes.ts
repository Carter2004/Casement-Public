// roomShapes.ts — THE shape-preset catalog (cycle 017 authoring v1): a small, curated set of
// parameterized room footprints a homeowner picks from in the room form. Each preset is a PURE
// build(params): Vec2[] function, clamped so it ALWAYS produces a valid footprint (every edge at
// least MIN_EDGE_LENGTH, non-self-intersecting) regardless of what the form's number inputs
// contain — createPolygonRoom normalizes winding and derives walls from whatever comes out. This
// is the ONE shape catalog; the room form (app.ts) reads `params` to build the shape picker's
// per-shape fields via the EXISTING numberField builder (no new form controls), and
// resizeRoom.ts calls the active shape's own build() to rebuild on a same-shape resize.

import { MIN_EDGE_LENGTH, type Vec2 } from "./room";

export type RoomShapeKey = "rectangle" | "l-shape" | "u-shape" | "clipped-corner";

/** One number field a shape's params object needs — the room form builds one number input per
 * field, in this order. */
export interface ShapeParamField {
  key: string;
  label: string;
  default: number;
  min: number;
}

export interface RoomShapeDefinition {
  label: string;
  params: ShapeParamField[];
  build(params: Record<string, number>): Vec2[];
}

/** Smallest sane value for a room's own overall width/length — a room narrower than this
 * couldn't hold even one 12"-wide filler against a wall. */
const MIN_ROOM_EXTENT = 48;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(min, max), Math.max(min, value));
}

function clampMin(value: number, min: number): number {
  return Number.isFinite(value) ? Math.max(min, value) : min;
}

export const ROOM_SHAPES: Record<RoomShapeKey, RoomShapeDefinition> = {
  rectangle: {
    label: "Rectangle",
    params: [
      { key: "width", label: "Width", default: 120, min: MIN_ROOM_EXTENT },
      { key: "length", label: "Length", default: 144, min: MIN_ROOM_EXTENT },
    ],
    build(params) {
      const width = clampMin(params.width, MIN_ROOM_EXTENT);
      const length = clampMin(params.length, MIN_ROOM_EXTENT);
      return [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: length },
        { x: 0, y: length },
      ];
    },
  },

  /** A W×L rectangle with a w×l rectangular notch removed from the bottom-right corner — 6
   * vertices. `notchWidth`/`notchLength` are clamped so the remaining top-right and
   * bottom-left-of-notch segments both stay at least MIN_EDGE_LENGTH — the footprint can never
   * self-intersect or degenerate regardless of what's typed in the form. */
  "l-shape": {
    label: "L-shape",
    params: [
      { key: "width", label: "Width", default: 180, min: MIN_ROOM_EXTENT },
      { key: "length", label: "Length", default: 180, min: MIN_ROOM_EXTENT },
      { key: "notchWidth", label: "Notch width", default: 80, min: MIN_EDGE_LENGTH },
      { key: "notchLength", label: "Notch depth", default: 80, min: MIN_EDGE_LENGTH },
    ],
    build(params) {
      const width = clampMin(params.width, MIN_ROOM_EXTENT);
      const length = clampMin(params.length, MIN_ROOM_EXTENT);
      const notchWidth = clamp(params.notchWidth, MIN_EDGE_LENGTH, width - MIN_EDGE_LENGTH);
      const notchLength = clamp(params.notchLength, MIN_EDGE_LENGTH, length - MIN_EDGE_LENGTH);
      return [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: length - notchLength },
        { x: width - notchWidth, y: length - notchLength },
        { x: width - notchWidth, y: length },
        { x: 0, y: length },
      ];
    },
  },

  /** A W×L rectangle with a rectangular notch bitten out of the middle of the top edge, wrapping
   * the room around three sides of it — 8 vertices. `notchWidth` is clamped so BOTH remaining
   * top-edge legs stay at least MIN_EDGE_LENGTH; `notchLength` so the notch never reaches the
   * room's own far edge. */
  "u-shape": {
    label: "U-shape",
    params: [
      { key: "width", label: "Width", default: 220, min: MIN_ROOM_EXTENT },
      { key: "length", label: "Length", default: 180, min: MIN_ROOM_EXTENT },
      { key: "notchWidth", label: "Notch width", default: 80, min: MIN_EDGE_LENGTH },
      { key: "notchLength", label: "Notch depth", default: 90, min: MIN_EDGE_LENGTH },
    ],
    build(params) {
      const width = clampMin(params.width, MIN_ROOM_EXTENT);
      const length = clampMin(params.length, MIN_ROOM_EXTENT);
      const maxNotchWidth = Math.max(MIN_EDGE_LENGTH, width - 2 * MIN_EDGE_LENGTH);
      const notchWidth = clamp(params.notchWidth, MIN_EDGE_LENGTH, maxNotchWidth);
      const notchLength = clamp(params.notchLength, MIN_EDGE_LENGTH, length - MIN_EDGE_LENGTH);
      const half = notchWidth / 2;
      const cx = width / 2;
      return [
        { x: 0, y: 0 },
        { x: cx - half, y: 0 },
        { x: cx - half, y: notchLength },
        { x: cx + half, y: notchLength },
        { x: cx + half, y: 0 },
        { x: width, y: 0 },
        { x: width, y: length },
        { x: 0, y: length },
      ];
    },
  },

  /** A W×L rectangle with one corner replaced by a 45° diagonal wall of size `cut` — 5 vertices,
   * deliberately exercising the angled-wall physics with a real, reachable shape (a corner-pantry
   * cut). `cut` is clamped below both the width's and length's own remaining-edge minimums. */
  "clipped-corner": {
    label: "Clipped corner",
    params: [
      { key: "width", label: "Width", default: 140, min: MIN_ROOM_EXTENT },
      { key: "length", label: "Length", default: 140, min: MIN_ROOM_EXTENT },
      { key: "cut", label: "Corner cut", default: 40, min: MIN_EDGE_LENGTH },
    ],
    build(params) {
      const width = clampMin(params.width, MIN_ROOM_EXTENT);
      const length = clampMin(params.length, MIN_ROOM_EXTENT);
      const maxCut = Math.max(MIN_EDGE_LENGTH, Math.min(width, length) - MIN_EDGE_LENGTH);
      const cut = clamp(params.cut, MIN_EDGE_LENGTH, maxCut);
      return [
        { x: 0, y: 0 },
        { x: width - cut, y: 0 },
        { x: width, y: cut },
        { x: width, y: length },
        { x: 0, y: length },
      ];
    },
  },
};

/** The default params object for a shape — its fields' own `default` values, keyed. The room
 * form's own starting point whenever the owner switches to a shape they haven't configured yet. */
export function defaultParamsFor(key: RoomShapeKey): Record<string, number> {
  return Object.fromEntries(ROOM_SHAPES[key].params.map((field) => [field.key, field.default]));
}
