// planView.test.ts — grabAnchoredOffset (cycle 020 Part 1): the pure grab-offset-anchoring
// arithmetic the plan-view slide path consumes. PlanView itself is DOM wiring (this project's
// vitest setup has no jsdom, per keymap.test.ts/statusbar.test.ts/filmstrip.test.ts) — verified
// live in the browser instead; this exported pure helper is what's unit-testable.

import { describe, expect, it } from "vitest";
import { grabAnchoredOffset } from "./planView";

describe("grabAnchoredOffset", () => {
  it("a mid-body grab produces zero jump on the first move (projectedNow === projectedAtGrab)", () => {
    // Piece at xOffset 20, grabbed 15" into its own body (cursor projects to 35 at grab time).
    // Before any cursor movement, projectedNow is still 35 — the piece must not have moved.
    expect(grabAnchoredOffset(35, 35, 20)).toBe(20);
  });

  it("holds the SAME grab delta across an entire slide (cursor deltas map 1:1 to offset deltas)", () => {
    const offsetAtGrab = 20;
    const projectedAtGrab = 35; // grabbed 15" into the piece's own body
    expect(grabAnchoredOffset(40, projectedAtGrab, offsetAtGrab)).toBe(25); // +5 cursor -> +5 offset
    expect(grabAnchoredOffset(55, projectedAtGrab, offsetAtGrab)).toBe(40); // +20 cursor -> +20 offset
    expect(grabAnchoredOffset(20, projectedAtGrab, offsetAtGrab)).toBe(5); // -15 cursor -> -15 offset
  });

  it("a grab exactly at the piece's own left edge reproduces the OLD bare-projection behavior", () => {
    // projectedAtGrab === offsetAtGrab (the cursor was exactly at the piece's left edge at grab
    // time) collapses the formula to the plain projection — byte-identical to pre-020 behavior.
    const offsetAtGrab = 20;
    const projectedAtGrab = offsetAtGrab;
    expect(grabAnchoredOffset(50, projectedAtGrab, offsetAtGrab)).toBe(50);
    expect(grabAnchoredOffset(0, projectedAtGrab, offsetAtGrab)).toBe(0);
  });

  it("a grab at the piece's own right edge holds that edge under the cursor", () => {
    // Piece at xOffset 20, width 24 -> right edge at 44; grabbed exactly there.
    const offsetAtGrab = 20;
    const projectedAtGrab = 44;
    expect(grabAnchoredOffset(54, projectedAtGrab, offsetAtGrab)).toBe(30); // right edge now at 54
  });
});
