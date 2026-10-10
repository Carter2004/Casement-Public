// filmstrip.ts — the wall filmstrip (cycle 016 Part B2): one live mini-elevation thumbnail per
// perimeter wall + island, in room order (room.walls's own order — perimeter walls are seeded
// first, islands are always pushed after, so no separate ordering concept is needed), the
// current wall highlighted, click to jump. Calls the SAME drawElevation helper the interactive
// ElevationView uses, at thumbnail scale — no second renderer, no drifting copy.
//
// Cycle 019 Part 4: thumbs are ALSO drop targets for the one drag coordinator (add or move
// alike) — hovering one during a live drag highlights it green/red via the SAME canPlaceOn +
// planCabinetDrop checks the coordinator's own ghost already runs, and a drop maps through the
// thumb's own mini-elevation scale (thumbXToWallOffset, pure + unit-tested) to a wall offset,
// then routes through the SAME store authority (addCabinetAt/movePieceToWall) every other drop
// target uses. No second drop path, no second validity rule.

import { clamp, type Cabinet } from "../model/cabinet";
import { canPlaceOn } from "../model/kinds";
import { store, planCabinetDrop } from "../model/store";
import type { Room, Wall } from "../model/room";
import { catalogDrag, type DragPayload, type DragState } from "../ui/catalogDrag";
import { setTransientHint } from "../ui/statusbar";
import { computeElevationFitTransform, drawElevation, type ElevationTransform } from "./drawElevation";

const SVG_NS = "http://www.w3.org/2000/svg";
const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 64;
const THUMB_PADDING = 4;

/**
 * Maps a drop's x position — ALREADY in the thumb's own THUMB_WIDTH-unit coordinate space (the
 * caller converts from a raw client/CSS pixel via the thumb element's own bounding rect and
 * viewBox scale; that's a DOM concern, kept out of this pure function) — through the exact same
 * fit transform the thumb was drawn with, to a wall offset clamped to [0, wall.length]. Pure and
 * unit-tested (cycle 019 Part 4) — the one mapping both the hover-highlight probe and the actual
 * drop dispatch below share, so a highlighted thumb never promises a landing spot the drop can't
 * keep.
 */
export function thumbXToWallOffset(wall: Wall, wallHeight: number, localX: number): number {
  const t: ElevationTransform = computeElevationFitTransform(wall, wallHeight, THUMB_WIDTH, THUMB_HEIGHT, THUMB_PADDING);
  return clamp((localX - t.originX) / t.scale, 0, wall.length);
}

interface ThumbEntry {
  wall: Wall;
  thumb: HTMLButtonElement;
}

export class Filmstrip {
  private entries: ThumbEntry[] = [];

  constructor(private readonly host: HTMLElement) {
    this.host.classList.add("filmstrip");
    store.subscribe(() => this.render());
    // A coordinator drag's hover highlight lives entirely in updateDropHighlights (no full
    // re-render — rebuilding every mini-elevation SVG on every pointermove would be wasteful);
    // the drop itself is the SAME onDrop contract every view already registers.
    catalogDrag.subscribe(() => this.updateDropHighlights());
    catalogDrag.onDrop((state) => this.handleDrop(state));
    this.render();
  }

  private render(): void {
    this.host.replaceChildren();
    this.entries = [];
    const { room, selectedWallId } = store.getState();
    if (!room) return;

    for (const wall of room.walls) {
      const thumb = this.buildThumb(room, wall, wall.id === selectedWallId);
      this.entries.push({ wall, thumb });
      this.host.appendChild(thumb);
    }
    this.updateDropHighlights();
  }

  private buildThumb(room: Room, wall: Wall, isCurrent: boolean): HTMLButtonElement {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "filmstrip__thumb";
    thumb.classList.toggle("is-current", isCurrent);
    thumb.title = wall.label;
    thumb.setAttribute("aria-pressed", String(isCurrent));
    thumb.addEventListener("click", () => store.selectWall(wall.id));

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}`);
    svg.classList.add("filmstrip__thumb-svg");
    const t = computeElevationFitTransform(wall, room.wallHeight, THUMB_WIDTH, THUMB_HEIGHT, THUMB_PADDING);
    drawElevation(svg, room, wall, t, { mini: true });
    thumb.appendChild(svg);

    const caption = document.createElement("span");
    caption.className = "filmstrip__thumb-label";
    caption.textContent = wall.label;
    thumb.appendChild(caption);

    return thumb;
  }

  /** Screen point -> thumb-local (THUMB_WIDTH-unit) x, via the thumb's OWN rendered rect — the
   * viewBox scales to whatever CSS size the thumb actually renders at, so this ratio (not a raw
   * pixel offset) is what keeps thumbXToWallOffset's fit-transform math honest. */
  private localXFor(entry: ThumbEntry, clientX: number): number {
    const rect = entry.thumb.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * THUMB_WIDTH;
  }

  private hitTest(clientX: number, clientY: number): ThumbEntry | null {
    for (const entry of this.entries) {
      const rect = entry.thumb.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return entry;
      }
    }
    return null;
  }

  /** Would this payload actually land on `wall` at `offset` — the SAME canPlaceOn +
   * planCabinetDrop check every ghost preview already runs (with excludeCabinetId for a move),
   * so a green thumb never promises a landing the drop dispatch below can't keep. */
  private probe(room: Room, wall: Wall, payload: DragPayload, offset: number): boolean {
    if (payload.mode === "add") {
      const { kind, band, width } = payload.spec;
      if (!canPlaceOn(wall.kind, kind, band)) return false;
      return planCabinetDrop(room, wall, kind, band, width, offset).valid;
    }
    const located = this.locatePiece(room, payload.pieceId);
    if (!located) return false;
    const { cabinet } = located;
    if (!canPlaceOn(wall.kind, cabinet.kind, cabinet.type)) return false;
    return planCabinetDrop(room, wall, cabinet.kind, cabinet.type, cabinet.width, offset, cabinet.id).valid;
  }

  private locatePiece(room: Room, id: string): { wall: Wall; cabinet: Cabinet } | null {
    for (const wall of room.walls) {
      const cabinet = wall.cabinets.find((c) => c.id === id);
      if (cabinet) return { wall, cabinet };
    }
    return null;
  }

  private updateDropHighlights(): void {
    const drag = catalogDrag.current();
    const room = store.getState().room;
    const hit = drag && room ? this.hitTest(drag.clientX, drag.clientY) : null;
    const valid = hit && drag && room ? this.probe(room, hit.wall, drag.payload, thumbXToWallOffset(hit.wall, room.wallHeight, this.localXFor(hit, drag.clientX))) : false;

    for (const entry of this.entries) {
      const isTarget = entry === hit;
      entry.thumb.classList.toggle("is-drop-target", isTarget && valid);
      entry.thumb.classList.toggle("is-drop-target--invalid", isTarget && !valid);
    }

    // This channel is only ours to own while a coordinator drag is actually live — the moment
    // there isn't one, leave the status bar alone (some OTHER action's hint may be showing).
    if (!drag) return;
    if (!hit) {
      setTransientHint(null);
      return;
    }
    const verb = drag.payload.mode === "add" ? "Add to" : "Move to";
    setTransientHint(`${verb} ${hit.wall.label}`);
  }

  private handleDrop(state: DragState): void {
    const hit = this.hitTest(state.clientX, state.clientY);
    if (!hit) return;
    const room = store.getState().room;
    if (!room) return;
    const offset = thumbXToWallOffset(hit.wall, room.wallHeight, this.localXFor(hit, state.clientX));

    const outcome =
      state.payload.mode === "add"
        ? store.addCabinetAt(
            state.payload.spec.kind,
            state.payload.spec.band,
            state.payload.spec.width,
            hit.wall.id,
            offset,
            state.payload.spec.overrides,
          )
        : store.movePieceToWall(state.payload.pieceId, hit.wall.id, offset);
    setTransientHint(outcome.achieved ? null : (outcome.reason ?? "Can't drop here"));
  }
}
