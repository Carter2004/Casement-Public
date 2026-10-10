// units.ts — THE one inch quantization + display formatter (cycle 015 audit #6). Gesture entry
// points (drag, resize-handle, island move/resize) quantize to the half-inch grid before the
// value ever reaches state — a real tape-measure mark, never a pointer-derived float like
// 36.42677744929885. Typed field values (properties panel inputs) are NOT quantized here; they
// stay exactly as typed/clamped, unchanged from before this cycle. formatInches is THE one
// display formatter for every inch value shown to the user afterwards — no raw String(number)
// for inches anywhere in the UI.

/** The grid gesture-derived positions/sizes snap to. */
export const GRID = 0.5;

/** Round to the nearest GRID increment — call at GESTURE entry points only. */
export function quantize(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/** Format an inch value for display: up to 2 decimal places, trailing zeros trimmed (36.5 stays
 * "36.5", a typed 36.25 stays "36.25", 36 stays "36"). */
export function formatInches(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
