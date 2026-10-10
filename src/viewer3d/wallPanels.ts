// wallPanels.ts — THE pure wall-slicing geometry: splits a wall's rectangle (length x height,
// in wall-local 2D coords: x = distance along the wall, y = height off the floor) into the
// panels that remain once its openings (windows/doors/doorways) are cut out. buildScene.ts is
// the only consumer — it turns each panel into one quad, reusing the exact corner-winding
// construction the single-quad case already used (see buildWall's header comment), so a
// doorway becomes an actual gap in the dollhouse wall and a window a real hole, not a painted
// overlay. Imports nothing from three — pure numbers in, pure numbers out, unit-testable
// without a renderer.

/** One opening's extent in wall-local coords: along-wall [start, end), vertical [bottom, top). */
export interface WallOpening {
  start: number;
  end: number;
  bottom: number;
  top: number;
}

/** One remaining solid panel of the wall, in the same wall-local coords. */
export interface WallPanel {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Floating-point guard only (not a design tolerance like occupancy's EPSILON) — drops the
 * zero-area slivers an edge-touching opening (flush with the wall's end, or head at the
 * ceiling) would otherwise leave behind. */
const MIN_PANEL_SIZE = 1e-6;

/**
 * Split the full [0, length] x [0, height] wall rectangle into the panels that remain after
 * cutting out every opening. Openings are applied one at a time, each subtracted from every
 * panel it overlaps — so multiple non-overlapping openings on one wall compose correctly with
 * no extra casing. The result exactly tiles "wall area minus every opening's area": no overlaps,
 * no gaps, by construction of subtractPanel below.
 */
export function computeWallPanels(length: number, height: number, openings: WallOpening[]): WallPanel[] {
  let panels: WallPanel[] = [{ x0: 0, y0: 0, x1: length, y1: height }];
  for (const opening of openings) {
    const hole: WallPanel = { x0: opening.start, y0: opening.bottom, x1: opening.end, y1: opening.top };
    panels = panels.flatMap((panel) => subtractPanel(panel, hole));
  }
  return panels.filter((p) => p.x1 - p.x0 > MIN_PANEL_SIZE && p.y1 - p.y0 > MIN_PANEL_SIZE);
}

/**
 * Subtract `hole` from `panel`, returning up to 4 sub-rectangles: left and right run the
 * panel's FULL height (simplest correct split for a hole that doesn't touch both vertical
 * edges); below and above are cut to the hole's own horizontal extent, between the left/right
 * strips, so no two returned pieces overlap. A hole outside the panel leaves it untouched.
 */
function subtractPanel(panel: WallPanel, hole: WallPanel): WallPanel[] {
  const ix0 = Math.max(panel.x0, hole.x0);
  const ix1 = Math.min(panel.x1, hole.x1);
  const iy0 = Math.max(panel.y0, hole.y0);
  const iy1 = Math.min(panel.y1, hole.y1);
  if (ix1 <= ix0 || iy1 <= iy0) return [panel];

  const pieces: WallPanel[] = [];
  if (ix0 > panel.x0) pieces.push({ x0: panel.x0, y0: panel.y0, x1: ix0, y1: panel.y1 }); // left
  if (ix1 < panel.x1) pieces.push({ x0: ix1, y0: panel.y0, x1: panel.x1, y1: panel.y1 }); // right
  if (iy0 > panel.y0) pieces.push({ x0: ix0, y0: panel.y0, x1: ix1, y1: iy0 }); // below the opening
  if (iy1 < panel.y1) pieces.push({ x0: ix0, y0: iy1, x1: ix1, y1: panel.y1 }); // above the opening (header)
  return pieces;
}
