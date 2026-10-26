import * as React from "react";

import {
  ChevronDownIcon,
  FilterIcon,
  FolderOpenIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/router";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { QueryState } from "~/components/primitives/QueryState";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { SelectTrigger, SelectValue } from "~/components/ui/select";
import { useActivityView } from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useT } from "~/i18n/useT";
import { type ActivityDisplay, conditionCount } from "~/utils/activityFilters";
import { trpc } from "~/utils/trpc";

import { ActivityDisplayEditor } from "./ActivityDisplayEditor";
import { ActivityFilterEditor } from "./ActivityFilterEditor";
import { MobileViewDrawer } from "./MobileViewDrawer";
import { ViewDetailsDialog } from "./ViewDetailsDialog";
import { ViewPicker } from "./ViewPicker";
import { useSaveActivityView } from "./useSaveActivityView";

export function SharedViewBar({ table = false }: { table?: boolean }) {
  const t = useT();
  const router = useRouter();
  const scope = useActivityView();
  const athleteId = useAthleteId();
  const isMobile = useIsMobile();
  const [panel, setPanel] = React.useState<
    "view" | "filters" | "save" | "display" | null
  >(null);
  const editorRequested =
    router.isReady && router.query.edit === "filters" && scope.ready;
  const closeEditor = () => {
    setPanel(null);
    if (router.query.edit === "filters") {
      const query = { ...router.query };
      delete query.edit;
      void router.replace({ pathname: router.pathname, query }, undefined, {
        shallow: true,
      });
    }
  };
  const save = useSaveActivityView(() => setPanel(null));
  const summary = trpc.views.summary.useQuery(
    { athleteId, rules: scope.rules, today: scope.today },
    { enabled: scope.ready },
  );
  const count = conditionCount(scope.rules);
  const title =
    scope.view?.name ??
    t(scope.hasChanges ? "views.unsaved" : "views.allActivities");
  const stateLabel = scope.hasChanges
    ? t(scope.view ? "views.modified" : "views.unsaved")
    : null;
  const picker = (
    <ViewPicker>
      <ToolbarPrimitive.Button
        render={<SelectTrigger />}
        aria-label={t("views.title")}
        className="w-64 min-w-0 font-medium"
      >
        <SelectValue>
          {scope.view?.name ?? t("views.allActivities")}
        </SelectValue>
      </ToolbarPrimitive.Button>
    </ViewPicker>
  );
  const filters = (
    <ToolbarPrimitive.Button
      render={<Button variant="outline" />}
      aria-label={`${t("views.editFilters")}${count ? ` (${count})` : ""}`}
      disabled={!scope.ready}
      onClick={() => setPanel("filters")}
    >
      <FilterIcon />
      <span>{t("views.editFilters")}</span>
      {count > 0 && (
        <span className="bg-muted rounded px-1.5 text-xs tabular-nums">
          {count}
        </span>
      )}
    </ToolbarPrimitive.Button>
  );
  const state = stateLabel && (
    <span role="status" className="flex items-center gap-1.5 text-xs">
      <span className="size-1.5 rounded-full bg-amber-500" />
      {stateLabel}
    </span>
  );
  const actions = (
    <ToolbarPrimitive.Group
      className="flex items-center gap-2"
      aria-label={t("views.manage")}
    >
      {scope.hasChanges && (
        <ToolbarPrimitive.Button
          render={<Button variant="outline" />}
          onClick={() => void scope.reset()}
        >
          <RotateCcwIcon />
          {t(scope.view ? "views.reset" : "views.clear")}
        </ToolbarPrimitive.Button>
      )}
      {scope.modified && scope.view && (
        <ToolbarPrimitive.Button
          render={<Button />}
          disabled={save.busy}
          onClick={() => save.update(scope.view!, scope.rules, scope.display)}
        >
          {t("views.update")}
        </ToolbarPrimitive.Button>
      )}
      <ToolbarPrimitive.Button
        render={
          <Button
            variant={scope.hasChanges && !scope.view ? "default" : "outline"}
          />
        }
        disabled={!scope.ready}
        onClick={() => setPanel("save")}
      >
        <PlusIcon />
        {t(scope.view ? "views.saveAs" : "views.save")}
      </ToolbarPrimitive.Button>
      <ToolbarPrimitive.Link
        render={<Link href="/views" />}
        className={buttonVariants({ variant: "outline" })}
      >
        <FolderOpenIcon />
        {t("views.manage")}
      </ToolbarPrimitive.Link>
    </ToolbarPrimitive.Group>
  );
  const error = scope.error && (
    <div role="alert" className="text-destructive p-3 text-sm">
      {t(scope.error)}{" "}
      <button
        className="underline"
        onClick={() => {
          void scope.viewsQuery.refetch();
          void scope.foldersQuery.refetch();
        }}
      >
        {t("common.retry")}
      </button>{" "}
      <button className="underline" onClick={() => void scope.selectView()}>
        {t("views.allActivities")}
      </button>
    </div>
  );
  const totals = (
    <div
      className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
      aria-live="polite"
    >
      <span>
        {summary.data
          ? t("views.activities", { count: summary.data.count })
          : t("common.loading")}
      </span>
      {summary.data && (
        <span>
          {t("views.routeCoverage", {
            count: summary.data.routes,
            total: summary.data.count,
          })}
        </span>
      )}
      {summary.isError && (
        <button className="underline" onClick={() => void summary.refetch()}>
          {t("common.loadError")}
        </button>
      )}
    </div>
  );
  return (
    <>
      <div className="border-border bg-background shrink-0 border-b">
        {isMobile ? (
          <ToolbarPrimitive.Root
            aria-label={t("views.viewOptions")}
            className="flex min-w-0 items-center gap-2 px-3 py-2"
          >
            <ToolbarPrimitive.Button
              render={<Button variant="ghost" />}
              className="h-10 min-w-0 flex-1 justify-start px-1 text-left"
              aria-label={t("views.viewOptions")}
              onClick={() => setPanel("view")}
            >
              <span className="truncate">{title}</span>
              {stateLabel && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-amber-500"
                  title={stateLabel}
                />
              )}
              <span className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1.5">
                {count > 0 && (
                  <>
                    <FilterIcon />
                    <span className="text-xs tabular-nums">{count}</span>
                  </>
                )}
                <ChevronDownIcon />
              </span>
            </ToolbarPrimitive.Button>
          </ToolbarPrimitive.Root>
        ) : (
          <ToolbarPrimitive.Root
            aria-label={t("views.viewOptions")}
            className="flex flex-col gap-2 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              {picker}
              <ToolbarPrimitive.Group
                className="flex items-center gap-2"
                aria-label={t("views.filterTitle")}
              >
                {filters}
                {table && (
                  <ToolbarPrimitive.Button
                    render={<Button variant="outline" size="icon" />}
                    aria-label={t("views.display")}
                    disabled={!scope.ready}
                    onClick={() => setPanel("display")}
                  >
                    <SlidersHorizontalIcon />
                  </ToolbarPrimitive.Button>
                )}
              </ToolbarPrimitive.Group>
              <ToolbarPrimitive.Separator className="bg-border mx-1 h-5 w-px self-center" />
              {actions}
            </div>
            {!scope.error && (
              <div className="text-muted-foreground flex items-center gap-4">
                {state}
                {totals}
              </div>
            )}
          </ToolbarPrimitive.Root>
        )}
        {error}
      </div>
      {isMobile && (panel !== null || editorRequested) && (
        <MobileViewDrawer
          key={scope.view?.id ?? "all"}
          table={table}
          onClose={closeEditor}
          onCommit={() => setPanel(null)}
        />
      )}
      {!isMobile && (panel === "filters" || editorRequested) && (
        <ActivityFilterEditor
          initial={scope.rules}
          today={scope.today}
          onClose={closeEditor}
          onApply={(rules) => {
            setPanel(null);
            void scope.setRules(rules);
          }}
        />
      )}
      {!isMobile && panel === "save" && (
        <ViewDetailsDialog
          title={t("views.saveAs")}
          initialName={scope.view?.name}
          initialFolder={scope.view?.folderId}
          busy={save.busy}
          onClose={() => setPanel(null)}
          onSave={(name, folderId) =>
            save.saveNew(name, folderId, scope.rules, scope.display)
          }
        />
      )}
      {!isMobile && panel === "display" && (
        <DisplayDialog
          initial={scope.display}
          onClose={() => setPanel(null)}
          onApply={(display) => {
            void scope.setDisplay(display);
            setPanel(null);
          }}
        />
      )}
    </>
  );
}

function DisplayDialog({
  initial,
  onClose,
  onApply,
}: {
  initial: ActivityDisplay;
  onClose: () => void;
  onApply: (display: ActivityDisplay) => void;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState(initial);
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("views.display")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ActivityDisplayEditor value={draft} onChange={setDraft} />
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!draft.columns.length}
            onClick={() => onApply(draft)}
          >
            {t("views.apply")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function ActivityViewBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  const scope = useActivityView();
  return scope.ready ? (
    children
  ) : (
    <div className="flex flex-1 items-center justify-center p-8">
      {scope.error ? null : <QueryState loading />}
    </div>
  );
}
