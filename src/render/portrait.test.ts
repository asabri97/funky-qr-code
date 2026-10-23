import { describe, expect, it } from "vitest";
import { sampleHologram, samplePortrait } from "./portrait";

function plate(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const index = (y * width + x) * 4;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = a;
    }
  }
  return pixels;
}

describe("samplePortrait", () => {
  it("keeps a photo solid and lifts brighter pixels forward", () => {
    const pixels = plate(8, 8, (x) => [x < 4 ? 20 : 240, 20, 20, 255]);
    const cells = samplePortrait(pixels, 8, 8);
    expect(cells.length).toBeGreaterThan(100);
    const bright = cells.filter((cell) => cell.color[0] > 200);
    const dark = cells.filter((cell) => cell.color[0] < 40);
    expect(bright.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);
    expect(Math.max(...bright.map((cell) => cell.z))).toBeGreaterThan(Math.max(...dark.map((cell) => cell.z)));
  });

  it("drops transparent pixels from a cutout and stands the top of the picture higher", () => {
    const pixels = plate(8, 8, (_x, y) => [200, 40, 40, y < 4 ? 255 : 0]);
    const cells = samplePortrait(pixels, 8, 8);
    const solid = samplePortrait(plate(8, 8, () => [200, 40, 40, 255]), 8, 8);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(solid.length * 0.7);
    const top = Math.max(...cells.map((cell) => cell.y));
    const bottom = Math.min(...cells.map((cell) => cell.y));
    expect(top).toBeGreaterThan(bottom);
    expect(cells.some((cell) => cell.x < 0)).toBe(true);
    expect(cells.some((cell) => cell.x > 0)).toBe(true);
  });

  it("crops transparent padding so the picture fills the plaza", () => {
    const pixels = plate(40, 40, (x, y) => {
      const inside = x >= 30 && y >= 30;
      return [220, 30, 30, inside ? 255 : 0];
    });
    const cells = samplePortrait(pixels, 40, 40);
    const xs = cells.map((cell) => cell.x);
    const ys = cells.map((cell) => cell.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10);
  });

  it("returns nothing for an empty buffer", () => {
    expect(samplePortrait(new Uint8ClampedArray(0), 0, 0)).toEqual([]);
  });
});

describe("sampleHologram", () => {
  it("keeps the subject and drops a dark surround", () => {
    const pixels = plate(48, 64, (x, y) => {
      const nx = (x - 24) / 16;
      const ny = (y - 26) / 22;
      const face = nx * nx + ny * ny < 1;
      return face ? [180, 210, 230, 255] : [4, 8, 20, 255];
    });
    const holo = sampleHologram(pixels, 48, 64);
    expect(holo).not.toBeNull();
    if (!holo) return;
    expect(holo.width).toBeLessThan(48);
    expect(holo.height).toBeLessThan(64);
    let bright = 0;
    for (let i = 0; i < holo.pixels.length; i += 4) if (holo.pixels[i] > 150) bright += 1;
    expect(bright).toBeGreaterThan(10);
  });

  it("frames a very tall picture from the top", () => {
    const pixels = plate(20, 80, (_x, y) => (y < 6 ? [230, 20, 20, 255] : [20, 20, 220, 255]));
    const holo = sampleHologram(pixels, 20, 80);
    expect(holo).not.toBeNull();
    if (!holo) return;
    expect(holo.height).toBeLessThan(50);
    expect(holo.pixels[0]).toBeGreaterThan(180);
  });

  it("returns nothing for an empty buffer", () => {
    expect(sampleHologram(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });
});
