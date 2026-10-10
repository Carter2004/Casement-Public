// statusbar.ts — the bottom status bar (cycle 012, display-only except for hover signaling).
// Left: a selection summary built from pieceLabel + existing state (no new naming source — see
// kinds.ts for the one place a piece's display name comes from). Right: ONE priority ladder
// (cycle 016 audit #A3) — exactly one of (1) a transient outcome, (2) the camera hint while a
// canvas is hovered, (3) the select-a-wall hint — never more than one rung at a time. A small
// "Saved" whisper (cycle 016 audit #A4) sits beside it, fading in and out on its own.

import { store } from "../model/store";
import { pieceLabel } from "../model/kinds";
import { islandOrientation } from "../model/room";
import { formatInches } from "../model/units";

const SELECT_WALL_HINT = "Select a wall to add cabinets";
const CAMERA_HINT = "Scroll to zoom · Space to pan · Double-click to fit";
const SAVED_VISIBLE_MS = 1500;

/** Display-copy fix (cycle 018 friction — audit Part 4 #1): a polygon room's generic wall
 * labels ("Wall 3", createPolygonRoom's own naming) already read as a full name — appending
 * " wall" produced "Wall 3 wall" on every selection in a non-rectangular room. A rectangle's
 * directional labels ("North") are NOT full names on their own and still need the suffix
 * ("North wall"). Statusbar-local — the one place anything gets appended to wall.label; if
 * another surface later needs the same treatment, it moves to a shared home then. Exported
 * (pure, no DOM) so it's unit-testable without the jsdom-free vitest setup this project uses —
 * live verification covers the rest of this display-only module. */
export function formatWallName(label: string): string {
  return /^Wall \d/.test(label) ? label : `${label} wall`;
}

/** THE one hint-priority state (cycle 016) — a single module-level source so setTransientHint/
 * setCanvasHover and the store's own selection state can never disagree about which rung shows;
 * a single StatusBar is ever mounted (matching the transient-hint convention this replaces). */
let currentTransientHint: string | null = null;
let currentCanvasHover = false;
let rerenderHint: (() => void) | null = null;

/** Show (or clear, with null) a short-lived status-bar message — the top rung of the priority
 * ladder. THE one transient-hint channel: every view hint (a failed catalog drop's reason,
 * Alt-drag's "hold Alt to push" nudge, and any future one) calls this rather than inventing a
 * second channel. Unchanged signature/semantics from cycle 013; only its rendering moved. */
export function setTransientHint(text: string | null): void {
  currentTransientHint = text && text !== "" ? text : null;
  rerenderHint?.();
}

/** Signal that the pointer is (or isn't) over a canvas — the second rung. Both plan and
 * elevation views call this on their own pointerenter/pointerleave; since the two canvases are
 * non-overlapping siblings, a plain boolean is enough (leaving one always precedes entering the
 * other). Sibling of setTransientHint, same one-function-per-signal shape. */
export function setCanvasHover(hovering: boolean): void {
  currentCanvasHover = hovering;
  rerenderHint?.();
}

let savedEl: HTMLElement | null = null;
let savedHideTimer: number | undefined;

/** The save whisper (cycle 016 audit #A4): "Saved ✓" appears then fades. Display-only, driven
 * from app.ts's existing autosave wiring right after a successful debounced write — NEVER
 * routes through the transient channel above (a periodic "Saved" must not stomp a real hint). */
export function showSavedWhisper(): void {
  if (!savedEl) return;
  savedEl.classList.add("is-visible");
  if (savedHideTimer !== undefined) window.clearTimeout(savedHideTimer);
  savedHideTimer = window.setTimeout(() => savedEl?.classList.remove("is-visible"), SAVED_VISIBLE_MS);
}

export class StatusBar {
  private readonly selectionEl: HTMLElement;
  private readonly hintEl: HTMLElement;

  constructor(host: HTMLElement) {
    host.classList.add("statusbar");

    this.selectionEl = document.createElement("span");
    this.selectionEl.className = "statusbar__selection";
    host.appendChild(this.selectionEl);

    const right = document.createElement("div");
    right.className = "statusbar__right";
    host.appendChild(right);

    const saved = document.createElement("span");
    saved.className = "statusbar__saved";
    saved.textContent = "Saved ✓";
    right.appendChild(saved);
    savedEl = saved;

    this.hintEl = document.createElement("span");
    this.hintEl.className = "statusbar__hint";
    right.appendChild(this.hintEl);

    rerenderHint = () => this.renderHint();
    store.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const cabinet = store.getSelectedCabinet();
    const wall = store.getSelectedWall();
    const island = !cabinet && wall && wall.kind === "island" ? wall : null;

    if (cabinet && wall) {
      const wallName = wall.kind === "island" ? "Island" : formatWallName(wall.label);
      this.selectionEl.textContent =
        `${wallName} — ${pieceLabel(cabinet)} ${formatInches(cabinet.width)}″ at ${formatInches(cabinet.xOffset)}″`;
    } else if (island) {
      const orientation = islandOrientation(island) === "ew" ? "E-W" : "N-S";
      this.selectionEl.textContent = `Island — ${formatInches(island.length)}″ ${orientation}`;
    } else if (wall) {
      this.selectionEl.textContent = formatWallName(wall.label);
    } else {
      this.selectionEl.textContent = "";
    }

    this.renderHint();
  }

  /**
   * THE one arbitration point (cycle 016 audit #A3): exactly one rung shows, by priority —
   * (1) a transient outcome, (2) the camera hint while a canvas is hovered, (3) the select-a-
   * wall hint. Retires the old "two hints can show at once" defect by construction — there is
   * only one element left to write to.
   */
  private renderHint(): void {
    const wall = store.getSelectedWall();
    let text: string | null = null;
    let isTransient = false;

    if (currentTransientHint) {
      text = currentTransientHint;
      isTransient = true;
    } else if (currentCanvasHover) {
      text = CAMERA_HINT;
    } else if (!wall) {
      text = SELECT_WALL_HINT;
    }

    this.hintEl.textContent = text ?? "";
    this.hintEl.classList.toggle("is-danger", isTransient);
  }
}
