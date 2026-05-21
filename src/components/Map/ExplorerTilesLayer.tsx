import * as React from "react";

import * as L from "leaflet";
import { useMap } from "react-leaflet";

import {
  type ClassifiedTile,
  type ExplorerTilesResult,
  type TileCategory,
  type TileIndex,
  type TileRange,
  buildTileIndex,
  forEachVisibleTile,
  pointToTile,
  tileToBounds,
} from "~/utils/explorerTiles";

const PANE_NAME = "explorerTilesPane";
const PANE_Z_INDEX = "250";
const FILL_OPACITY = 0.35;
/** Stroke a tile only once it is at least this wide on screen (CSS px). */
const MIN_STROKE_PX = 3;
/** Extra viewport margin, as a fraction of map size, matching Leaflet renderers. */
const PADDING = 0.1;

const TILE_COLORS: Record<TileCategory, { fill: string; stroke: string }> = {
  maxSquare: { fill: "#7c3aed", stroke: "#6d28d9" },
  cluster: { fill: "#3b82f6", stroke: "#2563eb" },
  clusterBorder: { fill: "#93c5fd", stroke: "#60a5fa" },
  isolated: { fill: "#f87171", stroke: "#ef4444" },
};

const CATEGORIES = Object.keys(TILE_COLORS) as TileCategory[];

/** Get the tile coordinate range visible in the current map viewport (+1 buffer). */
function getVisibleTileRange(map: L.Map): TileRange {
  const bounds = map.getBounds();
  const nw = pointToTile(bounds.getNorth(), bounds.getWest());
  const se = pointToTile(bounds.getSouth(), bounds.getEast());
  return {
    minTx: Math.min(nw.tx, se.tx) - 1,
    maxTx: Math.max(nw.tx, se.tx) + 1,
    minTy: Math.min(nw.ty, se.ty) - 1,
    maxTy: Math.max(nw.ty, se.ty) + 1,
  };
}

/** Leaflet map internals not surfaced by @types/leaflet but stable in 1.9.x. */
type MapInternals = L.Map & {
  _animatingZoom?: boolean;
  _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point;
};

/**
 * A Leaflet layer that paints classified explorer tiles directly onto a single
 * canvas. It mirrors the container/transform bookkeeping of Leaflet's own
 * `L.Canvas` renderer (so it pans and zoom-animates smoothly), but draws filled
 * rectangles with `ctx.fillRect` grouped by category instead of allocating one
 * `L.Rectangle` per tile. Visible tiles are found via a spatial index, so a
 * redraw costs O(visible tiles) rather than O(all tiles).
 */
class ExplorerTilesCanvas extends L.Layer {
  private _index: TileIndex | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _bounds: L.Bounds | null = null;
  private _center: L.LatLng | null = null;
  private _zoom = 0;
  private _zoomAnimated = false;

  constructor(tilesData: ExplorerTilesResult | null) {
    super();
    this._applyData(tilesData);
  }

  private _applyData(tilesData: ExplorerTilesResult | null) {
    this._index = tilesData ? buildTileIndex(tilesData.tiles) : null;
  }

  setData(tilesData: ExplorerTilesResult | null) {
    this._applyData(tilesData);
    if (this._map) this._update();
  }

  override onAdd(map: L.Map): this {
    if (!map.getPane(PANE_NAME)) {
      map.createPane(PANE_NAME).style.zIndex = PANE_Z_INDEX;
    }
    const canvas = L.DomUtil.create("canvas");
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    this._canvas = canvas;
    this._ctx = canvas.getContext("2d");

    this._zoomAnimated = map.options.zoomAnimation === true && L.Browser.any3d;
    if (this._zoomAnimated) {
      L.DomUtil.addClass(canvas, "leaflet-zoom-animated");
    }
    map.getPane(PANE_NAME)?.appendChild(canvas);
    this._reset();
    return this;
  }

  override onRemove(): this {
    if (this._canvas) L.DomUtil.remove(this._canvas);
    this._canvas = null;
    this._ctx = null;
    return this;
  }

  override getEvents(): Record<string, L.LeafletEventHandlerFn> {
    const events: Record<string, L.LeafletEventHandlerFn> = {
      viewreset: () => this._reset(),
      moveend: () => this._update(),
      zoom: () => this._onZoom(),
      zoomend: () => this._update(),
      resize: () => this._update(),
    };
    if (this._zoomAnimated) {
      events.zoomanim = (ev) => this._onAnimZoom(ev as L.ZoomAnimEvent);
    }
    return events;
  }

  private _onAnimZoom(ev: L.ZoomAnimEvent) {
    this._updateTransform(ev.center, ev.zoom);
  }

  private _onZoom() {
    if (!this._map) return;
    this._updateTransform(this._map.getCenter(), this._map.getZoom());
  }

  // Slide/scale the canvas during a zoom so already-drawn pixels track the map
  // until the crisp redraw at zoom end. Ported from L.Renderer._updateTransform.
  private _updateTransform(center: L.LatLng, zoom: number) {
    const map = this._map as MapInternals | undefined;
    if (!map || !this._canvas || !this._center) return;

    const scale = map.getZoomScale(zoom, this._zoom);
    const viewHalf = map.getSize().multiplyBy(0.5 + PADDING);
    const currentCenterPoint = map.project(this._center, this._zoom);
    const topLeftOffset = viewHalf
      .multiplyBy(-scale)
      .add(currentCenterPoint)
      .subtract(map._getNewPixelOrigin(center, zoom));

    if (L.Browser.any3d) {
      L.DomUtil.setTransform(this._canvas, topLeftOffset, scale);
    } else {
      L.DomUtil.setPosition(this._canvas, topLeftOffset);
    }
  }

  private _reset() {
    this._update();
    if (this._center) this._updateTransform(this._center, this._zoom);
  }

  // Recompute the canvas bounds/size and repaint. Skipped mid-zoom-animation
  // (the CSS transform handles that), matching L.Canvas._update.
  private _update() {
    const map = this._map as MapInternals | undefined;
    const canvas = this._canvas;
    const ctx = this._ctx;
    if (!map || !canvas || !ctx) return;
    if (map._animatingZoom && this._bounds) return;

    const size = map.getSize();
    const min = map
      .containerPointToLayerPoint(size.multiplyBy(-PADDING))
      .round();
    const max = min.add(size.multiplyBy(1 + PADDING * 2)).round();
    const bounds = L.bounds(min, max);
    this._bounds = bounds;
    this._center = map.getCenter();
    this._zoom = map.getZoom();

    const bSize = max.subtract(min);
    const dpr = L.Browser.retina ? 2 : 1;
    L.DomUtil.setPosition(canvas, min);
    canvas.width = dpr * bSize.x;
    canvas.height = dpr * bSize.y;
    canvas.style.width = `${bSize.x}px`;
    canvas.style.height = `${bSize.y}px`;
    // Resizing the canvas resets its transform; re-establish DPR scaling and a
    // translate so we can draw in layer-point coordinates.
    if (dpr !== 1) ctx.scale(dpr, dpr);
    ctx.translate(-min.x, -min.y);

    this._draw(map, ctx, min, bSize);
  }

  private _draw(map: L.Map, ctx: CanvasRenderingContext2D, min: L.Point, size: L.Point) {
    ctx.clearRect(min.x, min.y, size.x, size.y);

    const index = this._index;
    if (!index) return;

    // Group visible tiles by category so fillStyle is set only once per color.
    const byCategory: Record<TileCategory, ClassifiedTile[]> = {
      maxSquare: [],
      cluster: [],
      clusterBorder: [],
      isolated: [],
    };
    forEachVisibleTile(index, getVisibleTileRange(map), (tile) => {
      byCategory[tile.category].push(tile);
    });

    ctx.globalAlpha = FILL_OPACITY;
    ctx.lineWidth = 0.5;
    for (const category of CATEGORIES) {
      const tiles = byCategory[category];
      if (tiles.length === 0) continue;

      const colors = TILE_COLORS[category];
      ctx.fillStyle = colors.fill;
      ctx.strokeStyle = colors.stroke;
      for (const tile of tiles) {
        const tb = tileToBounds(tile.tx, tile.ty);
        const nw = map.latLngToLayerPoint([tb.north, tb.west]);
        const se = map.latLngToLayerPoint([tb.south, tb.east]);
        const x = Math.round(nw.x);
        const y = Math.round(nw.y);
        const w = Math.round(se.x) - x;
        const h = Math.round(se.y) - y;
        ctx.fillRect(x, y, w, h);
        if (w >= MIN_STROKE_PX) ctx.strokeRect(x, y, w, h);
      }
    }
    ctx.globalAlpha = 1;
  }
}

interface ExplorerTilesLayerProps {
  tilesData: ExplorerTilesResult | null;
  visible: boolean;
}

export function ExplorerTilesLayer({
  tilesData,
  visible,
}: ExplorerTilesLayerProps) {
  const map = useMap();
  const layerRef = React.useRef<ExplorerTilesCanvas | null>(null);
  const tilesDataRef = React.useRef(tilesData);
  React.useEffect(() => {
    tilesDataRef.current = tilesData;
  });

  // Create the layer once per map, seeded with the latest data.
  React.useEffect(() => {
    const layer = new ExplorerTilesCanvas(tilesDataRef.current);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  // Push tile data into the layer when it changes.
  React.useEffect(() => {
    layerRef.current?.setData(tilesData);
  }, [tilesData]);

  // Show/hide based on the visible prop.
  React.useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    if (visible) {
      layer.addTo(map);
    } else {
      layer.remove();
    }
  }, [visible, map]);

  return null;
}
