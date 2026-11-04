import * as React from "react";

import { CheckIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";

import { Draggable } from "@base-ui/react/draggable";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import type { SavedActivityView } from "~/hooks/useActivityView";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

export type ViewFolder = { id: number; name: string };
/** The views the page lists: every view, the ones without a folder, or a folder's. */
export type ViewScope = number | null | "all";

export const savedViewKind = Draggable.createKind<SavedActivityView>(
  "saved-activity-view",
);

export interface ScopeEntry {
  scope: ViewScope;
  label: string;
  count: number;
  /** Set on user folders, which can be renamed and deleted. */
  folder?: ViewFolder;
}

/** "All views", "Ungrouped", then one entry per folder, each with its view count. */
export function useScopeEntries(
  views: SavedActivityView[],
  folders: ViewFolder[],
): ScopeEntry[] {
  const t = useT();
  return [
    { scope: "all", label: t("views.allViews"), count: views.length },
    {
      scope: null,
      label: t("views.ungrouped"),
      count: views.filter((view) => view.folderId === null).length,
    },
    ...folders.map((folder) => ({
      scope: folder.id,
      label: folder.name,
      count: views.filter((view) => view.folderId === folder.id).length,
      folder,
    })),
  ];
}

export function FolderMenu({
  folder,
  trigger,
  onRename,
  onDelete,
}: {
  folder: ViewFolder;
  trigger: React.ReactElement;
  onRename: (folder: ViewFolder) => void;
  onDelete: (folder: ViewFolder) => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={trigger}
        aria-label={t("views.manageItem", { name: folder.name })}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={() => onRename(folder)}>
          {t("views.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onDelete(folder)}
        >
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The desktop folder column. Every entry but "All views" is a drop target:
 * dropping a view row on it moves the view there.
 */
export function ViewFolderSidebar({
  entries,
  selected,
  busy,
  onSelect,
  onMove,
  onNewFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  entries: ScopeEntry[];
  selected: ViewScope;
  busy: boolean;
  onSelect: (scope: ViewScope) => void;
  onMove: (view: SavedActivityView, folderId: number | null) => void;
  onNewFolder: () => void;
  onRenameFolder: (folder: ViewFolder) => void;
  onDeleteFolder: (folder: ViewFolder) => void;
}) {
  const t = useT();
  const renderEntry = (entry: ScopeEntry) => {
    const { scope, folder } = entry;
    const active = selected === scope;
    return (
      <Draggable.Target
        key={scope ?? "ungrouped"}
        accept={savedViewKind}
        disabled={busy || scope === "all"}
        canDrop={({ source }) => source.payload.folderId !== scope}
        onDraggableDrop={({ source }) => {
          if (scope !== "all") onMove(source.payload, scope);
        }}
        className="group/entry data-drag-over:bg-primary/10 data-drag-over:ring-primary relative flex h-9 shrink-0 items-center rounded-md data-drag-over:ring-2 data-drag-over:ring-inset"
      >
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={() => onSelect(scope)}
          className={cn(
            "focus-visible:ring-ring flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2",
            active
              ? "bg-accent text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          <span
            aria-hidden
            className={cn(
              "text-muted-foreground text-xs font-normal tabular-nums",
              // The folder menu takes the count's place on hover and focus.
              folder &&
                "group-focus-within/entry:invisible group-hover/entry:invisible group-has-data-popup-open/entry:invisible",
            )}
          >
            {entry.count}
          </span>
        </button>
        {folder && (
          <FolderMenu
            folder={folder}
            onRename={onRenameFolder}
            onDelete={onDeleteFolder}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground absolute right-0 opacity-0 group-focus-within/entry:opacity-100 group-hover/entry:opacity-100 data-popup-open:opacity-100"
              />
            }
          />
        )}
      </Draggable.Target>
    );
  };
  return (
    // The column scrolls itself while a view is dragged near its edges.
    <Draggable.Viewport
      accept={savedViewKind}
      render={<aside />}
      className="border-border flex w-56 shrink-0 flex-col overflow-y-auto border-r px-2 py-3"
    >
      <nav aria-label={t("views.folders")} className="flex flex-col gap-0.5">
        {entries.slice(0, 2).map(renderEntry)}
        <div className="mt-3 mb-1 flex h-6 items-center justify-between pl-2">
          <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            {t("views.folders")}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("views.newFolder")}
            title={t("views.newFolder")}
            onClick={onNewFolder}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
        {entries.slice(2).map(renderEntry)}
      </nav>
    </Draggable.Viewport>
  );
}

/** The mobile folder picker: the same entries in a bottom drawer. */
export function ViewFolderDrawer({
  entries,
  selected,
  onSelect,
  onNewFolder,
  onClose,
}: {
  entries: ScopeEntry[];
  selected: ViewScope;
  onSelect: (scope: ViewScope) => void;
  onNewFolder: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const item = (entry: ScopeEntry) => (
    <button
      key={entry.scope ?? "ungrouped"}
      type="button"
      aria-current={selected === entry.scope ? "page" : undefined}
      onClick={() => {
        onSelect(entry.scope);
        onClose();
      }}
      className="hover:bg-accent aria-[current=page]:text-foreground text-muted-foreground flex h-11 items-center gap-3 rounded-md px-2 text-left text-sm aria-[current=page]:font-medium"
    >
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      <span className="text-muted-foreground text-xs font-normal tabular-nums">
        {entry.count}
      </span>
      <CheckIcon
        className={cn(
          "text-primary size-4",
          selected !== entry.scope && "invisible",
        )}
      />
    </button>
  );
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent className="flex max-h-[80dvh] flex-col gap-2 px-4">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("views.folders")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <nav
          aria-label={t("views.folders")}
          className="flex min-h-0 flex-col overflow-y-auto pb-2"
        >
          {entries.slice(0, 2).map(item)}
          <span className="text-muted-foreground mt-3 mb-1 px-2 text-[10px] font-medium tracking-wide uppercase">
            {t("views.folders")}
          </span>
          {entries.slice(2).map(item)}
          <button
            type="button"
            onClick={() => {
              onClose();
              onNewFolder();
            }}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-11 items-center gap-2 rounded-md px-2 text-left text-sm"
          >
            <PlusIcon className="size-4" />
            {t("views.newFolder")}
          </button>
        </nav>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
