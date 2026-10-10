// kinds.ts — THE piece catalog: every kind of thing that can sit on a wall, with its label,
// band, default dimensions, counter behavior, and (for hoods) a fixed vertical anchor. This is
// the ONE place new piece types get defined; cabinet.ts, occupancy.ts, run.ts, the renderers,
// and persistence.ts all read from here rather than hardcoding per-kind behavior.
//
// Vertical placement (anchorBottomFor / cabinetVerticalPlacement) lives HERE rather than in
// bands.ts even though it's fundamentally "band math": bands.ts defines STANDARD.HOOD_BOTTOM
// and every other height constant, but resolving "does THIS kind override its band's anchor"
// needs the catalog below — and the catalog needs STANDARD from bands.ts for its own default
// dimensions. Putting the resolver in bands.ts would need bands.ts to import kinds.ts, which
// imports bands.ts back: a real circular value dependency (kinds.ts uses STANDARD.HOOD_BOTTOM
// at module-init time, so it isn't safely lazy). Keeping the resolver here instead — the one
// module that can see both bands.ts's constants and the per-kind anchor data — avoids that
// cycle entirely while keeping vertical placement single-sourced (just here, not bands.ts).

import { bandBottomFor, STANDARD } from "./bands";
import type { Cabinet, CabinetType } from "./cabinet";
import type { WallKind } from "./room";

export type PieceKind =
  | "cabinet"
  | "filler"
  | "fridge"
  | "range"
  | "dishwasher"
  | "sink"
  | "hood"
  | "wall-oven"
  | "window"
  | "door"
  | "doorway";

export type CounterBehavior = "slab" | "none";

export interface PieceDefaults {
  width: number;
  height: number;
  depth: number;
}

export interface KindDefinition {
  label: string;
  band: CabinetType;
  defaultSize: PieceDefaults;
  counter: CounterBehavior;
  /** Fixed height off the floor for this kind's bottom edge, overriding its band's normal
   * anchor (bandBottomFor). Only hoods and windows use this today — everything else anchors at
   * its band's usual floor (0 for base, WALL_CABINET_BOTTOM for wall). */
  anchor?: number;
  /** True for window/door/doorway: a wall FEATURE, not a piece of furniture. Perimeter-only
   * (canPlaceOn below) and excluded from solid-box 3D rendering (buildScene) — it becomes a
   * real cut in the wall instead (see viewer3d's wall-panel slicer). */
  opening?: boolean;
}

/** kind:'cabinet' and kind:'filler' are band-parameterized — a base cabinet and a wall cabinet
 * have different defaults — so they're keyed by band here rather than being flat catalog
 * entries. Every appliance kind below is a single fixed fixture with one set of defaults. */
const CABINET_DEFAULTS: Record<CabinetType, PieceDefaults> = {
  base: { width: 24, height: STANDARD.BASE_CABINET_HEIGHT, depth: 24 },
  wall: { width: 24, height: STANDARD.WALL_CABINET_HEIGHT, depth: 12 },
};

type ApplianceKind = Exclude<PieceKind, "cabinet" | "filler">;

const APPLIANCE_KINDS: Record<ApplianceKind, KindDefinition> = {
  fridge: {
    label: "Refrigerator",
    band: "base",
    defaultSize: { width: 36, height: 70, depth: 30 },
    counter: "none",
  },
  range: {
    label: "Range",
    band: "base",
    defaultSize: { width: 30, height: 36, depth: 26 },
    counter: "none",
  },
  dishwasher: {
    label: "Dishwasher",
    band: "base",
    defaultSize: { width: 24, height: STANDARD.BASE_CABINET_HEIGHT, depth: 24 },
    counter: "slab",
  },
  sink: {
    label: "Sink base",
    band: "base",
    defaultSize: { width: 36, height: STANDARD.BASE_CABINET_HEIGHT, depth: 24 },
    counter: "slab",
  },
  "wall-oven": {
    label: "Oven stack",
    band: "base",
    defaultSize: { width: 30, height: 84, depth: 24 },
    counter: "none",
  },
  hood: {
    label: "Range hood",
    band: "wall",
    defaultSize: { width: 36, height: 18, depth: 20 },
    counter: "none",
    anchor: STANDARD.HOOD_BOTTOM,
  },
  window: {
    label: "Window",
    band: "wall",
    // 4" nominal depth: shallow enough that a window's footprint (rendered through the same
    // cabinetFootprint machinery as every other piece) never meaningfully blocks an island drag.
    defaultSize: { width: 36, height: 36, depth: 4 },
    counter: "none",
    anchor: STANDARD.WINDOW_SILL,
    opening: true,
  },
  door: {
    label: "Door",
    band: "base",
    defaultSize: { width: 36, height: 80, depth: 4 },
    counter: "none",
    opening: true,
  },
  doorway: {
    label: "Doorway",
    band: "base",
    defaultSize: { width: 48, height: 80, depth: 4 },
    counter: "none",
    opening: true,
  },
};

/** Every appliance kind, in catalog order — the source the "Appliances:" toolbar group and
 * persistence's kind-shape validation both iterate/check against. */
export const APPLIANCE_KIND_LIST = Object.keys(APPLIANCE_KINDS) as ApplianceKind[];

/**
 * Look up the catalog entry for a piece's kind. For 'cabinet'/'filler' — the two band-
 * parameterized kinds — resolves against the given band; for every appliance kind, `band` is
 * ignored and the kind's own fixed band from the catalog wins (so passing a mismatched band
 * for a fixed-band appliance can never produce a wrong result).
 */
export function kindDefinition(kind: PieceKind, band: CabinetType): KindDefinition {
  if (kind === "cabinet" || kind === "filler") {
    return {
      label: band === "base" ? "Base cabinet" : "Wall cabinet",
      band,
      defaultSize: CABINET_DEFAULTS[band],
      counter: band === "base" ? "slab" : "none",
    };
  }
  return APPLIANCE_KINDS[kind];
}

/** Minimum height (inches) at which a base cabinet reads as a "Tall cabinet" (cycle 018) —
 * comfortably above any standard counter-height base (34.5") so an ordinary base never crosses
 * it by accident, comfortably below the 90" tall-cabinet variant preset (catalog.ts) so an
 * intentional pantry column always does. */
export const TALL_CABINET_MIN_HEIGHT = 60;

/**
 * THE one naming source — properties panel, status bar, and elevation labels all read this, so
 * every surface inherits a label change automatically.
 *
 * Labels are ATTRIBUTE-DERIVED (cycle 018), not variant-tagged: there is no stored "this piece
 * is a Tall cabinet" flag anywhere, only kind/band/doorStyle/height — the same fields any piece
 * already has. A plain base cabinet hand-stretched past TALL_CABINET_MIN_HEIGHT in the
 * properties panel honestly BECOMES a "Tall cabinet"; applying the glass door style there makes
 * it a "Glass upper" — identical to dropping the matching catalog variant row directly, because
 * both paths produce the exact same attributes. A label describes what the piece IS right now,
 * never which button created it.
 */
export function pieceLabel(cabinet: Pick<Cabinet, "kind" | "type" | "doorStyle" | "height">): string {
  if (cabinet.kind === "filler") {
    return `Filler strip (${cabinet.type})`;
  }
  if (cabinet.kind === "cabinet") {
    if (cabinet.type === "wall" && cabinet.doorStyle === "open") return "Open shelf";
    if (cabinet.type === "wall" && cabinet.doorStyle === "glass") return "Glass upper";
    if (cabinet.type === "base" && cabinet.height >= TALL_CABINET_MIN_HEIGHT) return "Tall cabinet";
  }
  return kindDefinition(cabinet.kind, cabinet.type).label;
}

/** The height off the floor this piece's bottom edge sits at: the kind's fixed anchor if it
 * has one (today, only hoods), else its band's usual anchor (floor for base, 54" for wall). */
export function anchorBottomFor(cabinet: Pick<Cabinet, "kind" | "type">): number {
  const anchor = kindDefinition(cabinet.kind, cabinet.type).anchor;
  return anchor ?? bandBottomFor(cabinet.type);
}

/** A piece's vertical extent — bottom derived from anchorBottomFor, top from its own height.
 * Never stored on the Cabinet itself; always derived here. */
export function cabinetVerticalPlacement(cabinet: Cabinet): { bottom: number; top: number } {
  const bottom = anchorBottomFor(cabinet);
  return { bottom, top: bottom + cabinet.height };
}

/**
 * Placement RULE, not physics: occupancy's vertical-range collision can't forbid a wall
 * cabinet or hood on an island (nothing overlaps its 54–84" range there, since an island has
 * no wall to anchor to) — it would simply float over open floor. An island only accepts
 * FLOOR-ANCHORED pieces: band 'base' with no kind-specific anchor override. `band` disambiguates
 * the two band-parameterized kinds (a "wall cabinet" is kind:'cabinet' + band:'wall' — same
 * kind as a base cabinet, different band — so kind alone can't answer this). Perimeter walls
 * accept everything, as today.
 */
export function canPlaceOn(wallKind: WallKind, kind: PieceKind, band: CabinetType): boolean {
  if (wallKind === "perimeter") return true;
  const def = kindDefinition(kind, band);
  // Openings are wall FEATURES, not furniture — an island has no wall to cut, so they're
  // perimeter-only. wallKind is narrowed to 'island' here (perimeter already returned above),
  // so this is unconditionally false — checked ahead of the floor-anchored island rule below,
  // which would otherwise wrongly admit a door: band 'base', no anchor override.
  if (def.opening) return false;
  return def.band === "base" && def.anchor === undefined;
}
