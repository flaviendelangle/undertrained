/** Preserve invalid or repeated scope params too: the destination validates them. */
export function legacyActivityRedirect(
  path: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const search = new URLSearchParams();
  for (const key of ["view", "rules", "display"]) {
    const value = query[key];
    if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
    else if (value !== undefined) search.set(key, value);
  }
  return search.size ? `${path}?${search}` : path;
}
