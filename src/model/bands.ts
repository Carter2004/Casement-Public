// bands.ts — THE single source of truth for standard cabinetry heights and the
// vertical zone stack of a wall. Every height in Casement comes from here.
// No magic height numbers are allowed to live anywhere else (views, factories, CSS).
//
// A wall reads bottom -> top as a stack of bands:
//   toe-kick -> base cabinet -> counter -> backsplash gap -> wall cabinet -> space above
// A piece stores only its HORIZONTAL position + dimensions. Its VERTICAL position is DERIVED
// — normally from these constants, or from a kind's own fixed anchor (see kinds.ts's
// anchorBottomFor/cabinetVerticalPlacement, which live there rather than here to avoid a
// circular import — this file stays the standards-only source those functions read from).

import type { CabinetType } from "./cabinet";

/** All measurements are in inches. These are realistic North-American kitchen standards. */
export const STANDARD = {
  /** Floor datum. */
  FLOOR: 0,
  /** Recessed toe-kick height at the bottom front of a base cabinet. */
  TOE_KICK_HEIGHT: 4.5,
  /** Total height of a base cabinet box sitting on the floor (toe-kick recess included). */
  BASE_CABINET_HEIGHT: 34.5,
  /** Countertop slab thickness resting on the base cabinets. */
  COUNTERTOP_THICKNESS: 1.5,
  /** Finished countertop working height (BASE_CABINET_HEIGHT + COUNTERTOP_THICKNESS). */
  COUNTER_HEIGHT: 36,
  /** Height off the floor at which wall (upper) cabinets begin — standard 18" above counter. */
  WALL_CABINET_BOTTOM: 54,
  /** Default height of a wall cabinet box. */
  WALL_CABINET_HEIGHT: 30,
  /** Default finished ceiling / wall height. */
  DEFAULT_WALL_HEIGHT: 96,
  /** Height off the floor a range hood's bottom edge sits at — a fixed kind-anchor override
   * (see kinds.ts), well above the normal 54" wall-cabinet band bottom. */
  HOOD_BOTTOM: 66,
  /** Height off the floor a window's sill (bottom edge) sits at — a fixed kind-anchor override
   * (see kinds.ts), standard height above a counter so a base cabinet can sit beneath it. */
  WINDOW_SILL: 42,
} as const;

/** Convenience: top of a default wall cabinet (bottom + height). */
export const WALL_CABINET_TOP = STANDARD.WALL_CABINET_BOTTOM + STANDARD.WALL_CABINET_HEIGHT;

/** A labeled horizontal zone of the wall, measured from the floor in inches. */
export interface Band {
  key: "toe-kick" | "base" | "counter" | "gap" | "wall-cabinet" | "space-above";
  label: string;
  /** Height off the floor where the band begins (inches). */
  bottom: number;
  /** Height off the floor where the band ends (inches). */
  top: number;
}

/**
 * Compute the vertical band stack for a wall of the given height, bottom -> top.
 * `space-above` fills whatever remains up to the ceiling (empty if the wall is short).
 */
export function computeBands(wallHeight: number): Band[] {
  const s = STANDARD;
  const bands: Band[] = [
    { key: "toe-kick", label: "Toe-kick", bottom: s.FLOOR, top: s.TOE_KICK_HEIGHT },
    { key: "base", label: "Base cabinet", bottom: s.TOE_KICK_HEIGHT, top: s.BASE_CABINET_HEIGHT },
    { key: "counter", label: "Counter", bottom: s.BASE_CABINET_HEIGHT, top: s.COUNTER_HEIGHT },
    { key: "gap", label: "Backsplash gap", bottom: s.COUNTER_HEIGHT, top: s.WALL_CABINET_BOTTOM },
    { key: "wall-cabinet", label: "Wall cabinet", bottom: s.WALL_CABINET_BOTTOM, top: WALL_CABINET_TOP },
  ];
  if (wallHeight > WALL_CABINET_TOP) {
    bands.push({ key: "space-above", label: "Space above", bottom: WALL_CABINET_TOP, top: wallHeight });
  }
  // Never report a band that pokes through a shorter-than-standard ceiling.
  return bands.filter((b) => b.bottom < wallHeight).map((b) => ({ ...b, top: Math.min(b.top, wallHeight) }));
}

/** Height off the floor at which a piece of this BAND is anchored by default (before any
 * kind-specific override — see kinds.ts's anchorBottomFor for the kind-aware version every
 * other module should actually call). Derived, never stored. */
export function bandBottomFor(type: CabinetType): number {
  return type === "base" ? STANDARD.FLOOR : STANDARD.WALL_CABINET_BOTTOM;
}
