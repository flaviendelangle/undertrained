import * as React from "react";

import {
  ChevronDownIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import Link from "next/link";

import { Draggable } from "@base-ui/react/draggable";

import { PageToolbar } from "~/components/layouts/PageToolbar";
import { QueryState } from "~/components/primitives/QueryState";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { showErrorToast } from "~/components/ui/toast";
import { viewInputClass } from "~/components/views/ActivityFilterEditor";
import {
  type SavedViewActions,
  SavedViewCards,
  SavedViewTable,
} from "~/components/views/SavedViewList";
import { ViewDetailsDialog } from "~/components/views/ViewDetailsDialog";
import {
  type ViewFolder,
  ViewFolderDrawer,
  ViewFolderSidebar,
  type ViewScope,
  useScopeEntries,
} from "~/components/views/ViewFolderNav";
import { groupViewsByFolder } from "~/components/views/groupViewsByFolder";
import {
  type SavedActivityView,
  useActivityView,
} from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

const NEW_VIEW_HREF = "/activities?edit=filters";

type Action =
  | {
      [K in "rename" | "duplicate" | "delete"]: {
        kind: K;
        view: SavedActivityView;
      };
    }["rename" | "duplicate" | "delete"]
  | { kind: "folder"; folder?: ViewFolder }
  | { kind: "deleteFolder"; folder: ViewFolder };

const ViewsPage: NextPageWithLayout = () => {
  const t = useT();
  const scope = useActivityView();
  const athleteId = useAthleteId();
  const isMobile = useIsMobile();
  const utils = trpc.useUtils();
  const [selected, setSelected] = React.useState<ViewScope>("all");
  const [action, setAction] = React.useState<Action | null>(null);
  const [folderDrawer, setFolderDrawer] = React.useState(false);
  const mainRef = React.useRef<HTMLElement>(null);
  const stats = trpc.views.stats.useQuery({ athleteId, today: scope.today });
  const onSuccess = async () => {
    await Promise.all([
      utils.views.list.invalidate(),
      utils.views.listFolders.invalidate(),
      utils.views.stats.invalidate(),
    ]);
    setAction(null);
  };
  const options = {
    onSuccess,
    onError: () => showErrorToast(t("common.saveError")),
  };
  const update = trpc.views.update.useMutation(options);
  const create = trpc.views.create.useMutation(options);
  const remove = trpc.views.delete.useMutation(options);
  const createFolder = trpc.views.createFolder.useMutation(options);
  const renameFolder = trpc.views.renameFolder.useMutation(options);
  const deleteFolder = trpc.views.deleteFolder.useMutation({
    ...options,
    onSuccess: async () => {
      setSelected("all");
      await onSuccess();
    },
  });
  const busy =
    update.isPending ||
    create.isPending ||
    remove.isPending ||
    createFolder.isPending ||
    renameFolder.isPending ||
    deleteFolder.isPending;
  const entries = useScopeEntries(scope.views, scope.folders);
  // A folder deleted elsewhere falls back to every view.
  const current =
    entries.find((entry) => entry.scope === selected) ?? entries[0];
  const views = scope.views.filter(
    (view) => current.scope === "all" || view.folderId === current.scope,
  );
  const groups =
    current.scope === "all"
      ? groupViewsByFolder(views, scope.folders, t("views.ungrouped"))
      : [{ key: "scope", label: null, views }];
  const save = (
    view: SavedActivityView,
    changes: { name?: string; folderId?: number | null },
  ) =>
    update.mutate({
      athleteId,
      id: view.id,
      name: view.name,
      folderId: view.folderId,
      rules: view.rules,
      display: view.display,
      ...changes,
    });
  const actions: SavedViewActions = {
    href: (view, path) => scope.viewHref(view.id, path),
    onRename: (view) => setAction({ kind: "rename", view }),
    onDuplicate: (view) => setAction({ kind: "duplicate", view }),
    onDelete: (view) => setAction({ kind: "delete", view }),
    onMove: (view, folderId) => save(view, { folderId }),
  };
  const folderActions = {
    onRename: (folder: ViewFolder) => setAction({ kind: "folder", folder }),
    onDelete: (folder: ViewFolder) =>
      setAction({ kind: "deleteFolder", folder }),
  };
  const listProps = {
    groups,
    stats: stats.data,
    folders: scope.folders,
    today: scope.today,
    busy,
    actions,
  };
  // One menu for the page: the scope bar stays a title and a single trigger.
  const folder = current.folder;
  const pageActions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          isMobile ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("views.actions")}
              className="text-muted-foreground"
            />
          ) : (
            <Button variant="outline" className="ml-auto" />
          )
        }
      >
        {isMobile ? (
          <MoreHorizontalIcon />
        ) : (
          <>
            {t("views.actions")}
            <ChevronDownIcon />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-48">
        <DropdownMenuLinkItem render={<Link href={NEW_VIEW_HREF} />}>
          {t("views.newView")}
        </DropdownMenuLinkItem>
        <DropdownMenuItem onClick={() => setAction({ kind: "folder" })}>
          {t("views.newFolder")}
        </DropdownMenuItem>
        {folder && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => folderActions.onRename(folder)}>
              {t("views.renameFolder")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => folderActions.onDelete(folder)}
            >
              {t("views.deleteFolder")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Draggable.Provider>
      <PageToolbar title={t("views.title")} icon={FolderOpenIcon} />
      <div className="flex min-h-0 flex-1">
        {!isMobile && (
          <ViewFolderSidebar
            entries={entries}
            selected={current.scope}
            busy={busy}
            onSelect={setSelected}
            onMove={actions.onMove}
            onNewFolder={() => setAction({ kind: "folder" })}
            onRenameFolder={folderActions.onRename}
            onDeleteFolder={folderActions.onDelete}
          />
        )}
        <main ref={mainRef} className="@container flex min-w-0 flex-1 flex-col">
          {isMobile ? (
            <div className="border-border flex shrink-0 items-center gap-1 border-b px-3 py-2">
              <Button
                variant="ghost"
                aria-haspopup="dialog"
                className="h-10 min-w-0 flex-1 justify-start gap-1.5 px-1 text-left"
                onClick={() => setFolderDrawer(true)}
              >
                <span className="truncate">{current.label}</span>
                <ChevronDownIcon className="text-muted-foreground ml-auto" />
              </Button>
              {pageActions}
            </div>
          ) : (
            <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-3">
              <h2 className="min-w-0 truncate text-sm font-medium">
                {current.label}
              </h2>
              {pageActions}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {stats.isError && !stats.data && views.length > 0 && (
              <div
                role="alert"
                className="text-muted-foreground border-border flex items-center gap-2 border-b px-4 py-2 text-sm"
              >
                {t("views.statsError")}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void stats.refetch()}
                >
                  {t("common.retry")}
                </Button>
              </div>
            )}
            {scope.viewsQuery.isError || scope.foldersQuery.isError ? (
              <QueryState
                error
                onRetry={() => {
                  void scope.viewsQuery.refetch();
                  void scope.foldersQuery.refetch();
                }}
              />
            ) : scope.viewsQuery.isLoading || scope.foldersQuery.isLoading ? (
              <QueryState loading />
            ) : !views.length ? (
              <QueryState>
                <p>
                  {t(
                    !scope.views.length
                      ? "views.empty"
                      : current.scope === null
                        ? "views.emptyUngrouped"
                        : "views.emptyFolder",
                  )}
                </p>
              </QueryState>
            ) : isMobile ? (
              <SavedViewCards {...listProps} />
            ) : (
              <SavedViewTable {...listProps} previewContainer={mainRef} />
            )}
          </div>
        </main>
      </div>
      {folderDrawer && (
        <ViewFolderDrawer
          entries={entries}
          selected={current.scope}
          onSelect={setSelected}
          onClose={() => setFolderDrawer(false)}
        />
      )}
      {action?.kind === "rename" && (
        <NameDialog
          title={t("views.rename")}
          initial={action.view.name}
          busy={busy}
          onClose={() => setAction(null)}
          onSave={(name) => save(action.view, { name })}
        />
      )}
      {action?.kind === "duplicate" && (
        <ViewDetailsDialog
          title={t("views.duplicate")}
          initialName={`${action.view.name} (${t("views.copy")})`}
          initialFolder={action.view.folderId}
          busy={busy}
          onClose={() => setAction(null)}
          onSave={(name, folderId) =>
            create.mutate({
              athleteId,
              name,
              folderId,
              rules: action.view.rules,
              display: action.view.display,
            })
          }
        />
      )}
      {action?.kind === "folder" && (
        <NameDialog
          title={t(action.folder ? "views.rename" : "views.newFolder")}
          description={t("views.folderHelp")}
          initial={action.folder?.name ?? ""}
          busy={busy}
          onClose={() => setAction(null)}
          onSave={(name) =>
            action.folder
              ? renameFolder.mutate({ athleteId, id: action.folder.id, name })
              : createFolder.mutate({ athleteId, name })
          }
        />
      )}
      {action &&
        (action.kind === "delete" || action.kind === "deleteFolder") && (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setAction(null);
            }}
            title={t("common.deleteConfirmTitle", {
              name:
                action.kind === "delete"
                  ? action.view.name
                  : action.folder.name,
            })}
            description={t(
              action.kind === "delete"
                ? "views.deleteViewHelp"
                : "views.deleteFolderHelp",
            )}
            confirmLabel={t("common.delete")}
            pendingLabel={t("common.deleting")}
            onConfirm={() =>
              action.kind === "delete"
                ? remove.mutateAsync({ athleteId, id: action.view.id })
                : deleteFolder.mutateAsync({ athleteId, id: action.folder.id })
            }
          />
        )}
    </Draggable.Provider>
  );
};

/** Names a folder, or renames a folder or a view. */
function NameDialog({
  title,
  description,
  initial,
  busy,
  onClose,
  onSave,
}: {
  title: string;
  description?: string;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = React.useState(initial);
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          {description && (
            <ResponsiveDialogDescription>
              {description}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onSave(name.trim());
          }}
        >
          <label className="flex flex-col gap-2 text-sm">
            {t("views.name")}
            <input
              autoFocus
              required
              maxLength={100}
              className={viewInputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {t("views.save")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
export default ViewsPage;
