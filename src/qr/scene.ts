import QRCode from "qrcode";

export const QUIET = 4;
export const MAX_VERSION = 10;
export const TRUNK_RADIUS = 1.65;
export const TRUNK_LAYERS = 8;
export const CANOPY_BASE = 8;
export const MAX_DOME_LAYERS = 9;

export type Kind = "path" | "grass" | "finder" | "trunk" | "canopy" | "skirt";

export type Block = {
  x: number;
  z: number;
  layer: number;
  height: number;
  kind: Kind;
  shade: number;
  dark: boolean;
  finder: boolean;
  structural: boolean;
  cap: boolean;
};

export type SceneModel = {
  blocks: Block[];
  grid: number;
  modules: number;
  version: number;
};

export type CellKind = "path" | "grass" | "finder" | "trunk" | "canopy";

export type CellClass = {
  kind: CellKind;
  layers: number;
  finder: boolean;
  dark: boolean;
};

export type Matrix =
  | {
      ok: true;
      size: number;
      version: number;
      quiet: number;
      modules: Uint8Array;
    }
  | { ok: false; reason: "empty" | "too-long"; message: string };

export type BuildResult =
  | { ok: true; scene: SceneModel }
  | { ok: false; reason: "empty" | "too-long"; message: string };

const EMPTY = "Add a link and the tree will grow.";
const TOO_LONG = "That link is too long for a small plaza.";

export function hash(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function canopyRadius(dataSize: number): number {
  const center = (dataSize - 1) / 2;
  const finderLimit = Math.hypot(center - 6, center - 6) - 0.65;
  const preferred = dataSize * 0.36;
  return Math.max(2.4, Math.min(preferred, finderLimit));
}

export function domeLayerCount(distance: number, radius: number, maxLayers = MAX_DOME_LAYERS): number {
  if (!(radius > 0) || !(maxLayers > 0) || distance >= radius) return 0;
  const height = Math.sqrt(Math.max(0, 1 - (distance / radius) ** 2));
  return Math.max(1, Math.round(height * maxLayers));
}

export function isFinder(col: number, row: number, dataSize: number): boolean {
  if (col < 0 || row < 0 || col >= dataSize || row >= dataSize) return false;
  const top = row <= 6;
  const bottom = row >= dataSize - 7;
  const left = col <= 6;
  const right = col >= dataSize - 7;
  return (top && left) || (top && right) || (bottom && left);
}

export function classifyCell(col: number, row: number, dataSize: number, dark: boolean): CellClass {
  const finder = isFinder(col, row, dataSize);
  if (!dark) return { kind: "path", layers: 1, finder, dark: false };
  if (finder) return { kind: "finder", layers: 1, finder: true, dark: true };
  const center = (dataSize - 1) / 2;
  const dist = Math.hypot(col - center, row - center);
  if (dist <= TRUNK_RADIUS) return { kind: "trunk", layers: TRUNK_LAYERS, finder: false, dark: true };
  const dome = domeLayerCount(dist, canopyRadius(dataSize));
  if (dome > 0) return { kind: "canopy", layers: dome, finder: false, dark: true };
  return { kind: "grass", layers: 1, finder: false, dark: true };
}

export function buildMatrix(text: string): Matrix {
  const value = text.trim();
  if (!value) return { ok: false, reason: "empty", message: EMPTY };
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: "H" });
    if (qr.version > MAX_VERSION) return { ok: false, reason: "too-long", message: TOO_LONG };
    const size = qr.modules.size;
    const modules = new Uint8Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) modules[row * size + col] = qr.modules.get(row, col) === 1 ? 1 : 0;
    }
    return { ok: true, size, version: qr.version, quiet: QUIET, modules };
  } catch {
    return { ok: false, reason: "too-long", message: TOO_LONG };
  }
}

export function buildScene(text: string): BuildResult {
  const matrix = buildMatrix(text);
  if (!matrix.ok) return matrix;
  const { size, version, modules } = matrix;
  const grid = size + QUIET * 2;
  const origin = (grid - 1) / 2;
  const center = (size - 1) / 2;
  const radius = canopyRadius(size);
  const blocks: Block[] = [];

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dark = modules[row * size + col] === 1;
      const x = col + QUIET - origin;
      const z = row + QUIET - origin;
      const shade = hash(col, row) * 2 - 1;
      const cell = classifyCell(col, row, size, dark);
      const dist = Math.hypot(col - center, row - center);

      if (cell.kind === "finder") {
        pushColumn(blocks, x, z, "finder", 0, 1, 0.2, shade, true, true, true, true);
        continue;
      }
      if (cell.kind === "grass") {
        pushColumn(blocks, x, z, "grass", 0, 1, 0.2, shade, true, false, true, true);
        continue;
      }
      if (!dark) pushColumn(blocks, x, z, "path", 0, 1, 0.2, shade, false, cell.finder, true, true);

      if (cell.kind === "trunk" || cell.kind === "canopy" || (!cell.finder && dist < radius)) {
        const dome = foliageLayers(col, row, dist, radius);
        if (dark && dome > 0) {
          const lift = Math.floor((MAX_DOME_LAYERS - dome) * 0.7);
          pushBlossoms(blocks, x, z, CANOPY_BASE + lift, dome, shade, true);
        } else if (!dark && dome > 0 && hash(col + 5, row + 2) > 0.48) {
          pushBlossoms(blocks, x, z, CANOPY_BASE + Math.floor(dome * 0.45), 1, shade, false);
        }
      }
    }
  }

  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      if (ix >= QUIET && ix < QUIET + size && iz >= QUIET && iz < QUIET + size) continue;
      pushColumn(blocks, ix - origin, iz - origin, "path", 0, 1, 0.2, hash(ix, iz) * 2 - 1, false, false, true, true);
    }
  }

  const skirt = 2;
  for (let iz = -skirt; iz < grid + skirt; iz++) {
    for (let ix = -skirt; ix < grid + skirt; ix++) {
      const outside = ix < 0 || ix >= grid || iz < 0 || iz >= grid;
      const sx = ix - origin;
      const sz = iz - origin;
      if (sx * sx + sz * sz < 5.5) continue;
      const rim = ix < 3 || iz < 3 || ix >= grid - 3 || iz >= grid - 3;
      const patch = hash((ix / 3) | 0, (iz / 3) | 0) > 0.4;
      if (!outside && !rim && !patch) continue;
      if (outside && hash(ix + 11, iz + 3) < 0.04) continue;
      if (!outside && rim && hash(ix + 19, iz + 2) < 0.12) continue;
      if (!outside && !rim && hash(ix + 8, iz + 2) < 0.2) continue;
      const lean = hash(ix, iz) * 2 - 1;
      const height = 0.5 + hash(ix + 2, iz + 9) * 0.7;
      pushColumn(blocks, sx, sz, "skirt", 0, 1, height, lean, false, false, false, false);
      if (hash(ix + 4, iz + 8) > 0.28) {
        pushColumn(
          blocks,
          sx + (hash(ix + 1, iz + 5) - 0.5) * 0.55,
          sz + (hash(ix + 6, iz + 3) - 0.5) * 0.55,
          "skirt",
          0,
          1,
          height * 0.72,
          -lean,
          false,
          false,
          false,
          false,
        );
      }
    }
  }

  for (let i = 0; i < TRUNK_LAYERS; i++) {
    pushColumn(blocks, 0, 0, "trunk", i, 1, 0.7, i % 2 === 0 ? 0.45 : -0.45, false, false, false, false);
  }
  pushColumn(blocks, 0, 0, "trunk", 0, 1, 0.05, 0, true, false, true, false);
  pushBranches(blocks, radius);

  return { ok: true, scene: { blocks, grid, modules: size, version } };
}

function foliageLayers(col: number, row: number, distance: number, radius: number): number {
  const dome = domeLayerCount(distance, radius);
  if (dome <= 0) return 0;
  const edge = distance / radius;
  const jitter = edge > 0.48 ? Math.round((hash(col + 9, row + 4) - 0.42) * 3) : 0;
  return Math.max(1, dome + jitter);
}

function pushBlossoms(blocks: Block[], x: number, z: number, start: number, count: number, shade: number, dark: boolean) {
  if (count <= 0) return;
  if (count > 1) pushColumn(blocks, x, z, "canopy", start, count - 1, 0.64, shade, dark, false, false, false);
  pushColumn(blocks, x, z, "canopy", start + count - 1, 1, 0.7, shade, dark, false, dark, dark);
}

function pushBranches(blocks: Block[], radius: number) {
  const arms = 7;
  for (let i = 0; i < arms; i++) {
    const angle = (i / arms) * Math.PI * 2 + 0.4;
    const reach = radius * (0.58 + (i % 3) * 0.12);
    const steps = Math.max(4, Math.round(reach));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = Math.cos(angle) * reach * t;
      const z = Math.sin(angle) * reach * t;
      const layer = CANOPY_BASE + Math.round(t * MAX_DOME_LAYERS * 0.72);
      pushColumn(blocks, x, z, "trunk", layer, 1, 1, i % 2 === 0 ? 0.25 : -0.35, false, false, false, false);
    }
  }
}

function pushColumn(
  blocks: Block[],
  x: number,
  z: number,
  kind: Kind,
  start: number,
  count: number,
  height: number,
  shade: number,
  dark: boolean,
  finder: boolean,
  structural: boolean,
  capTop: boolean,
) {
  for (let i = 0; i < count; i++) {
    blocks.push({
      x,
      z,
      layer: start + i,
      height,
      kind,
      shade: shade * 0.75 + (hash(Math.round(x * 3 + i), Math.round(z * 5 + start)) * 2 - 1) * 0.25,
      dark,
      finder,
      structural,
      cap: capTop && i === count - 1,
    });
  }
}
