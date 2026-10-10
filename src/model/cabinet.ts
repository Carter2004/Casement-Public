// cabinet.ts — THE parametric piece definition. One shape, every view (plan, elevation, 3D)
// renders from it. A piece stores its HORIZONTAL position along the wall plus its three box
// dimensions. It does NOT store a vertical position — that is derived from kinds.ts so the
// standard heights and anchors stay in exactly one place.

import { kindDefinition, type PieceKind } from "./kinds";
import type { CabinetFinishKey, DoorStyle } from "./finishes";

export type CabinetType = "base" | "wall";

export interface Cabinet {
  id: string;
  /** What this piece IS — a plain cabinet, a fill-generated filler strip, or a named appliance
   * (fridge, range, dishwasher, sink, hood, wall-oven). The one classification mechanism. */
  kind: PieceKind;
  /** The vertical band this piece occupies — base (floor) or wall (upper). Independent of
   * kind: e.g. a hood is kind:'hood' but band:'wall'. */
  type: CabinetType;
  /** Distance in inches from the wall's start end to the cabinet's left edge. */
  xOffset: number;
  /** Box dimensions in inches. */
  width: number;
  height: number;
  depth: number;
  /** Per-piece finish/door-style override (cycle 014) — absent means "use the room's default"
   * (see finishes.ts's resolveFinish/resolveDoorStyle, THE one place that fallback happens). */
  finish?: CabinetFinishKey;
  doorStyle?: DoorStyle;
}

/** Smallest allowed value for any single cabinet dimension (inches). */
export const MIN_DIMENSION = 6;
/** Largest allowed depth (inches) — keeps a base cabinet from swallowing the room. */
export const MAX_DEPTH = 36;

let sequence = 0;
function nextId(kind: PieceKind): string {
  sequence += 1;
  return `piece-${kind}-${sequence}`;
}

/**
 * Create a piece of the given kind at a horizontal offset, using its catalog default
 * dimensions. `band` disambiguates the two band-parameterized kinds ('cabinet'/'filler' — a
 * base cabinet and a wall cabinet have different defaults); every other kind ignores it and
 * uses its own fixed band from the catalog, so passing the "wrong" band for a fixed-band
 * appliance can never produce an inconsistent piece.
 */
export function createCabinet(kind: PieceKind, band: CabinetType, xOffset: number): Cabinet {
  const def = kindDefinition(kind, band);
  return {
    id: nextId(kind),
    kind,
    type: def.band,
    xOffset: Math.max(0, xOffset),
    width: def.defaultSize.width,
    height: def.defaultSize.height,
    depth: def.defaultSize.depth,
  };
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
