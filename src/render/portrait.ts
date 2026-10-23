import type { RGB } from "./palette";

export type PortraitCell = {
  x: number;
  y: number;
  z: number;
  size: number;
  color: RGB;
};

const SPAN = 16;
const COLUMNS = 34;

export function samplePortrait(pixels: Uint8ClampedArray, width: number, height: number): PortraitCell[] {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return [];
  let clear = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] >= 20) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      } else clear += 1;
    }
  }
  const cutout = clear > width * height * 0.04 && maxX >= minX;
  const originX = cutout ? minX : 0;
  const originY = cutout ? minY : 0;
  const cropW = cutout ? maxX - minX + 1 : width;
  const cropH = cutout ? maxY - minY + 1 : height;
  const columns = COLUMNS;
  const rows = Math.max(1, Math.min(48, Math.round(columns * (cropH / cropW))));
  const size = (SPAN / Math.max(columns, rows)) * 0.94;
  const step = SPAN / Math.max(columns, rows);
  const cells: PortraitCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const sx = Math.min(width - 1, originX + Math.floor(((col + 0.5) * cropW) / columns));
      const sy = Math.min(height - 1, originY + Math.floor(((row + 0.5) * cropH) / rows));
      const index = (sy * width + sx) * 4;
      const alpha = pixels[index + 3];
      if (cutout && alpha < 20) continue;
      const color: RGB = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const lift = (color[0] + color[1] + color[2]) / (3 * 255);
      cells.push({
        x: (col - (columns - 1) / 2) * step,
        y: (rows - 1 - row) * step + size / 2,
        z: (lift - 0.5) * step * 2.4,
        size,
        color,
      });
    }
  }
  return cells;
}

export type Hologram = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

const MAX_TEX = 512;

export function sampleHologram(pixels: Uint8ClampedArray, width: number, height: number): Hologram | null {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return null;
  let clear = 0;
  let dark = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let subjectMinX = width;
  let subjectMinY = height;
  let subjectMaxX = 0;
  let subjectMaxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const alpha = pixels[index + 3];
      const lum = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / (3 * 255);
      if (alpha < 20) clear += 1;
      else if (lum < 0.07) dark += 1;
      if (alpha >= 20) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (alpha >= 20 && lum >= 0.07) {
        subjectMinX = Math.min(subjectMinX, x);
        subjectMinY = Math.min(subjectMinY, y);
        subjectMaxX = Math.max(subjectMaxX, x);
        subjectMaxY = Math.max(subjectMaxY, y);
      }
    }
  }
  if (maxX < minX) return null;
  const cutout = clear > width * height * 0.04;
  const dropDark = dark > width * height * 0.12;
  const focus = dropDark && subjectMaxX >= subjectMinX;
  const originX = cutout ? minX : focus ? subjectMinX : 0;
  const originY = cutout ? minY : focus ? subjectMinY : 0;
  let cropW = cutout ? maxX - minX + 1 : focus ? subjectMaxX - subjectMinX + 1 : width;
  let cropH = cutout ? maxY - minY + 1 : focus ? subjectMaxY - subjectMinY + 1 : height;
  if (cropH > cropW * 1.6) cropH = Math.max(cropW, Math.round(cropW * 1.35));
  return blit(pixels, width, height, originX, originY, cropW, cropH);
}

function blit(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  originX: number,
  originY: number,
  cropW: number,
  cropH: number,
): Hologram {
  const scale = Math.min(1, MAX_TEX / Math.max(cropW, cropH));
  const width = Math.max(1, Math.round(cropW * scale));
  const height = Math.max(1, Math.round(cropH * scale));
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, originX + Math.floor(((x + 0.5) * cropW) / width));
      const sy = Math.min(sh - 1, originY + Math.floor(((y + 0.5) * cropH) / height));
      const from = (sy * sw + sx) * 4;
      const to = (y * width + x) * 4;
      pixels[to] = src[from];
      pixels[to + 1] = src[from + 1];
      pixels[to + 2] = src[from + 2];
      pixels[to + 3] = src[from + 3];
    }
  }
  return { pixels, width, height };
}
