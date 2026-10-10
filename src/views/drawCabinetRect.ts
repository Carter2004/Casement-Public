// drawCabinetRect.ts — THE one and only cabinet-rectangle renderer. The piece appears
// in BOTH views (a width×depth footprint in plan, a width×height face in elevation), and
// both views build that rectangle by calling THIS helper with their own pixel geometry.
// There is no second draw path and no per-kind style block: the look lives entirely in the
// .cabinet / .cabinet--base / .cabinet--wall / .cabinet--kind-${kind} classes in styles.css.
// No inline style strings.

import type { Cabinet } from "../model/cabinet";
import type { CabinetFinishKey } from "../model/finishes";

const SVG_NS = "http://www.w3.org/2000/svg";

/** A rectangle in pixel space, already mapped from inches by the calling view. */
export interface PxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawCabinetOptions {
  /** Highlight as the current selection. */
  selected?: boolean;
  /** Optional caption drawn centered in the rectangle (e.g. the width). */
  label?: string;
  /** Mark the rectangle as pointer-interactive (cursor affordance via CSS). */
  interactive?: boolean;
  /** Render as a catalog drag preview (cycle 013) — dashed, non-interactive, never a real piece. */
  ghost?: boolean;
  /** Paired with `ghost`: the previewed drop wouldn't land here (red instead of green). */
  ghostInvalid?: boolean;
  /** The piece's resolved cabinet finish (cycle 014) — the caller resolves it via
   * resolveFinish(room, cabinet) and passes the key through; null/undefined (appliances,
   * openings) means no finish class at all, so the kind's own fixed color shows through. */
  finish?: CabinetFinishKey | null;
  /** Rotate the piece about `rect.x`/`rect.y` by this many degrees (cycle 017 — plan view only,
   * for a piece on an angled wall). Omitted/0 draws exactly as before: a plain axis-aligned rect
   * at rect.x/rect.y. When set, rect.x/rect.y become the ROTATION ORIGIN (the piece's near-near
   * corner) and width/height are the piece's own true, unrotated dimensions — the caller (only
   * planView) computes both consistently for every wall angle. */
  rotationDeg?: number;
}

/**
 * Build an SVG <g> for one cabinet rectangle. Styling is by class only; the caller supplies
 * geometry. The group carries `data-cabinet-id` so views can hit-test via event delegation —
 * rotation (below) is a transform on this SAME group, so hit-testing needs no changes at all.
 */
export function drawCabinetRect(cabinet: Cabinet, rect: PxRect, opts: DrawCabinetOptions = {}): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.classList.add("cabinet", `cabinet--${cabinet.type}`, `cabinet--kind-${cabinet.kind}`);
  if (opts.selected) group.classList.add("is-selected");
  if (opts.interactive) group.classList.add("cabinet--interactive");
  if (opts.finish) group.classList.add(`finish--${opts.finish}`);
  if (opts.ghost) group.classList.add("cabinet--ghost");
  if (opts.ghostInvalid) group.classList.add("cabinet--ghost-invalid");
  group.dataset.cabinetId = cabinet.id;

  // Rotated (an angled wall, cycle 017): draw the box in its own LOCAL frame (origin at 0,0)
  // and rotate the whole group into place instead — no second draw path. Unrotated callers
  // (elevationView, filmstrip, and every axis-aligned plan piece pre-017) keep drawing directly
  // at rect.x/rect.y, byte-identical to before.
  const rotated = !!opts.rotationDeg;
  if (rotated) {
    group.setAttribute("transform", `translate(${rect.x} ${rect.y}) rotate(${opts.rotationDeg})`);
  }
  const localX = rotated ? 0 : rect.x;
  const localY = rotated ? 0 : rect.y;

  const box = document.createElementNS(SVG_NS, "rect");
  box.classList.add("cabinet__box");
  box.setAttribute("x", String(localX));
  box.setAttribute("y", String(localY));
  box.setAttribute("width", String(Math.max(0, rect.width)));
  box.setAttribute("height", String(Math.max(0, rect.height)));
  group.appendChild(box);

  // Only caption the rectangle when there is room for legible text.
  if (opts.label && rect.width > 26 && rect.height > 16) {
    const text = document.createElementNS(SVG_NS, "text");
    text.classList.add("cabinet__label");
    text.setAttribute("x", String(localX + rect.width / 2));
    text.setAttribute("y", String(localY + rect.height / 2));
    text.textContent = opts.label;
    group.appendChild(text);
  }

  return group;
}
