import type { LatLngTuple } from "./polyline";

// --- Standard OSM slippy map tiles at zoom level 14 ---
// This matches the tile system used by StatShunters, RideEveryTile, etc.

const ZOOM = 14;
const N = 2 ** ZOOM; // 16384

/** Convert longitude to fractional tile X coordinate. */
function lngToTileX(lng: number): number {
  return ((lng + 180) / 360) * N;
}

/** Convert latitude to fractional tile Y coordinate. */
function latToTileY(lat: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * N
  );
}

export function pointToTile(
  lat: number,
  lng: number,
): { tx: number; ty: number } {
  return {
    tx: Math.floor(lngToTileX(lng)),
    ty: Math.floor(latToTileY(lat)),
  };
}

export function tileToBounds(
  tx: number,
  ty: number,
): { south: number; west: number; north: number; east: number } {
  return {
    west: (tx / N) * 360 - 180,
    east: ((tx + 1) / N) * 360 - 180,
    north: Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / N))) * (180 / Math.PI),
    south:
      Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 1)) / N))) *
      (180 / Math.PI),
  };
}

// --- Tile key helpers ---

type TileKey = string;

export function tileKey(tx: number, ty: number): TileKey {
  return `${tx},${ty}`;
}

function parseTileKey(key: TileKey): { tx: number; ty: number } {
  const sep = key.indexOf(",");
  return {
    tx: Number(key.slice(0, sep)),
    ty: Number(key.slice(sep + 1)),
  };
}

// --- Tile discovery ---

const MAX_SEGMENT_DISTANCE_DEG = 0.5; // ~55 km — skip GPS teleportation glitches

/**
 * Walk a line segment in tile coordinate space and collect every grid cell
 * the segment passes through using the Amanatides & Woo grid traversal
 * (DDA / Bresenham-like line rasterization) algorithm.
 */
function walkTiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  visited: Set<TileKey>,
): void {
  const fracTileStartX = lngToTileX(lng1);
  const fracTileStartY = latToTileY(lat1);
  const fracTileEndX = lngToTileX(lng2);
  const fracTileEndY = latToTileY(lat2);

  const startTx = Math.floor(fracTileStartX);
  const startTy = Math.floor(fracTileStartY);
  const endTx = Math.floor(fracTileEndX);
  const endTy = Math.floor(fracTileEndY);

  visited.add(tileKey(startTx, startTy));

  if (startTx === endTx && startTy === endTy) return;

  const dfx = fracTileEndX - fracTileStartX;
  const dfy = fracTileEndY - fracTileStartY;

  const stepX = dfx > 0 ? 1 : dfx < 0 ? -1 : 0;
  const stepY = dfy > 0 ? 1 : dfy < 0 ? -1 : 0;

  // Parameter at which the ray crosses the next vertical/horizontal tile boundary
  let nextCrossingX: number;
  // Parameter increment per tile in X/Y direction
  let crossingStepX: number;
  if (stepX !== 0) {
    const nextBoundary = stepX > 0 ? startTx + 1 : startTx;
    nextCrossingX = (nextBoundary - fracTileStartX) / dfx;
    crossingStepX = Math.abs(1 / dfx);
  } else {
    nextCrossingX = Infinity;
    crossingStepX = Infinity;
  }

  let nextCrossingY: number;
  let crossingStepY: number;
  if (stepY !== 0) {
    const nextBoundary = stepY > 0 ? startTy + 1 : startTy;
    nextCrossingY = (nextBoundary - fracTileStartY) / dfy;
    crossingStepY = Math.abs(1 / dfy);
  } else {
    nextCrossingY = Infinity;
    crossingStepY = Infinity;
  }

  let currentTileX = startTx;
  let currentTileY = startTy;
  const maxSteps = Math.abs(endTx - startTx) + Math.abs(endTy - startTy) + 2;

  for (let i = 0; i < maxSteps; i++) {
    if (nextCrossingX < nextCrossingY) {
      currentTileX += stepX;
      nextCrossingX += crossingStepX;
    } else if (nextCrossingY < nextCrossingX) {
      currentTileY += stepY;
      nextCrossingY += crossingStepY;
    } else {
      // Line passes exactly through a tile corner — visit both adjacent tiles
      // before making a diagonal step
      visited.add(tileKey(currentTileX + stepX, currentTileY));
      visited.add(tileKey(currentTileX, currentTileY + stepY));
      currentTileX += stepX;
      currentTileY += stepY;
      nextCrossingX += crossingStepX;
      nextCrossingY += crossingStepY;
    }
    visited.add(tileKey(currentTileX, currentTileY));
    if (currentTileX === endTx && currentTileY === endTy) break;
  }
}

export function discoverTiles(polylines: LatLngTuple[][]): Set<TileKey> {
  const visited = new Set<TileKey>();

  for (const polyline of polylines) {
    if (polyline.length === 0) continue;

    const [lat0, lng0] = polyline[0];
    const t0 = pointToTile(lat0, lng0);
    visited.add(tileKey(t0.tx, t0.ty));

    for (let i = 1; i < polyline.length; i++) {
      const [prevLat, prevLng] = polyline[i - 1];
      const [curLat, curLng] = polyline[i];

      // Skip GPS dropouts
      if (
        Math.abs(curLat - prevLat) > MAX_SEGMENT_DISTANCE_DEG ||
        Math.abs(curLng - prevLng) > MAX_SEGMENT_DISTANCE_DEG
      ) {
        const t = pointToTile(curLat, curLng);
        visited.add(tileKey(t.tx, t.ty));
        continue;
      }

      walkTiles(prevLat, prevLng, curLat, curLng, visited);
    }
  }

  return visited;
}

// --- Connected components (BFS, 4-connectivity) ---

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface ConnectedComponent {
  tiles: Set<TileKey>;
  size: number;
}

export function findConnectedComponents(
  visited: Set<TileKey>,
): ConnectedComponent[] {
  const seen = new Set<TileKey>();
  const components: ConnectedComponent[] = [];

  for (const key of visited) {
    if (seen.has(key)) continue;

    const component = new Set<TileKey>();
    const stack: TileKey[] = [key];
    seen.add(key);

    while (stack.length > 0) {
      const current = stack.pop()!;
      component.add(current);
      const { tx, ty } = parseTileKey(current);

      for (const [dx, dy] of NEIGHBORS_4) {
        const nk = tileKey(tx + dx, ty + dy);
        if (visited.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }

    components.push({ tiles: component, size: component.size });
  }

  components.sort((a, b) => b.size - a.size);
  return components;
}

// --- Largest axis-aligned square (DP) ---

export interface MaxSquareResult {
  side: number;
  tiles: Set<TileKey>;
}

export function findMaxSquare(clusterTiles: Set<TileKey>): MaxSquareResult {
  if (clusterTiles.size === 0) {
    return { side: 0, tiles: new Set() };
  }

  let minTx = Infinity;
  let maxTx = -Infinity;
  let minTy = Infinity;
  let maxTy = -Infinity;

  for (const key of clusterTiles) {
    const { tx, ty } = parseTileKey(key);
    if (tx < minTx) minTx = tx;
    if (tx > maxTx) maxTx = tx;
    if (ty < minTy) minTy = ty;
    if (ty > maxTy) maxTy = ty;
  }

  const width = maxTx - minTx + 1;
  const height = maxTy - minTy + 1;

  // Flat DP array for cache friendliness
  const dp = new Int32Array(width * height);

  let bestSide = 0;
  let bestRow = 0;
  let bestCol = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ty = minTy + row;
      const tx = minTx + col;

      if (!clusterTiles.has(tileKey(tx, ty))) {
        continue; // dp stays 0
      }

      const idx = row * width + col;

      if (row === 0 || col === 0) {
        dp[idx] = 1;
      } else {
        dp[idx] =
          Math.min(
            dp[(row - 1) * width + col],
            dp[row * width + (col - 1)],
            dp[(row - 1) * width + (col - 1)],
          ) + 1;
      }

      if (dp[idx] > bestSide) {
        bestSide = dp[idx];
        bestRow = row;
        bestCol = col;
      }
    }
  }

  const squareTiles = new Set<TileKey>();
  const originTx = minTx + bestCol - bestSide + 1;
  const originTy = minTy + bestRow - bestSide + 1;
  for (let dy = 0; dy < bestSide; dy++) {
    for (let dx = 0; dx < bestSide; dx++) {
      squareTiles.add(tileKey(originTx + dx, originTy + dy));
    }
  }

  return { side: bestSide, tiles: squareTiles };
}

// --- Tile classification ---

export type TileCategory =
  | "maxSquare"
  | "cluster"
  | "clusterBorder"
  | "isolated";

export interface ClassifiedTile {
  tx: number;
  ty: number;
  category: TileCategory;
}

export interface ExplorerTilesResult {
  tiles: ClassifiedTile[];
  stats: {
    totalVisited: number;
    maxSquareSide: number;
    largestClusterSize: number;
    clusterCount: number;
  };
}

export function classifyTiles(
  visited: Set<TileKey>,
  components: ConnectedComponent[],
  maxSquare: MaxSquareResult,
): ClassifiedTile[] {
  const largestCluster = components[0]?.tiles ?? new Set<TileKey>();
  const result: ClassifiedTile[] = [];

  for (const key of visited) {
    const { tx, ty } = parseTileKey(key);

    let category: TileCategory;

    if (maxSquare.tiles.has(key)) {
      category = "maxSquare";
    } else if (!largestCluster.has(key)) {
      category = "isolated";
    } else {
      const allNeighborsVisited = NEIGHBORS_4.every(([dx, dy]) =>
        visited.has(tileKey(tx + dx, ty + dy)),
      );
      category = allNeighborsVisited ? "cluster" : "clusterBorder";
    }

    result.push({ tx, ty, category });
  }

  return result;
}

/**
 * Full pipeline: polylines → classified tiles with stats.
 */
export function computeExplorerTiles(
  polylines: LatLngTuple[][],
): ExplorerTilesResult {
  const visited = discoverTiles(polylines);

  if (visited.size === 0) {
    return {
      tiles: [],
      stats: {
        totalVisited: 0,
        maxSquareSide: 0,
        largestClusterSize: 0,
        clusterCount: 0,
      },
    };
  }

  const components = findConnectedComponents(visited);
  const maxSquare = findMaxSquare(components[0]?.tiles ?? new Set());
  const classified = classifyTiles(visited, components, maxSquare);

  return {
    tiles: classified,
    stats: {
      totalVisited: visited.size,
      maxSquareSide: maxSquare.side,
      largestClusterSize: components[0]?.size ?? 0,
      clusterCount: components.length,
    },
  };
}

// --- Spatial index for fast viewport queries ---

/**
 * Number of bits to shift a tile coordinate to get its super-cell coordinate.
 * Each super-cell groups a (2^shift) x (2^shift) block of zoom-14 tiles
 * (64 x 64 here), so a viewport query iterates only the buckets it overlaps
 * instead of scanning every tile.
 */
export const SUPER_CELL_SHIFT = 6;

/** An inclusive tile-coordinate rectangle, in zoom-14 tile units. */
export interface TileRange {
  minTx: number;
  maxTx: number;
  minTy: number;
  maxTy: number;
}

/** Tiles bucketed by super-cell for O(visible) viewport queries. */
export interface TileIndex {
  buckets: Map<string, ClassifiedTile[]>;
  shift: number;
}

/** Group tiles into a super-cell bucket grid for fast viewport queries. */
export function buildTileIndex(
  tiles: ClassifiedTile[],
  shift: number = SUPER_CELL_SHIFT,
): TileIndex {
  const buckets = new Map<string, ClassifiedTile[]>();
  for (const tile of tiles) {
    const key = tileKey(tile.tx >> shift, tile.ty >> shift);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(tile);
    } else {
      buckets.set(key, [tile]);
    }
  }
  return { buckets, shift };
}

/** Whether a tile falls inside an inclusive tile range. */
export function isTileInRange(
  tx: number,
  ty: number,
  range: TileRange,
): boolean {
  return (
    tx >= range.minTx &&
    tx <= range.maxTx &&
    ty >= range.minTy &&
    ty <= range.maxTy
  );
}

/**
 * Invoke `cb` for every indexed tile inside `range`. Iterates only the
 * super-cells the range overlaps, except when the range spans more super-cells
 * than the index contains (zoomed far out) — then it walks every bucket
 * directly, which is never worse than a full scan.
 */
export function forEachVisibleTile(
  index: TileIndex,
  range: TileRange,
  cb: (tile: ClassifiedTile) => void,
): void {
  const { buckets, shift } = index;
  const minSx = range.minTx >> shift;
  const maxSx = range.maxTx >> shift;
  const minSy = range.minTy >> shift;
  const maxSy = range.maxTy >> shift;
  const spanCount = (maxSx - minSx + 1) * (maxSy - minSy + 1);

  const visit = (bucket: ClassifiedTile[]) => {
    for (const tile of bucket) {
      if (isTileInRange(tile.tx, tile.ty, range)) cb(tile);
    }
  };

  if (spanCount >= buckets.size) {
    for (const bucket of buckets.values()) visit(bucket);
    return;
  }

  for (let sx = minSx; sx <= maxSx; sx++) {
    for (let sy = minSy; sy <= maxSy; sy++) {
      const bucket = buckets.get(tileKey(sx, sy));
      if (bucket) visit(bucket);
    }
  }
}
