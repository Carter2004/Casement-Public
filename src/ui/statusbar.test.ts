// statusbar.test.ts — formatWallName, the one place statusbar.ts appends anything to a wall's
// own label (cycle 018 audit Part 4 #1: a polygon room's generic "Wall 3" read as "Wall 3 wall"
// on every selection). Pure string logic, no DOM — StatusBar itself stays covered by live
// verification only, per this project's jsdom-free vitest setup.

import { describe, expect, it } from "vitest";
import { formatWallName } from "./statusbar";

describe("formatWallName", () => {
  it("leaves a generic polygon-room label ('Wall N') unchanged — no doubled 'wall'", () => {
    expect(formatWallName("Wall 3")).toBe("Wall 3");
    expect(formatWallName("Wall 1")).toBe("Wall 1");
    expect(formatWallName("Wall 12")).toBe("Wall 12");
  });

  it("appends ' wall' to a rectangle's directional label", () => {
    expect(formatWallName("North")).toBe("North wall");
    expect(formatWallName("East")).toBe("East wall");
    expect(formatWallName("South")).toBe("South wall");
    expect(formatWallName("West")).toBe("West wall");
  });

  it("appends the suffix to any other non-'Wall N' label (defensive — e.g. a future custom name)", () => {
    expect(formatWallName("Pantry")).toBe("Pantry wall");
  });
});
