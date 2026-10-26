export interface ViewGroup<TView> {
  key: string;
  /** `null` when the picker is flat because no view sits in a folder. */
  label: string | null;
  views: TView[];
}

/**
 * Groups saved views for the view pickers: one group per non-empty folder,
 * then the views without a folder under `ungroupedLabel`. When no view is in a
 * folder, a single unlabelled group keeps the list flat.
 */
export function groupViewsByFolder<TView extends { folderId: number | null }>(
  views: TView[],
  folders: { id: number; name: string }[],
  ungroupedLabel: string,
): ViewGroup<TView>[] {
  const ungrouped = views.filter((view) => view.folderId === null);
  const groups = folders
    .map((folder) => ({
      key: String(folder.id),
      label: folder.name,
      views: views.filter((view) => view.folderId === folder.id),
    }))
    .filter((group) => group.views.length > 0);
  if (!groups.length)
    return [{ key: "ungrouped", label: null, views: ungrouped }];
  if (ungrouped.length)
    groups.push({ key: "ungrouped", label: ungroupedLabel, views: ungrouped });
  return groups;
}
