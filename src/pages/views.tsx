import * as React from "react";

import {
  FolderIcon,
  FolderOpenIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PlusIcon,
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
import { ViewDetailsDialog } from "~/components/views/ViewDetailsDialog";
import {
  type SavedActivityView,
  useActivityView,
} from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { trpc } from "~/utils/trpc";

type Folder = { id: number; name: string };
const savedViewKind = Draggable.createKind<SavedActivityView>(
  "saved-activity-view",
);
type Action =
  | {
      [K in "edit" | "duplicate" | "delete"]: {
        kind: K;
        view: SavedActivityView;
      };
    }["edit" | "duplicate" | "delete"]
  | { kind: "folder"; folder?: Folder }
  | { kind: "deleteFolder"; folder: Folder };

const ViewsPage: NextPageWithLayout = () => {
  const t = useT();
  const scope = useActivityView();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const [folderId, setFolderId] = React.useState<number | null | "all">("all");
  const [action, setAction] = React.useState<Action | null>(null);
  const counts = trpc.views.counts.useQuery({ athleteId, today: scope.today });
  const onSuccess = async () => {
    await Promise.all([
      utils.views.list.invalidate(),
      utils.views.listFolders.invalidate(),
      utils.views.counts.invalidate(),
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
      setFolderId("all");
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
  const folders = [
    { id: "all" as const, name: t("views.allViews") },
    { id: null, name: t("views.ungrouped") },
    ...scope.folders,
  ];
  const currentFolder = scope.folders.find((f) => f.id === folderId);
  const filteredViews = scope.views.filter(
    (view) => folderId === "all" || view.folderId === folderId,
  );
  return (
    <Draggable.Provider>
      <PageToolbar title={t("views.title")} icon={FolderOpenIcon} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
        <aside className="border-border flex shrink-0 flex-col gap-1 border-b p-3 md:w-56 md:border-r md:border-b-0">
          <Draggable.Viewport
            accept={savedViewKind}
            render={<nav aria-label={t("views.folder")} />}
            className="flex gap-1 overflow-x-auto p-1 md:flex-col"
          >
            {folders.map((folder) => (
              <Draggable.Target
                key={folder.id ?? "ungrouped"}
                accept={savedViewKind}
                disabled={busy || folder.id === "all"}
                canDrop={({ source }) => source.payload.folderId !== folder.id}
                onDraggableDrop={({ source }) => {
                  if (folder.id === "all") return;
                  const view = source.payload;
                  update.mutate({
                    athleteId,
                    id: view.id,
                    name: view.name,
                    folderId: folder.id,
                    rules: view.rules,
                    display: view.display,
                  });
                }}
                render={
                  <Button
                    variant={folderId === folder.id ? "secondary" : "ghost"}
                  />
                }
                aria-current={folderId === folder.id ? "page" : undefined}
                className="data-drag-over:bg-primary/10 data-drag-over:ring-primary justify-start data-drag-over:ring-2 data-drag-over:ring-inset"
                onClick={() => setFolderId(folder.id)}
              >
                <FolderIcon />
                <span className="truncate">{folder.name}</span>
              </Draggable.Target>
            ))}
          </Draggable.Viewport>
          <Button
            variant="ghost"
            className="justify-start"
            onClick={() => setAction({ kind: "folder" })}
          >
            <PlusIcon />
            {t("views.newFolder")}
          </Button>
          <p className="text-muted-foreground hidden pt-3 text-xs md:block">
            {t("views.folderHelp")}
          </p>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-xl font-semibold">
              {folders.find((f) => f.id === folderId)?.name ?? t("views.title")}
            </h2>
            {currentFolder && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("views.folder")}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onClick={() =>
                      setAction({ kind: "folder", folder: currentFolder })
                    }
                  >
                    {t("views.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      setAction({ kind: "deleteFolder", folder: currentFolder })
                    }
                  >
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              nativeButton={false}
              render={<Link href="/activities?edit=filters" />}
            >
              <PlusIcon />
              {t("views.newView")}
            </Button>
          </div>
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
          ) : !filteredViews.length ? (
            <QueryState>
              <p>{t("views.empty")}</p>
            </QueryState>
          ) : (
            <ul className="divide-border border-border divide-y rounded-lg border">
              {filteredViews.map((view) => (
                <Draggable.Root
                  key={view.id}
                  kind={savedViewKind}
                  payload={view}
                  disabled={busy}
                  render={<li />}
                  className="hover:bg-muted/30 flex items-center gap-2 p-3 data-dragging:opacity-40 md:p-4"
                >
                  <Draggable.Handle
                    render={
                      <Button variant="ghost" size="icon-sm" disabled={busy} />
                    }
                    aria-label={t("views.moveView", { name: view.name })}
                    className="text-muted-foreground cursor-grab touch-none active:cursor-grabbing"
                    onClick={() => setAction({ kind: "edit", view })}
                  >
                    <GripVerticalIcon />
                  </Draggable.Handle>
                  <Link
                    className="min-w-0 flex-1"
                    href={scope.viewHref(view.id)}
                  >
                    <span className="block truncate font-medium">
                      {view.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {view.folderId === null
                        ? t("views.ungrouped")
                        : scope.folders.find((f) => f.id === view.folderId)
                            ?.name}
                      {counts.data?.[view.id] !== undefined
                        ? ` · ${t("views.activities", { count: counts.data[view.id] })}`
                        : ""}
                    </span>
                  </Link>
                  <div className="hidden gap-2 text-xs md:flex">
                    <Link
                      className="text-muted-foreground hover:text-foreground p-2"
                      href={scope.viewHref(view.id, "/activities/charts")}
                    >
                      {t("nav.statistics")}
                    </Link>
                    <Link
                      className="text-muted-foreground hover:text-foreground p-2"
                      href={scope.viewHref(view.id, "/activities/map")}
                    >
                      {t("nav.map")}
                    </Link>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`${t("views.manage")} ${view.name}`}
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-max min-w-44">
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onClick={() => setAction({ kind: "edit", view })}
                      >
                        {t("views.rename")} / {t("views.move")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setAction({ kind: "duplicate", view })}
                      >
                        {t("views.duplicate")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setAction({ kind: "delete", view })}
                      >
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Draggable.Preview
                    offset={({ container }) => ({
                      x: container.getBoundingClientRect().width / 2,
                      y: -8,
                    })}
                    className="bg-popover text-popover-foreground border-border pointer-events-none w-max max-w-64 truncate rounded-md border px-2.5 py-1.5 text-sm font-medium shadow-md"
                  >
                    {view.name}
                  </Draggable.Preview>
                </Draggable.Root>
              ))}
            </ul>
          )}
        </main>
      </div>
      {action && (action.kind === "edit" || action.kind === "duplicate") && (
        <ViewDetailsDialog
          title={t(action.kind === "edit" ? "views.rename" : "views.duplicate")}
          initialName={
            action.view.name +
            (action.kind === "duplicate" ? ` (${t("views.copy")})` : "")
          }
          initialFolder={action.view.folderId}
          busy={busy}
          onClose={() => setAction(null)}
          onSave={(name, folderId) => {
            const fields = {
              athleteId,
              name,
              folderId,
              rules: action.view.rules,
              display: action.view.display,
            };
            if (action.kind === "edit")
              update.mutate({ ...fields, id: action.view.id });
            else create.mutate(fields);
          }}
        />
      )}
      {action?.kind === "folder" && (
        <FolderDialog
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

function FolderDialog({
  initial,
  busy,
  onClose,
  onSave,
}: {
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
          <ResponsiveDialogTitle>
            {t(initial ? "views.rename" : "views.newFolder")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("views.folderHelp")}
          </ResponsiveDialogDescription>
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
