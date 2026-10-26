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
import { useActivityView } from "~/hooks/useActivityView";
import { useT } from "~/i18n/useT";
import {
  DEFAULT_ACTIVITY_DISPLAY,
  EMPTY_ACTIVITY_FILTER,
  activityRulesSchema,
  conditionCount,
  sameDisplay,
  sameFilter,
} from "~/utils/activityFilters";

import { ActivityDisplayEditor } from "./ActivityDisplayEditor";
import {
  ActivityFilterBuilder,
  ActivitySelectionPreview,
  viewInputClass,
} from "./ActivityFilterEditor";
import { ViewDetailsFields } from "./ViewDetailsDialog";
import { groupViewsByFolder } from "./groupViewsByFolder";
import { useSaveActivityView } from "./useSaveActivityView";

/** One working copy and one drawer for editing, previewing, applying and saving. */
export function MobileViewDrawer({
  table,
  onClose,
  onCommit,
}: {
  table: boolean;
  onClose: () => void;
  onCommit: () => void;
}) {
  const t = useT();
  const scope = useActivityView();
  const [rules, setRules] = React.useState(scope.rules);
  const [display, setDisplay] = React.useState(scope.display);
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
    !sameDisplay(display, scope.display);
  const save = useSaveActivityView(onCommit);
  const busy = save.busy;
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
              {groupViewsByFolder(
                scope.views,
                scope.folders,
                t("views.ungrouped"),
              ).map((group) => {
                const options = group.views.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ));
                return group.label === null ? (
                  <React.Fragment key={group.key}>{options}</React.Fragment>
                ) : (
                  <optgroup key={group.key} label={group.label}>
                    {options}
                  </optgroup>
                );
              })}
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
          <details className="border-border mt-4 border-t" open>
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
              <ViewDetailsFields
                name={name}
                folder={folderId}
                onNameChange={setName}
                onFolderChange={setFolderId}
              />
            </div>
          )}
        </div>
        <ResponsiveDialogFooter className="border-border grid shrink-0 grid-cols-2 gap-2 border-t pt-3">
          <div className="col-span-2 pb-1">
            <ActivitySelectionPreview rules={rules} today={scope.today} />
          </div>
          {!saving && scope.view && dirty ? (
            <Button
              className="col-span-2"
              disabled={!valid || busy}
              onClick={() => save.update(scope.view!, rules, display)}
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
                save.saveNew(
                  name.trim(),
                  folderId ? Number(folderId) : null,
                  rules,
                  display,
                );
            }}
          >
            {t(scope.view && !saving ? "views.saveAs" : "views.save")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
