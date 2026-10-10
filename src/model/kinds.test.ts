// kinds.test.ts — canPlaceOn coverage for openings: a window/door/doorway is a wall FEATURE,
// not furniture, so it must be rejected on an island regardless of its band/anchor shape (a
// door's own band:'base' + no anchor override would otherwise pass the pre-existing
// floor-anchored island rule).

import { describe, expect, it } from "vitest";
import { canPlaceOn, pieceLabel, TALL_CABINET_MIN_HEIGHT } from "./kinds";

describe("canPlaceOn: openings are perimeter-only", () => {
  it("accepts every opening kind on a perimeter wall", () => {
    expect(canPlaceOn("perimeter", "window", "wall")).toBe(true);
    expect(canPlaceOn("perimeter", "door", "base")).toBe(true);
    expect(canPlaceOn("perimeter", "doorway", "base")).toBe(true);
  });

  it("rejects every opening kind on an island, even though door/doorway are floor-anchored", () => {
    expect(canPlaceOn("island", "window", "wall")).toBe(false);
    expect(canPlaceOn("island", "door", "base")).toBe(false);
    expect(canPlaceOn("island", "doorway", "base")).toBe(false);
  });

  it("a plain floor-anchored base cabinet still passes the island rule (no regression)", () => {
    expect(canPlaceOn("island", "cabinet", "base")).toBe(true);
    expect(canPlaceOn("island", "cabinet", "wall")).toBe(false);
  });
});

describe("pieceLabel: variant-aware labels (cycle 018 — attribute-derived, not variant-tagged)", () => {
  it("a wall cabinet with doorStyle 'open' reads as Open shelf", () => {
    expect(pieceLabel({ kind: "cabinet", type: "wall", doorStyle: "open", height: 30 })).toBe("Open shelf");
  });

  it("a wall cabinet with doorStyle 'glass' reads as Glass upper", () => {
    expect(pieceLabel({ kind: "cabinet", type: "wall", doorStyle: "glass", height: 30 })).toBe("Glass upper");
  });

  it("a base cabinet at or above TALL_CABINET_MIN_HEIGHT reads as Tall cabinet", () => {
    expect(pieceLabel({ kind: "cabinet", type: "base", doorStyle: undefined, height: 90 })).toBe("Tall cabinet");
  });

  it("boundary: exactly at the threshold is Tall cabinet, just under is Base cabinet", () => {
    expect(
      pieceLabel({ kind: "cabinet", type: "base", doorStyle: undefined, height: TALL_CABINET_MIN_HEIGHT }),
    ).toBe("Tall cabinet");
    expect(
      pieceLabel({ kind: "cabinet", type: "base", doorStyle: undefined, height: TALL_CABINET_MIN_HEIGHT - 0.5 }),
    ).toBe("Base cabinet");
  });

  it("a plain base/wall cabinet with no doorStyle override and ordinary height keeps today's labels", () => {
    expect(pieceLabel({ kind: "cabinet", type: "base", doorStyle: undefined, height: 34.5 })).toBe("Base cabinet");
    expect(pieceLabel({ kind: "cabinet", type: "wall", doorStyle: undefined, height: 30 })).toBe("Wall cabinet");
  });

  it("a wall cabinet stretched tall is NOT relabeled Tall cabinet — that rule is base-band only", () => {
    expect(pieceLabel({ kind: "cabinet", type: "wall", doorStyle: undefined, height: 90 })).toBe("Wall cabinet");
  });

  it("a base cabinet with doorStyle 'glass' is unaffected — the door-style rules are wall-band only", () => {
    expect(pieceLabel({ kind: "cabinet", type: "base", doorStyle: "glass", height: 34.5 })).toBe("Base cabinet");
  });

  it("filler and appliance labels are unchanged", () => {
    expect(pieceLabel({ kind: "filler", type: "base", doorStyle: undefined, height: 34.5 })).toBe(
      "Filler strip (base)",
    );
    expect(pieceLabel({ kind: "fridge", type: "base", doorStyle: undefined, height: 70 })).toBe("Refrigerator");
    expect(pieceLabel({ kind: "doorway", type: "base", doorStyle: undefined, height: 80 })).toBe("Doorway");
  });
});
