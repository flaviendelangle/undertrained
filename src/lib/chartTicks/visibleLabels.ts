// Overlap-aware tick label utilities, modeled on MUI X's
// `batchMeasureStrings` (packages/x-charts/src/internals/domUtils.ts) and
// `getVisibleLabels` (packages/x-charts/src/ChartsXAxis/getVisibleLabels.tsx),
// trimmed to what the custom WebGL charts in this repo actually need:
// horizontal (un-rotated) labels on a single x-axis.

export interface LabelStyle {
  fontSize: number;
  fontFamily?: string;
}

export interface LabelSize {
  width: number;
  height: number;
}

const MAX_CACHE_SIZE = 2000;
const sizeCache = new Map<string, LabelSize>();

let measurementSvg: SVGSVGElement | null = null;

function styleKey(style: LabelStyle) {
  return `${style.fontSize}px ${style.fontFamily ?? "inherit"}`;
}

function getMeasurementSvg(): SVGSVGElement {
  if (measurementSvg !== null) return measurementSvg;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.top = "-20000px";
  svg.style.left = "0";
  svg.style.padding = "0";
  svg.style.margin = "0";
  svg.style.border = "none";
  svg.style.pointerEvents = "none";
  svg.style.visibility = "hidden";
  svg.style.contain = "strict";
  document.body.appendChild(svg);
  measurementSvg = svg;
  return svg;
}

/**
 * Measure a batch of label strings using a hidden SVG `<text>` and `getBBox()`.
 * Results are cached keyed by `(text, style)`; the cache clears when it exceeds
 * MAX_CACHE_SIZE. Returns zero sizes during SSR.
 */
export function measureTickLabels(
  labels: Iterable<string>,
  style: LabelStyle,
): Map<string, LabelSize> {
  const result = new Map<string, LabelSize>();
  if (typeof document === "undefined") {
    for (const label of labels) result.set(label, { width: 0, height: 0 });
    return result;
  }

  const key = styleKey(style);
  const pending: string[] = [];

  for (const label of labels) {
    if (result.has(label)) continue;
    const cached = sizeCache.get(`${label}|${key}`);
    if (cached) {
      result.set(label, cached);
    } else {
      result.set(label, { width: 0, height: 0 }); // placeholder, replaced below
      pending.push(label);
    }
  }

  if (pending.length === 0) return result;

  const svg = getMeasurementSvg();
  const elements = pending.map((label) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
    node.style.fontSize = `${style.fontSize}px`;
    if (style.fontFamily) node.style.fontFamily = style.fontFamily;
    node.textContent = label;
    return node;
  });
  svg.replaceChildren(...elements);

  for (let i = 0; i < pending.length; i++) {
    const label = pending[i];
    const node = elements[i];
    let size: LabelSize;
    try {
      const bbox = node.getBBox();
      size = { width: bbox.width, height: bbox.height };
    } catch {
      const rect = node.getBoundingClientRect();
      size = { width: rect.width, height: rect.height };
    }
    result.set(label, size);
    sizeCache.set(`${label}|${key}`, size);
  }

  if (sizeCache.size > MAX_CACHE_SIZE) sizeCache.clear();

  return result;
}

export interface FilterVisibleLabelsOptions<T> {
  getPosition: (tick: T) => number;
  getLabel: (tick: T) => string;
  sizes: Map<string, LabelSize>;
  minGap?: number;
}

/**
 * Given a list of ticks sorted left-to-right by position, return the subset
 * whose horizontally-centered labels do not overlap (with a `minGap` of
 * separation). Tick marks and gridlines are the caller's responsibility — this
 * only decides which *labels* to render.
 *
 * If a label's measured width is 0 (e.g. first frame, before measurement has
 * run), the tick is accepted as if it had no width. This matches the
 * `isMounted: false` branch in MUI X's `getVisibleLabels` and keeps the initial
 * paint readable until the measurement effect catches up.
 */
export function filterVisibleLabels<T>(
  ticks: T[],
  opts: FilterVisibleLabelsOptions<T>,
): Set<T> {
  const { getPosition, getLabel, sizes, minGap = 4 } = opts;
  const visible = new Set<T>();
  let prevRight = -Infinity;

  for (const tick of ticks) {
    const position = getPosition(tick);
    const label = getLabel(tick);
    const width = sizes.get(label)?.width ?? 0;
    const half = width / 2;
    const left = position - half;
    if (left < prevRight + minGap) continue;
    visible.add(tick);
    prevRight = position + half;
  }

  return visible;
}
