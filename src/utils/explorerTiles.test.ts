import { describe, expect, it } from "vitest";

import {
  type ClassifiedTile,
  type TileRange,
  buildTileIndex,
  forEachVisibleTile,
} from "./explorerTiles";

function tile(tx: number, ty: number): ClassifiedTile {
  return { tx, ty, category: "isolated" };
}

/** Collect every tile `forEachVisibleTile` yields for a range, order-independent. */
function query(
  tiles: ClassifiedTile[],
  range: TileRange,
  shift?: number,
): Set<string> {
  const index = buildTileIndex(tiles, shift);
  const seen = new Set<string>();
  forEachVisibleTile(index, range, (t) => seen.add(`${t.tx},${t.ty}`));
  return seen;
}

describe("buildTileIndex", () => {
  it("places each tile in exactly one bucket and keeps them all", () => {
    const tiles = [tile(0, 0), tile(63, 63), tile(64, 0), tile(200, 130)];
    const index = buildTileIndex(tiles, 6);

    // shift 6 → super-cells of 64: (0,0),(63,63) share "0,0"; (64,0)→"1,0"; (200,130)→"3,2"
    expect(index.buckets.size).toBe(3);
    expect(index.buckets.get("0,0")).toHaveLength(2);
    expect(index.buckets.get("1,0")).toHaveLength(1);
    expect(index.buckets.get("3,2")).toHaveLength(1);

    const total = [...index.buckets.values()].reduce(
      (n, b) => n + b.length,
      0,
    );
    expect(total).toBe(tiles.length);
  });
});

describe("forEachVisibleTile", () => {
  const tiles = [
    tile(5, 5),
    tile(10, 10),
    tile(70, 70),
    tile(70, 5),
    tile(500, 500),
  ];

  it("returns exactly the tiles inside the range", () => {
    const range: TileRange = { minTx: 0, maxTx: 64, minTy: 0, maxTy: 64 };
    expect(query(tiles, range)).toEqual(new Set(["5,5", "10,10"]));
  });

  it("includes tiles on the inclusive boundary", () => {
    const range: TileRange = { minTx: 70, maxTx: 70, minTy: 5, maxTy: 70 };
    expect(query(tiles, range)).toEqual(new Set(["70,70", "70,5"]));
  });

  it("returns nothing for an empty region", () => {
    const range: TileRange = {
      minTx: 1000,
      maxTx: 1100,
      minTy: 1000,
      maxTy: 1100,
    };
    expect(query(tiles, range)).toEqual(new Set());
  });

  it("returns every in-range tile via the zoomed-out fallback", () => {
    // A range spanning more super-cells than exist forces the full-bucket walk.
    const range: TileRange = {
      minTx: -100000,
      maxTx: 100000,
      minTy: -100000,
      maxTy: 100000,
    };
    expect(query(tiles, range)).toEqual(
      new Set(["5,5", "10,10", "70,70", "70,5", "500,500"]),
    );
  });

  it("agrees with a brute-force scan on a random-ish range", () => {
    const range: TileRange = { minTx: 8, maxTx: 75, minTy: 8, maxTy: 75 };
    const brute = new Set(
      tiles
        .filter(
          (t) =>
            t.tx >= range.minTx &&
            t.tx <= range.maxTx &&
            t.ty >= range.minTy &&
            t.ty <= range.maxTy,
        )
        .map((t) => `${t.tx},${t.ty}`),
    );
    expect(query(tiles, range)).toEqual(brute);
  });
});
