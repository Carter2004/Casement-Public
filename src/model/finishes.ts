// finishes.ts — THE finish/preset catalog (cycle 014). Every curated finish/material/door-style
// key, its label, and its ONE CSS variable name lives here — never a literal color value; every
// literal lives in styles.css. Finish ASSIGNMENTS (which key a room or piece currently wears) are
// model data, persisted; finish VALUES (what color a key actually renders as) stay in the
// stylesheet — 2D reads them via `finish--<key>` classes on drawCabinetRect, 3D reads the SAME
// variable via buildScene.ts's existing cssColor(). resolveFinish/resolveDoorStyle below are THE
// one resolution pair both renderers call — nobody else ever inlines "override ?? room default."

import type { Cabinet } from "./cabinet";
import type { Room } from "./room";

export interface FinishEntry {
  label: string;
  cssVar: string;
}

// ---- Cabinet finishes ------------------------------------------------------------------

export type CabinetFinishKey =
  | "white"
  | "cream"
  | "sage"
  | "navy"
  | "graphite"
  | "warm-oak"
  | "walnut"
  | "weathered-gray";

export const CABINET_FINISHES: Record<CabinetFinishKey, FinishEntry> = {
  white: { label: "White", cssVar: "--finish-cabinet-white" },
  cream: { label: "Cream", cssVar: "--finish-cabinet-cream" },
  sage: { label: "Sage Green", cssVar: "--finish-cabinet-sage" },
  navy: { label: "Navy Blue", cssVar: "--finish-cabinet-navy" },
  graphite: { label: "Graphite", cssVar: "--finish-cabinet-graphite" },
  "warm-oak": { label: "Warm Oak", cssVar: "--finish-cabinet-warm-oak" },
  walnut: { label: "Walnut", cssVar: "--finish-cabinet-walnut" },
  "weathered-gray": { label: "Weathered Gray", cssVar: "--finish-cabinet-weathered-gray" },
};

// ---- Room surfaces -----------------------------------------------------------------------

export type CounterMaterialKey = "butcher-block" | "white-quartz" | "black-granite" | "gray-stone" | "marble";

export const COUNTER_MATERIALS: Record<CounterMaterialKey, FinishEntry> = {
  "butcher-block": { label: "Butcher Block", cssVar: "--finish-counter-butcher-block" },
  "white-quartz": { label: "White Quartz", cssVar: "--finish-counter-white-quartz" },
  "black-granite": { label: "Black Granite", cssVar: "--finish-counter-black-granite" },
  "gray-stone": { label: "Gray Stone", cssVar: "--finish-counter-gray-stone" },
  marble: { label: "Marble", cssVar: "--finish-counter-marble" },
};

export type FloorMaterialKey = "light-oak" | "dark-walnut" | "white-tile" | "gray-plank" | "terracotta";

export const FLOOR_MATERIALS: Record<FloorMaterialKey, FinishEntry> = {
  "light-oak": { label: "Light Oak", cssVar: "--finish-floor-light-oak" },
  "dark-walnut": { label: "Dark Walnut", cssVar: "--finish-floor-dark-walnut" },
  "white-tile": { label: "White Tile", cssVar: "--finish-floor-white-tile" },
  "gray-plank": { label: "Gray Plank", cssVar: "--finish-floor-gray-plank" },
  terracotta: { label: "Terracotta", cssVar: "--finish-floor-terracotta" },
};

export type WallPaintKey = "white" | "greige" | "sage-green" | "soft-blue" | "warm-cream";

export const WALL_PAINTS: Record<WallPaintKey, FinishEntry> = {
  white: { label: "White", cssVar: "--finish-wall-white" },
  greige: { label: "Greige", cssVar: "--finish-wall-greige" },
  "sage-green": { label: "Sage Green", cssVar: "--finish-wall-sage-green" },
  "soft-blue": { label: "Soft Blue", cssVar: "--finish-wall-soft-blue" },
  "warm-cream": { label: "Warm Cream", cssVar: "--finish-wall-warm-cream" },
};

export type BacksplashKey = "white" | "marble" | "gray-stone" | "navy";

export const BACKSPLASHES: Record<BacksplashKey, FinishEntry> = {
  white: { label: "White", cssVar: "--finish-backsplash-white" },
  marble: { label: "Marble", cssVar: "--finish-backsplash-marble" },
  "gray-stone": { label: "Gray Stone", cssVar: "--finish-backsplash-gray-stone" },
  navy: { label: "Navy", cssVar: "--finish-backsplash-navy" },
};

/** Every surface category setRoomSurface accepts — one room-wide default each, independent of
 * cabinet finish (which cascades preset -> per-piece override instead). */
export type SurfaceCategory = "counter" | "floor" | "walls" | "backsplash";

// ---- Door styles -----------------------------------------------------------------------

export type DoorStyle = "flat" | "shaker" | "glass" | "open";

export const DOOR_STYLES: Record<DoorStyle, { label: string }> = {
  flat: { label: "Flat" },
  shaker: { label: "Shaker" },
  glass: { label: "Glass Front" },
  // Cycle 016 Part C2 — no door at all, just shelves. Registry-driven persistence validation
  // (VALID_DOOR_STYLES) accepts it automatically; no schema bump.
  open: { label: "Open Shelf" },
};

// ---- Presets ("looks") ------------------------------------------------------------------

export type PresetKey = "classic-white" | "modern-slab" | "farmhouse" | "cabin-wood" | "coastal" | "warm-walnut";

/** The reserved "no preset fully applies anymore" sentinel (cycle 015) — NOT a PRESETS registry
 * entry. setRoomSurface/setPieceFinish/setPieceDoorStyle set this whenever the room diverges from
 * whatever preset was last actually clicked; applyPreset is the only mutation that ever sets a
 * REAL PresetKey. Lets the catalog stop claiming a bundle the room no longer wears. */
export const CUSTOM_PRESET = "custom";

/** A room's style.preset value: either a real curated bundle, or the divergence sentinel above. */
export type StylePreset = PresetKey | typeof CUSTOM_PRESET;

export interface PresetBundle {
  label: string;
  cabinetFinish: CabinetFinishKey;
  doorStyle: DoorStyle;
  counter: CounterMaterialKey;
  floor: FloorMaterialKey;
  walls: WallPaintKey;
  backsplash: BacksplashKey;
}

/** Six curated whole-kitchen bundles — one click gets 90% of the way there (the idea's own
 * framing). Every key here must exist in its own registry above; finishes.test.ts checks this. */
export const PRESETS: Record<PresetKey, PresetBundle> = {
  "classic-white": {
    label: "Classic White",
    cabinetFinish: "white",
    doorStyle: "shaker",
    counter: "white-quartz",
    floor: "light-oak",
    walls: "white",
    backsplash: "white",
  },
  "modern-slab": {
    label: "Modern Slab",
    cabinetFinish: "graphite",
    doorStyle: "flat",
    counter: "black-granite",
    floor: "gray-plank",
    walls: "greige",
    backsplash: "gray-stone",
  },
  farmhouse: {
    label: "Farmhouse",
    cabinetFinish: "sage",
    doorStyle: "shaker",
    counter: "butcher-block",
    floor: "light-oak",
    walls: "white",
    backsplash: "white",
  },
  "cabin-wood": {
    label: "Cabin Wood",
    cabinetFinish: "warm-oak",
    doorStyle: "shaker",
    counter: "butcher-block",
    floor: "dark-walnut",
    walls: "greige",
    backsplash: "gray-stone",
  },
  coastal: {
    label: "Coastal",
    cabinetFinish: "navy",
    doorStyle: "shaker",
    counter: "white-quartz",
    floor: "white-tile",
    walls: "soft-blue",
    backsplash: "white",
  },
  "warm-walnut": {
    label: "Warm Walnut",
    cabinetFinish: "walnut",
    doorStyle: "flat",
    counter: "marble",
    floor: "dark-walnut",
    walls: "warm-cream",
    backsplash: "marble",
  },
};

/** The room's own style bundle — persisted, not derived. `preset` records which look was last
 * fully applied (so the catalog can mark it active); every field can then drift from that
 * preset via setRoomSurface without losing the "last preset applied" memory (it just stops being
 * literally true until the next full preset click, same as any "modified since" indicator). */
export interface RoomStyle {
  preset: StylePreset;
  cabinetFinish: CabinetFinishKey;
  doorStyle: DoorStyle;
  counter: CounterMaterialKey;
  floor: FloorMaterialKey;
  walls: WallPaintKey;
  backsplash: BacksplashKey;
}

/** The RoomStyle a preset produces — createRectangularRoom seeds a fresh room with this (Classic
 * White), store.applyPreset uses it to replace a room's whole look, and persistence's v3->v4
 * migration uses it to give every pre-finishes save a coherent look on first load. */
export function roomStyleForPreset(key: PresetKey): RoomStyle {
  const bundle = PRESETS[key];
  return {
    preset: key,
    cabinetFinish: bundle.cabinetFinish,
    doorStyle: bundle.doorStyle,
    counter: bundle.counter,
    floor: bundle.floor,
    walls: bundle.walls,
    backsplash: bundle.backsplash,
  };
}

export const DEFAULT_PRESET: PresetKey = "classic-white";

// ---- Resolution (THE one place either renderer decides a piece's look) ------------------

/**
 * A cabinet's effective finish key, or null if this kind never takes one — appliances/fixtures
 * keep their own kind color (a fridge is stainless, not Farmhouse-green) and openings have no
 * material at all. Plain cabinets AND filler strips both resolve here (a filler follows the
 * cabinet finish, override or room default, exactly like a real cabinet would).
 */
export function resolveFinish(room: Room, cabinet: Cabinet): CabinetFinishKey | null {
  if (cabinet.kind !== "cabinet" && cabinet.kind !== "filler") return null;
  return cabinet.finish ?? room.style.cabinetFinish;
}

/**
 * A cabinet's effective door style, or null if this piece has no door geometry at all — only
 * real `kind:'cabinet'` pieces do (fillers are a strip, not a door; appliances/openings have
 * their own fixed geometry).
 */
export function resolveDoorStyle(room: Room, cabinet: Cabinet): DoorStyle | null {
  if (cabinet.kind !== "cabinet") return null;
  return cabinet.doorStyle ?? room.style.doorStyle;
}

// ---- Swatch chip naming (THE one chip element, shared by catalog + properties) ----------

/** Map a finish's own `--finish-<category>-<key>` CSS variable to its `.swatch--<category>-<key>`
 * modifier class — the ONE derivation, so no call site hardcodes a duplicate class-name string
 * for any of the ~27 curated swatches. */
export function swatchModifierClass(cssVar: string): string {
  return cssVar.replace("--finish-", "swatch--");
}
