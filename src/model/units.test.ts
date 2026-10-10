// units.test.ts — quantize (snap to the ½" grid) and formatInches (the one display formatter:
// up to 2 decimals, trailing zeros trimmed, a typed value's exact precision preserved).

import { describe, expect, it } from "vitest";
import { formatInches, GRID, quantize } from "./units";

describe("quantize", () => {
  it("snaps a raw gesture float to the nearest half-inch", () => {
    expect(quantize(36.42677744929885)).toBe(36.5);
    expect(quantize(36.1)).toBe(36);
    expect(quantize(36.26)).toBe(36.5);
    expect(quantize(36.24)).toBe(36);
  });

  it("leaves an already-quantized value unchanged", () => {
    expect(quantize(36)).toBe(36);
    expect(quantize(36.5)).toBe(36.5);
    expect(quantize(0)).toBe(0);
  });

  it("GRID is a half inch", () => {
    expect(GRID).toBe(0.5);
  });
});

describe("formatInches", () => {
  it("renders a whole number with no trailing decimal", () => {
    expect(formatInches(36)).toBe("36");
  });

  it("renders a half-inch value faithfully", () => {
    expect(formatInches(36.5)).toBe("36.5");
  });

  it("renders a typed two-decimal value faithfully — never a raw gesture float", () => {
    expect(formatInches(36.25)).toBe("36.25");
  });

  it("never lets a gesture-derived float reach the screen unrounded", () => {
    expect(formatInches(36.42677744929885)).not.toBe("36.42677744929885");
    expect(formatInches(36.42677744929885)).toBe("36.43");
  });

  it("rounds to at most 2 decimal places", () => {
    expect(formatInches(1 / 3)).toBe("0.33");
  });
});
