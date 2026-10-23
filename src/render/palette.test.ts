import { describe, expect, it } from "vitest";
import { TINTS, luminance, writeFlatColor, type RGB } from "./palette";

describe("scan ink", () => {
  it("keeps grass green and blossom dark enough to scan on white", () => {
    const ink: RGB = [0, 0, 0];
    for (const tint of TINTS) {
      for (const kind of ["finder", "grass", "skirt"] as const) {
        writeFlatColor(kind, true, tint, ink);
        expect(ink[1]).toBeGreaterThan(ink[0]);
        expect(ink[1]).toBeGreaterThan(ink[2]);
        expect(luminance(ink)).toBeLessThan(0.2);
      }
      for (const kind of ["canopy", "trunk"] as const) {
        writeFlatColor(kind, true, tint, ink);
        expect(luminance(ink)).toBeLessThanOrEqual(0.2);
        expect(Math.max(...ink)).toBeGreaterThan(40);
      }
      writeFlatColor("path", false, tint, ink);
      expect(luminance(ink)).toBeGreaterThan(0.95);
    }
  });
});
