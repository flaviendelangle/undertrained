/**
 * Resolves a timeline of changes into the effective values at a target date.
 *
 * Walks through `changes` (assumed sorted ascending by `date`) and applies
 * each defined field, stopping once past `targetDate`.
 */
export function resolveTimeline<T extends object>(
  initialValues: { [K in keyof T]: T[K] },
  changes: ({ date: string } & { [K in keyof T]?: T[K] })[],
  targetDate: string,
): T {
  const result = { ...initialValues } as T;
  for (const change of changes) {
    if (change.date > targetDate) break;
    for (const key of Object.keys(change) as (keyof T | "date")[]) {
      if (key === "date") continue;
      if (change[key] !== undefined) {
        result[key] = change[key] as T[keyof T];
      }
    }
  }
  return result;
}
