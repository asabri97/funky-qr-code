import jsQR from "jsqr";
import { writeFlatColor, type RGB, type Theme } from "../render/palette";
import type { Block } from "./scene";

export const POSTER_SCALE = 8;

export type Poster = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  scans: boolean;
  fallback: boolean;
};

export type ModuleTarget = {
  x: number;
  z: number;
  kind: Block["kind"];
  dark: boolean;
};

export function scrollPose(progress: number) {
  const t = clamp01(progress);
  return {
    t,
    tilt: smoothstep(0, 0.2, t),
    dissolve: smoothstep(0.2, 0.45, t),
    align: smoothstep(0.45, 0.75, t),
    settled: t >= 1 ? 1 : smoothstep(0.75, 1, t),
  };
}

export function moduleTargets(blocks: Block[]): ModuleTarget[] {
  const targets: ModuleTarget[] = [];
  for (const block of blocks) {
    if (!block.cap) continue;
    targets.push({ x: block.x, z: block.z, kind: block.kind, dark: block.dark });
  }
  return targets;
}

export function paintPoster(blocks: Block[], grid: number, tint: string, theme: Theme, artistic: boolean) {
  const n = grid * POSTER_SCALE;
  const data = new Uint8ClampedArray(n * n * 4);
  const ink: RGB = [255, 255, 255];
  const paint = (kind: Block["kind"], dark: boolean) => {
    if (!artistic) {
      const value = dark ? 0 : 255;
      ink[0] = value;
      ink[1] = value;
      ink[2] = value;
      return;
    }
    writeFlatColor(kind, dark, tint, ink, theme);
  };
  paint("path", false);
  for (let i = 0; i < n * n; i++) {
    const offset = i * 4;
    data[offset] = ink[0];
    data[offset + 1] = ink[1];
    data[offset + 2] = ink[2];
    data[offset + 3] = 255;
  }
  const origin = (grid - 1) / 2;
  for (const block of blocks) {
    if (!block.cap) continue;
    paint(block.kind, block.dark);
    const ix = Math.round(block.x + origin);
    const iz = Math.round(block.z + origin);
    if (ix < 0 || iz < 0 || ix >= grid || iz >= grid) continue;
    for (let py = 0; py < POSTER_SCALE; py++) {
      for (let px = 0; px < POSTER_SCALE; px++) {
        const offset = ((iz * POSTER_SCALE + py) * n + (ix * POSTER_SCALE + px)) * 4;
        data[offset] = ink[0];
        data[offset + 1] = ink[1];
        data[offset + 2] = ink[2];
        data[offset + 3] = 255;
      }
    }
  }
  return { data, width: n, height: n };
}

export function choosePoster(
  artistic: { data: Uint8ClampedArray; width: number; height: number },
  plain: { data: Uint8ClampedArray; width: number; height: number },
  text: string,
): Poster {
  if (reads(artistic.data, artistic.width, artistic.height, text)) {
    return { ...artistic, scans: true, fallback: false };
  }
  return { ...plain, scans: reads(plain.data, plain.width, plain.height, text), fallback: true };
}

export function posterFor(blocks: Block[], grid: number, text: string, tint: string, theme: Theme): Poster {
  return choosePoster(
    paintPoster(blocks, grid, tint, theme, true),
    paintPoster(blocks, grid, tint, theme, false),
    text,
  );
}

function reads(data: Uint8ClampedArray, width: number, height: number, text: string) {
  return jsQR(data, width, height)?.data === text;
}

function clamp01(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
