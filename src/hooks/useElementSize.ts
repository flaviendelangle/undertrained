import * as React from "react";

/**
 * The content-box size of `ref`'s element, tracked with a `ResizeObserver`.
 * Both values are 0 until the first observation lands (after mount) and are
 * the unrounded `contentRect` dimensions. The element is read once on mount,
 * so it must be rendered from the first commit and stay the same node.
 */
export function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = React.useState(0);
  const [height, setHeight] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
        setHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return { width, height };
}
