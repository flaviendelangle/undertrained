import * as React from "react";

/**
 * True once `load` (a lazy module's loader, shared with its `nextDynamic`) has
 * settled, success or not, so a page can overlap module loading with its data
 * and gate the reveal on both. `load` must be stable (module-level).
 */
export function useModuleLoaded(load: () => Promise<unknown>): boolean {
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    void load().finally(() => {
      if (!cancelled) {
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);
  return loaded;
}
