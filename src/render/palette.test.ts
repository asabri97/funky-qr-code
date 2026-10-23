import { describe, expect, it } from "vitest";
import { TINTS, luminance, writeArtColor, writeFlatColor, type RGB } from "./palette";

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

  it("paints the night code as light cyan on a dark field", () => {
    const ink: RGB = [0, 0, 0];
    writeFlatColor("path", false, "#e989a8", ink, "night");
    expect(luminance(ink)).toBeLessThan(0.05);
    for (const kind of ["finder", "grass", "skirt", "canopy", "trunk"] as const) {
      writeFlatColor(kind, true, "#e989a8", ink, "night");
      expect(luminance(ink)).toBeGreaterThan(0.45);
      expect(ink[2]).toBeGreaterThan(ink[0]);
    }
  });

  it("paints night as a dark deck and day as stone", () => {
    const ink: RGB = [0, 0, 0];
    writeArtColor("path", "spring", "#e989a8", 0, 0, ink, "night");
    expect(luminance(ink)).toBeLessThan(0.05);
    writeArtColor("skirt", "spring", "#e989a8", 0.2, 0, ink, "night");
    expect(ink[1]).toBeLessThan(ink[0] + 40);
    writeArtColor("path", "spring", "#e989a8", 0, 0, ink, "day");
    expect(luminance(ink)).toBeGreaterThan(0.6);
  });
});
