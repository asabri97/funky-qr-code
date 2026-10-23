import type { Kind } from "../qr/scene";
import type { Season } from "./seasons";

export type { Season } from "./seasons";
export { SEASON_TINT, TINTS } from "./seasons";

export type RGB = [number, number, number];
export type Theme = "day" | "night";

const PATH: RGB[] = [
  [236, 226, 208],
  [223, 210, 188],
  [245, 237, 224],
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

const LAWN: RGB = [28, 122, 54];
const NIGHT_FIELD: RGB = [8, 12, 22];
const NIGHT_FINDER: RGB = [150, 225, 255];
const NIGHT_GLOW: RGB = [214, 246, 255];

export function writeFlatColor(kind: Kind, dark: boolean, tint: string, out: RGB, theme: Theme = "day") {
  if (theme === "night") {
    writeNightFlat(kind, dark, out);
    return;
  }
  if (!dark || kind === "path") {
    out[0] = 255;
    out[1] = 255;
    out[2] = 255;
    return;
  }
  if (kind === "grass" || kind === "finder" || kind === "skirt") {
    out[0] = LAWN[0];
    out[1] = LAWN[1];
    out[2] = LAWN[2];
    return;
  }
  writeHex(tint, out);
  darkenTo(out, 0.2);
}

function writeNightFlat(kind: Kind, dark: boolean, out: RGB) {
  if (!dark || kind === "path") {
    out[0] = NIGHT_FIELD[0];
    out[1] = NIGHT_FIELD[1];
    out[2] = NIGHT_FIELD[2];
    return;
  }
  const ink = kind === "canopy" || kind === "trunk" ? NIGHT_GLOW : NIGHT_FINDER;
  out[0] = ink[0];
  out[1] = ink[1];
  out[2] = ink[2];
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
    const icy = shade > 0.45;
    const base: RGB = icy ? [168, 186, 198] : shade > 0 ? [132, 122, 108] : [78, 74, 70];
    out[0] = base[0];
    out[1] = base[1];
    out[2] = base[2];
    vary(out, shade, 10);
    return;
  }
  if (kind === "canopy") {
    out[0] = 86;
    out[1] = 74;
    out[2] = 150;
    vary(out, shade, 12);
    return;
  }
  if (kind === "trunk") {
    const band = Math.abs(layer) % 2 === 0;
    out[0] = band ? 255 : 232;
    out[1] = band ? 196 : 150;
    out[2] = band ? 90 : 64;
    return;
  }
  const deck: RGB[] = [
    [24, 30, 48],
    [32, 40, 62],
    [18, 22, 36],
  ];
  const base = deck[Math.abs(Math.round(shade * 2)) % deck.length];
  out[0] = base[0];
  out[1] = base[1];
  out[2] = base[2];
  if (kind === "finder") {
    out[0] += 8;
    out[1] += 10;
    out[2] += 16;
  }
  vary(out, shade, 6);
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
    const light = shade > 0;
    out[0] = light ? 214 : 196;
    out[1] = light ? 208 : 190;
    out[2] = light ? 196 : 178;
    vary(out, shade, 6);
    return;
  }
  if (kind === "skirt") {
    const base: RGB = shade > 0.35 ? [186, 208, 92] : shade > -0.15 ? [78, 156, 58] : [46, 112, 42];
    out[0] = base[0];
    out[1] = base[1];
    out[2] = base[2];
    if (season === "winter") mixToward(out, [220, 226, 222], 0.7);
    vary(out, shade, 12);
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
