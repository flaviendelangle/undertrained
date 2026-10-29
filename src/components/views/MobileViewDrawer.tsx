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
import { SelectTrigger, SelectValue } from "~/components/ui/select";
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
} from "./ActivityFilterEditor";
import { ViewDetailsFields, useViewDetails } from "./ViewDetailsDialog";
import { ViewPicker } from "./ViewPicker";
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
  const valid =
    scope.ready &&
    activityRulesSchema.safeParse(rules).success &&
    display.columns.length > 0;
  const dirty =
    scope.hasChanges ||
    !sameFilter(rules, scope.rules) ||
    !sameDisplay(display, scope.display);
  const save = useSaveActivityView(onCommit);
  const details = useViewDetails(
    scope.view?.name ?? "",
    scope.view?.folderId ?? null,
    (name, folderId) => save.saveNew(name, folderId, rules, display),
  );
  const busy = save.busy || details.busy;
  const formId = React.useId();
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
          <ViewPicker onSelect={onCommit}>
            <SelectTrigger
              aria-label={t("views.title")}
              className="w-full font-medium"
            >
              <SelectValue>
                {scope.view?.name ?? t("views.allActivities")}
              </SelectValue>
            </SelectTrigger>
          </ViewPicker>
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
            <form
              id={formId}
              onSubmit={(event) => {
                event.preventDefault();
                if (valid && !busy && details.valid) details.submit();
              }}
              className="border-border flex flex-col gap-3 border-t py-3"
            >
              <ViewDetailsFields details={details} />
            </form>
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
            // Outside the form, so Enter in its fields submits through `form`.
            type={saving ? "submit" : "button"}
            form={saving ? formId : undefined}
            disabled={!valid || busy || (saving && !details.valid)}
            onClick={(event) => {
              if (saving) return;
              // React commits the `submit` type before the click's default
              // action runs, which would submit the just-revealed form.
              event.preventDefault();
              setSaving(true);
            }}
          >
            {t(scope.view && !saving ? "views.saveAs" : "views.save")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
