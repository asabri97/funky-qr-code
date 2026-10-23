import type { Kind } from "../qr/scene";
import type { Season } from "./seasons";

export type { Season } from "./seasons";
export { SEASON_TINT, TINTS } from "./seasons";

export type RGB = [number, number, number];
export type Theme = "day" | "night";

const PATH: RGB[] = [
  [247, 241, 232],
  [232, 213, 183],
  [255, 253, 248],
];

const TRUNK: RGB[] = [
  [98, 62, 38],
  [64, 40, 26],
  [120, 78, 48],
];

const hexCache = new Map<string, RGB>();

export function writeHex(hex: string, out: RGB) {
  let cached = hexCache.get(hex);
  if (!cached) {
    const value = hex.replace("#", "");
    cached = [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
    hexCache.set(hex, cached);
  }
  out[0] = cached[0];
  out[1] = cached[1];
  out[2] = cached[2];
}

const DAY_FIELD: RGB = [255, 252, 246];
const DAY_LAWN: RGB = [28, 122, 54];
const NIGHT_FIELD: RGB = [8, 12, 22];
const NIGHT_FINDER: RGB = [214, 246, 255];
const NIGHT_INK: RGB = [150, 225, 255];

export function writeFlatColor(kind: Kind, dark: boolean, tint: string, out: RGB, theme: Theme = "day") {
  if (theme === "night") {
    if (!dark || kind === "path") {
      out[0] = NIGHT_FIELD[0];
      out[1] = NIGHT_FIELD[1];
      out[2] = NIGHT_FIELD[2];
      return;
    }
    const ink = kind === "finder" ? NIGHT_FINDER : NIGHT_INK;
    out[0] = ink[0];
    out[1] = ink[1];
    out[2] = ink[2];
    return;
  }
  if (!dark || kind === "path") {
    out[0] = DAY_FIELD[0];
    out[1] = DAY_FIELD[1];
    out[2] = DAY_FIELD[2];
    return;
  }
  if (kind === "canopy" || kind === "trunk") {
    writeHex(tint, out);
    darkenTo(out, 0.2);
    return;
  }
  out[0] = DAY_LAWN[0];
  out[1] = DAY_LAWN[1];
  out[2] = DAY_LAWN[2];
}

function darkenTo(out: RGB, maxLum: number) {
  if (luminance(out) <= maxLum) return;
  const src: RGB = [out[0], out[1], out[2]];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    out[0] = src[0] * mid;
    out[1] = src[1] * mid;
    out[2] = src[2] * mid;
    if (luminance(out) > maxLum) hi = mid;
    else lo = mid;
  }
  out[0] = src[0] * lo;
  out[1] = src[1] * lo;
  out[2] = src[2] * lo;
}

export function luminance(rgb: RGB) {
  const lin = (channel: number) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function mixToward(out: RGB, target: RGB, t: number) {
  out[0] += (target[0] - out[0]) * t;
  out[1] += (target[1] - out[1]) * t;
  out[2] += (target[2] - out[2]) * t;
}

function vary(out: RGB, shade: number, amount: number) {
  out[0] = clampChannel(out[0] + shade * amount);
  out[1] = clampChannel(out[1] + shade * amount);
  out[2] = clampChannel(out[2] + shade * amount);
}

function clampChannel(channel: number) {
  return Math.min(255, Math.max(0, channel));
}

function writeNightArt(kind: Kind, shade: number, layer: number, out: RGB) {
  if (kind === "skirt") {
    const base: RGB = shade > 0.2 ? [176, 164, 142] : [92, 98, 112];
    out[0] = base[0];
    out[1] = base[1];
    out[2] = base[2];
    vary(out, shade, 8);
    return;
  }
  if (kind === "canopy") {
    out[0] = 232;
    out[1] = 196;
    out[2] = 120;
    vary(out, shade, 14);
    return;
  }
  if (kind === "trunk") {
    const band = Math.abs(layer) % 2 === 0;
    out[0] = band ? 255 : 232;
    out[1] = band ? 210 : 168;
    out[2] = band ? 130 : 90;
    return;
  }
  if (shade > 0.78) {
    out[0] = 236;
    out[1] = 228;
    out[2] = 214;
  } else if (shade > 0.45) {
    out[0] = 206;
    out[1] = 158;
    out[2] = 86;
  } else if (shade > 0.12) {
    out[0] = 214;
    out[1] = 186;
    out[2] = 138;
  } else if (shade > -0.08) {
    out[0] = 20;
    out[1] = 28;
    out[2] = 46;
  } else if (shade > -0.5) {
    out[0] = 150;
    out[1] = 158;
    out[2] = 170;
  } else {
    out[0] = 176;
    out[1] = 142;
    out[2] = 78;
  }
  if (kind === "finder") {
    out[0] = clampChannel(out[0] + 10);
    out[1] = clampChannel(out[1] + 8);
    out[2] = clampChannel(out[2] + 4);
  }
  vary(out, shade, 8);
}

export function writeArtColor(
  kind: Kind,
  season: Season,
  tint: string,
  shade: number,
  layer: number,
  out: RGB,
  theme: Theme = "day",
) {
  if (theme === "night") {
    writeNightArt(kind, shade, layer, out);
    return;
  }
  if (kind === "path") {
    const base = PATH[Math.abs(Math.round(shade * 2)) % PATH.length];
    out[0] = base[0];
    out[1] = base[1];
    out[2] = base[2];
    vary(out, shade, 8);
    return;
  }
  if (kind === "trunk") {
    const base = TRUNK[Math.abs(layer) % TRUNK.length];
    out[0] = base[0];
    out[1] = base[1];
    out[2] = base[2];
    vary(out, shade, 8);
    return;
  }
  if (kind === "grass" || kind === "finder") {
    if (shade > 0.55) {
      out[0] = 221;
      out[1] = 185;
      out[2] = 109;
    } else {
      out[0] = shade > 0 ? 255 : 243;
      out[1] = shade > 0 ? 253 : 236;
      out[2] = shade > 0 ? 248 : 220;
    }
    vary(out, shade, 6);
    return;
  }
  if (kind === "skirt") {
    if (shade > 0.2 && season !== "winter") {
      writeHex(season === "spring" ? "#ef96af" : tint, out);
      mixToward(out, [255, 250, 252], 0.28);
    } else {
      const base: RGB = shade > 0.15 ? [111, 140, 86] : [78, 122, 64];
      out[0] = base[0];
      out[1] = base[1];
      out[2] = base[2];
    }
    if (season === "winter") mixToward(out, [232, 238, 236], 0.72);
    if (season === "autumn" && shade <= 0.42) mixToward(out, [196, 122, 58], 0.45);
    vary(out, shade, 10);
    return;
  }

  writeHex(tint, out);
  const pale = 0.42 + (shade * 0.5 + 0.5) * 0.38;
  mixToward(out, [255, 250, 252], pale);
  if (shade < -0.55) {
    out[0] *= 0.84;
    out[1] *= 0.72;
    out[2] *= 0.8;
  }
  if (season === "winter") mixToward(out, [236, 242, 244], 0.75);
  vary(out, shade, 12);
  out[0] = clampChannel(out[0]);
  out[1] = clampChannel(out[1]);
  out[2] = clampChannel(out[2]);
}

const scratch: RGB = [0, 0, 0];

export function writeBlockColor(
  kind: Kind,
  dark: boolean,
  season: Season,
  tint: string,
  shade: number,
  layer: number,
  contrast: number,
  out: RGB,
  theme: Theme = "day",
) {
  if (contrast >= 1) {
    writeFlatColor(kind, dark, tint, out, theme);
    return;
  }
  writeArtColor(kind, season, tint, shade, layer, out, theme);
  if (contrast <= 0) return;
  writeFlatColor(kind, dark, tint, scratch, theme);
  mixToward(out, scratch, contrast);
}
