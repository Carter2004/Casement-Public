// drawElevation.ts — THE shared elevation-drawing core (cycle 016 Part B1): band zones, the
// floor line, and every piece face for one wall, extracted from ElevationView.render() so the
// interactive view and the filmstrip's mini-elevations call the EXACT same drawing code, just at
// different scales — no second renderer, no drifting copies. The interactive view layers
// selection handles and the catalog-drag ghost on top afterward (those stay view-local, since
// they need live gesture state); a thumbnail draws this and nothing else.

import { computeBands } from "../model/bands";
import { resolveFinish } from "../model/finishes";
import { cabinetVerticalPlacement, pieceLabel } from "../model/kinds";
import type { Room, Wall } from "../model/room";
import { formatInches } from "../model/units";
import { drawCabinetRect, type PxRect } from "./drawCabinetRect";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface ElevationTransform {
  scale: number;
  originX: number;
  originY: number;
  wallHeight: number;
}

export interface DrawElevationOptions {
  /** Highlighted the same way the interactive view does — pass null/undefined for a thumbnail,
   * which never has its own independent piece selection. */
  selectedCabinetId?: string | null;
  /** Mini/thumbnail mode: skip band + piece labels (illegible at filmstrip scale) and mark
   * pieces non-interactive — geometry and color only. */
  mini?: boolean;
}

/** Compute a fit transform for `wall` inside a `width`x`height` pixel area, with `padding` px of
 * margin on every side — the SAME math ElevationView's own auto-fit and the filmstrip's
 * thumbnails both need, kept in ONE place so they can never drift apart. */
export function computeElevationFitTransform(
  wall: Wall,
  wallHeight: number,
  width: number,
  height: number,
  padding: number,
): ElevationTransform {
  const scale = Math.min((width - padding * 2) / wall.length, (height - padding * 2) / wallHeight);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    scale: safeScale,
    originX: (width - wall.length * safeScale) / 2,
    originY: (height - wallHeight * safeScale) / 2,
    wallHeight,
  };
}

/**
 * Draw band zones + the floor line + every piece face for `wall` into `svg` (appended, NOT
 * cleared — callers replaceChildren beforehand, same as every view already does).
 */
export function drawElevation(
  svg: SVGElement,
  room: Room,
  wall: Wall,
  t: ElevationTransform,
  opts: DrawElevationOptions = {},
): void {
  const pxX = (xIn: number) => t.originX + xIn * t.scale;
  const pxY = (heightIn: number) => t.originY + (t.wallHeight - heightIn) * t.scale;
  const drawWidth = wall.length * t.scale;

  // An island has no wall above the counter — only the floor->counter bands apply (toe-kick,
  // base, counter); no gap/wall-cabinet/space-above.
  const FLOOR_TO_COUNTER = new Set(["toe-kick", "base", "counter"]);
  const bands = computeBands(room.wallHeight).filter(
    (band) => wall.kind !== "island" || FLOOR_TO_COUNTER.has(band.key),
  );
  for (const band of bands) {
    const top = pxY(band.top);
    const bottom = pxY(band.bottom);
    const zone = document.createElementNS(SVG_NS, "rect");
    zone.classList.add("band", `band--${band.key}`);
    zone.setAttribute("x", String(t.originX));
    zone.setAttribute("y", String(top));
    zone.setAttribute("width", String(drawWidth));
    zone.setAttribute("height", String(Math.max(0, bottom - top)));
    svg.appendChild(zone);

    if (!opts.mini) {
      const label = document.createElementNS(SVG_NS, "text");
      label.classList.add("band__label");
      label.setAttribute("x", String(t.originX + 6));
      label.setAttribute("y", String((top + bottom) / 2));
      label.textContent = band.label;
      svg.appendChild(label);
    }
  }

  // Floor line for grounding.
  const floor = document.createElementNS(SVG_NS, "line");
  floor.classList.add("floor-line");
  floor.setAttribute("x1", String(t.originX));
  floor.setAttribute("x2", String(t.originX + drawWidth));
  floor.setAttribute("y1", String(pxY(0)));
  floor.setAttribute("y2", String(pxY(0)));
  svg.appendChild(floor);

  // Cabinet faces, vertically placed by the band system (derived, never stored). Plain
  // cabinets/fillers caption with their width; named appliances caption with their label —
  // pieceLabel is the one naming source, same as the properties panel reads.
  for (const cabinet of wall.cabinets) {
    const placement = cabinetVerticalPlacement(cabinet);
    const isPlainPiece = cabinet.kind === "cabinet" || cabinet.kind === "filler";
    const label = opts.mini ? undefined : isPlainPiece ? `${formatInches(cabinet.width)}"` : pieceLabel(cabinet);
    const pxRect: PxRect = {
      x: pxX(cabinet.xOffset),
      y: pxY(placement.top),
      width: cabinet.width * t.scale,
      height: cabinet.height * t.scale,
    };
    const g = drawCabinetRect(cabinet, pxRect, {
      selected: cabinet.id === opts.selectedCabinetId,
      label,
      interactive: !opts.mini,
      finish: resolveFinish(room, cabinet),
    });
    svg.appendChild(g);
  }
}
