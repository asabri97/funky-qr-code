import { describe, expect, it } from "vitest";
import { buildMatrix, buildScene } from "./scene";
import { choosePoster, moduleTargets, paintPoster, posterFor, scrollPose } from "./poster";

const URL = "https://example.com";

function sceneFor(text: string) {
  const built = buildScene(text);
  if (!built.ok) throw new Error(built.message);
  return built.scene;
}

describe("scroll pose", () => {
  it("starts in the garden and settles on the code", () => {
    const start = scrollPose(0);
    const end = scrollPose(1);
    expect(start.tilt).toBe(0);
    expect(start.dissolve).toBe(0);
    expect(start.align).toBe(0);
    expect(start.settled).toBe(0);
    expect(end.tilt).toBe(1);
    expect(end.dissolve).toBe(1);
    expect(end.align).toBe(1);
    expect(end.settled).toBe(1);
  });

  it("is deterministic in both directions", () => {
    const down = [0, 0.2, 0.45, 0.75, 1].map((t) => scrollPose(t));
    const up = [1, 0.75, 0.45, 0.2, 0].map((t) => scrollPose(t));
    expect(scrollPose(0.45)).toEqual(scrollPose(0.45));
    expect(up[0]).toEqual(down[4]);
    expect(up[4]).toEqual(down[0]);
    expect(scrollPose(0.2).tilt).toBeGreaterThan(0);
    expect(scrollPose(0.2).dissolve).toBe(0);
    expect(scrollPose(0.5).align).toBeGreaterThan(0);
    expect(scrollPose(0.5).settled).toBe(0);
  });
});

describe("module targets", () => {
  it("keeps one target per module and matches the matrix", () => {
    const matrix = buildMatrix(URL);
    expect(matrix.ok).toBe(true);
    if (!matrix.ok) return;
    const scene = sceneFor(URL);
    const targets = moduleTargets(scene.blocks);
    expect(targets).toHaveLength(scene.grid * scene.grid);
    const seen = new Set(targets.map((target) => `${target.x},${target.z}`));
    expect(seen.size).toBe(targets.length);
    const dark = targets.filter((target) => target.dark).length;
    expect(dark).toBe(matrix.modules.reduce((sum, bit) => sum + bit, 0));
    const again = moduleTargets(sceneFor(URL).blocks);
    expect(again).toEqual(targets);
  });

  it("changes targets when the URL changes and keeps them when the palette would change", () => {
    const first = moduleTargets(sceneFor(URL).blocks);
    const second = moduleTargets(sceneFor("https://example.com/orbit").blocks);
    expect(second).not.toEqual(first);
    const spring = sceneFor(URL);
    const winter = sceneFor(URL);
    expect(moduleTargets(winter.blocks)).toEqual(moduleTargets(spring.blocks));
  });
});

describe("poster", () => {
  it("decodes the colored code for day and night", () => {
    const scene = sceneFor(URL);
    for (const theme of ["day", "night"] as const) {
      const poster = posterFor(scene.blocks, scene.grid, URL, "#e989a8", theme);
      expect(poster.scans).toBe(true);
      expect(poster.fallback).toBe(false);
      expect(poster.width).toBe(scene.grid * 8);
      expect(poster.height).toBe(poster.width);
    }
  });

  it("falls back to black on white when the colored render cannot be read", () => {
    const scene = sceneFor(URL);
    const broken = paintPoster(scene.blocks, scene.grid, "#e989a8", "day", true);
    broken.data.fill(128);
    const plain = paintPoster(scene.blocks, scene.grid, "#e989a8", "day", false);
    const poster = choosePoster(broken, plain, URL);
    expect(poster.fallback).toBe(true);
    expect(poster.scans).toBe(true);
    expect(poster.data[0]).toBe(255);
    const missed = posterFor(scene.blocks, scene.grid, "not-the-encoded-value", "#5f9a55", "day");
    expect(missed.fallback).toBe(true);
    expect(missed.scans).toBe(false);
  });

  it("leaves a quiet margin around the modules", () => {
    const scene = sceneFor(URL);
    const poster = paintPoster(scene.blocks, scene.grid, "#e989a8", "day", true);
    const margin = 4 * 8;
    const corner = poster.data[0];
    expect(corner).toBeGreaterThan(240);
    const inside = (margin - 1) * poster.width + (margin - 1);
    expect(poster.data[inside * 4]).toBe(corner);
    const night = paintPoster(scene.blocks, scene.grid, "#e989a8", "night", true);
    expect(night.data[0]).toBeLessThan(20);
  });
});
