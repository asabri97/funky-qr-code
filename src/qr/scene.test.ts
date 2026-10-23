import QRCode from "qrcode";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import {
  MAX_DOME_LAYERS,
  TRUNK_LAYERS,
  TRUNK_RADIUS,
  buildMatrix,
  buildScene,
  canopyRadius,
  classifyCell,
  domeLayerCount,
  isFinder,
} from "./scene";

function mosaic(text: string) {
  const built = buildScene(text);
  if (!built.ok) throw new Error(built.message);
  const { blocks, grid } = built.scene;
  const scale = 8;
  const n = grid * scale;
  const data = new Uint8ClampedArray(n * n * 4);
  data.fill(255);
  const origin = (grid - 1) / 2;
  const seen = new Set<string>();
  for (const block of blocks) {
    if (!block.cap) continue;
    const ix = Math.round(block.x + origin);
    const iz = Math.round(block.z + origin);
    const key = `${ix},${iz}`;
    if (seen.has(key)) throw new Error(`duplicate cap ${key}`);
    seen.add(key);
    const color = block.dark ? 0 : 255;
    for (let py = 0; py < scale; py++) {
      for (let px = 0; px < scale; px++) {
        const i = ((iz * scale + py) * n + (ix * scale + px)) * 4;
        data[i] = color;
        data[i + 1] = color;
        data[i + 2] = color;
        data[i + 3] = 255;
      }
    }
  }
  return { data, n, grid, blocks, seen };
}

describe("domeLayerCount", () => {
  it("is tallest at the center and empty outside the radius", () => {
    expect(domeLayerCount(0, 10, 5)).toBe(5);
    expect(domeLayerCount(10, 10, 5)).toBe(0);
    expect(domeLayerCount(10.2, 8, 4)).toBe(0);
    expect(domeLayerCount(0, 10, 5)).toBeGreaterThan(domeLayerCount(7, 10, 5));
    let previous = domeLayerCount(0, 10, MAX_DOME_LAYERS);
    for (let distance = 1; distance <= 10; distance++) {
      const next = domeLayerCount(distance, 10, MAX_DOME_LAYERS);
      expect(next).toBeLessThanOrEqual(previous);
      previous = next;
    }
  });

  it("is deterministic", () => {
    expect(domeLayerCount(3.25, 9, 4)).toBe(domeLayerCount(3.25, 9, 4));
  });
});

describe("classifyCell", () => {
  it("keeps finder modules dark, short, and outside the canopy", () => {
    for (const text of ["https://example.com", "https://example.com/path?ref=canopy&x=1"]) {
      const matrix = buildMatrix(text);
      expect(matrix.ok).toBe(true);
      if (!matrix.ok) return;
      const radius = canopyRadius(matrix.size);
      const center = (matrix.size - 1) / 2;
      expect(matrix.modules[0]).toBe(1);
      expect(matrix.modules[3 * matrix.size + 3]).toBe(1);
      expect(matrix.modules[1 * matrix.size + 1]).toBe(0);
      for (let row = 0; row < matrix.size; row++) {
        for (let col = 0; col < matrix.size; col++) {
          if (!isFinder(col, row, matrix.size)) continue;
          expect(Math.hypot(col - center, row - center)).toBeGreaterThan(radius);
          const dark = matrix.modules[row * matrix.size + col] === 1;
          const cell = classifyCell(col, row, matrix.size, dark);
          expect(cell.finder).toBe(true);
          expect(cell.dark).toBe(dark);
          if (dark) {
            expect(cell.kind).toBe("finder");
            expect(cell.layers).toBe(1);
          } else {
            expect(cell.kind).toBe("path");
          }
        }
      }
    }
  });

  it("stacks the center as a trunk and the rim as grass", () => {
    const size = 33;
    const center = (size - 1) / 2;
    const trunk = classifyCell(center, center, size, true);
    expect(trunk.kind).toBe("trunk");
    expect(trunk.layers).toBe(TRUNK_LAYERS);
    expect(trunk.dark).toBe(true);
    const radius = canopyRadius(size);
    const outside = classifyCell(8, size - 8, size, true);
    expect(Math.hypot(8 - center, size - 8 - center)).toBeGreaterThan(radius);
    expect(isFinder(8, size - 8, size)).toBe(false);
    expect(outside.kind).toBe("grass");
    expect(classifyCell(center, center, size, false).kind).toBe("path");
    expect(classifyCell(center + 3, center, size, true).kind).toBe("canopy");
    expect(Math.hypot(3, 0)).toBeGreaterThan(TRUNK_RADIUS);
  });
});

describe("buildMatrix", () => {
  it("rejects an empty link without throwing a QR error", () => {
    expect(buildMatrix("   ")).toEqual({
      ok: false,
      reason: "empty",
      message: "Add a link and the tree will grow.",
    });
  });

  it("rejects a link that would outgrow the plaza", () => {
    const result = buildMatrix("a".repeat(400));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too-long");
  });

  it("matches error correction H", () => {
    const text = "https://example.com/path?ref=canopy";
    const built = buildMatrix(text);
    const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.version).toBe(qr.version);
    expect(built.version).toBeLessThanOrEqual(10);
    expect(qr.errorCorrectionLevel.bit).toBe(2);
    for (let i = 0; i < built.modules.length; i++) {
      const row = Math.floor(i / built.size);
      const col = i % built.size;
      expect(built.modules[i]).toBe(qr.modules.get(row, col) === 1 ? 1 : 0);
    }
  });
});

describe("buildScene", () => {
  it("places one scannable cap on every cell", () => {
    const text = "https://example.com";
    const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
    const { blocks, grid, seen } = mosaic(text);
    const caps = blocks.filter((block) => block.cap);
    expect(caps).toHaveLength(grid * grid);
    expect(seen.size).toBe(grid * grid);
    const origin = (grid - 1) / 2;
    const size = qr.modules.size;
    for (const block of caps) {
      const col = Math.round(block.x + origin) - 4;
      const row = Math.round(block.z + origin) - 4;
      if (col < 0 || row < 0 || col >= size || row >= size) expect(block.dark).toBe(false);
      else expect(block.dark).toBe(qr.modules.get(row, col) === 1);
    }
    expect(blocks.some((block) => block.kind === "trunk" && block.structural)).toBe(true);
    expect(blocks.some((block) => !block.structural && block.kind === "canopy")).toBe(true);
    const patches = blocks.filter((block) => {
      if (block.kind !== "skirt" || block.cap) return false;
      const ix = block.x + origin;
      const iz = block.z + origin;
      return ix > 3 && iz > 3 && ix < grid - 4 && iz < grid - 4;
    });
    expect(patches.length).toBeGreaterThan(30);
  });

  it("decodes the flat mosaic back to the link", () => {
    for (const text of ["https://example.com", "https://example.com/path?ref=canopy&x=1"]) {
      const { data, n } = mosaic(text);
      expect(jsQR(data, n, n)?.data).toBe(text);
    }
  });

  it("is deterministic and reports empty input", () => {
    const first = buildScene("https://example.com");
    const second = buildScene("https://example.com");
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.scene.blocks).toEqual(second.scene.blocks);
    }
    expect(buildScene(" ").ok).toBe(false);
  });
});
