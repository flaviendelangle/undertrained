import * as React from "react";

import Link from "next/link";

import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import { showErrorToast } from "~/components/ui/toast";
import { useActivityView } from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import {
  DEFAULT_ACTIVITY_DISPLAY,
  EMPTY_ACTIVITY_FILTER,
  activityRulesSchema,
  conditionCount,
  sameFilter,
} from "~/utils/activityFilters";
import { trpc } from "~/utils/trpc";

import { ActivityDisplayEditor } from "./ActivityDisplayEditor";
import {
  ActivityFilterBuilder,
  ActivitySelectionPreview,
  viewInputClass,
} from "./ActivityFilterEditor";

/** One working copy and one drawer for editing, previewing, applying and saving. */
export function MobileViewDrawer({
  table,
  initialFiltersOpen,
  onClose,
  onCommit,
}: {
  table: boolean;
  initialFiltersOpen: boolean;
  onClose: () => void;
  onCommit: () => void;
}) {
  const t = useT();
  const scope = useActivityView();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const [rules, setRules] = React.useState(scope.rules);
  const [display, setDisplay] = React.useState(scope.display);
  const [rulesOpen, setRulesOpen] = React.useState(initialFiltersOpen);
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState(scope.view?.name ?? "");
  const [folderId, setFolderId] = React.useState(
    scope.view?.folderId === null || !scope.view
      ? ""
      : String(scope.view.folderId),
  );
  const valid =
    scope.ready &&
    activityRulesSchema.safeParse(rules).success &&
    display.columns.length > 0;
  const dirty =
    scope.hasChanges ||
    !sameFilter(rules, scope.rules) ||
    JSON.stringify(display) !== JSON.stringify(scope.display);
  const onSuccess = async (saved: NonNullable<typeof scope.view>) => {
    utils.views.list.setData({ athleteId }, (old) =>
      [...(old ?? []).filter((view) => view.id !== saved.id), saved].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    );
    await utils.views.counts.invalidate();
    await scope.acceptSaved(saved);
    onCommit();
  };
  const options = {
    onSuccess,
    onError: () => showErrorToast(t("common.saveError")),
  };
  const create = trpc.views.create.useMutation(options);
  const update = trpc.views.update.useMutation(options);
  const busy = create.isPending || update.isPending;
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ResponsiveDialogContent className="flex max-h-[94dvh] flex-col gap-4 px-4">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("views.viewOptions")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="min-h-0 overflow-y-auto pb-1">
          <label className="flex flex-col gap-1 text-sm">
            <span className="sr-only">{t("views.title")}</span>
            <select
              aria-label={t("views.title")}
              className={`${viewInputClass} w-full font-medium`}
              value={scope.view?.id ?? ""}
              onChange={(event) => {
                void scope
                  .selectView(
                    event.target.value ? Number(event.target.value) : undefined,
                  )
                  .then(onCommit);
              }}
            >
              <option value="">{t("views.allActivities")}</option>
              {scope.folders.map((folder) => (
                <optgroup key={folder.id} label={folder.name}>
                  {scope.views
                    .filter((view) => view.folderId === folder.id)
                    .map((view) => (
                      <option key={view.id} value={view.id}>
                        {view.name}
                      </option>
                    ))}
                </optgroup>
              ))}
              {scope.views
                .filter((view) => view.folderId === null)
                .map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span role="status" className="text-muted-foreground text-xs">
              {dirty ? t(scope.view ? "views.modified" : "views.unsaved") : ""}
            </span>
            <Link
              className="text-muted-foreground text-xs underline"
              href="/views"
            >
              {t("views.manage")}
            </Link>
          </div>
          <details
            className="border-border mt-4 border-t"
            open={rulesOpen}
            onToggle={(event) => setRulesOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer py-3 text-sm font-medium">
              {t("views.filterTitle")} ({conditionCount(rules)})
            </summary>
            <ActivityFilterBuilder value={rules} onChange={setRules} />
          </details>
          {table && (
            <details className="border-border border-t">
              <summary className="cursor-pointer py-3 text-sm font-medium">
                {t("views.display")}
              </summary>
              <div className="pb-3">
                <ActivityDisplayEditor value={display} onChange={setDisplay} />
              </div>
            </details>
          )}
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              className="mb-2"
              onClick={() => {
                setRules(scope.view?.rules ?? EMPTY_ACTIVITY_FILTER);
                setDisplay(scope.view?.display ?? DEFAULT_ACTIVITY_DISPLAY);
              }}
            >
              {t(scope.view ? "views.reset" : "views.clear")}
            </Button>
          )}
          {saving && (
            <div className="border-border flex flex-col gap-3 border-t py-3">
              <label className="flex flex-col gap-1 text-sm">
                {t("views.name")}
                <input
                  aria-label={t("views.name")}
                  autoFocus
                  required
                  maxLength={100}
                  className={viewInputClass}
                  placeholder={t("views.namePlaceholder")}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("views.folder")}
                <select
                  className={viewInputClass}
                  value={folderId}
                  onChange={(event) => setFolderId(event.target.value)}
                >
                  <option value="">{t("views.ungrouped")}</option>
                  {scope.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        <ResponsiveDialogFooter className="border-border grid shrink-0 grid-cols-2 gap-2 border-t pt-3">
          <div className="col-span-2 pb-1">
            <ActivitySelectionPreview
              rules={rules}
              today={scope.today}
              coverage
            />
          </div>
          {!saving && scope.view && dirty ? (
            <Button
              className="col-span-2"
              disabled={!valid || busy}
              onClick={() =>
                update.mutate({
                  athleteId,
                  id: scope.view!.id,
                  name: scope.view!.name,
                  folderId: scope.view!.folderId,
                  rules,
                  display,
                })
              }
            >
              {t("views.update")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={!valid || busy}
            onClick={() => {
              void scope.setDefinition(rules, display).then(onCommit);
            }}
          >
            {t("views.apply")}
          </Button>
          <Button
            disabled={!valid || busy || (saving && !name.trim())}
            onClick={() => {
              if (!saving) setSaving(true);
              else
                create.mutate({
                  athleteId,
                  name: name.trim(),
                  folderId: folderId ? Number(folderId) : null,
                  rules,
                  display,
                });
            }}
          >
            {t(scope.view && !saving ? "views.saveAs" : "views.save")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
