import * as React from "react";

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
  type ActivityFilterGroup,
  EMPTY_ACTIVITY_FILTER,
  activityRulesSchema,
} from "~/utils/activityFilters";

import {
  ActivityFilterBuilder,
  ActivitySelectionPreview,
} from "./ActivityFilterEditor";
import { ViewDetailsFields, useViewDetails } from "./ViewDetailsDialog";

/**
 * Creates a view without leaving the page: its name and folder, then the
 * filter builder and live activity count of the Activities filter editor.
 */
export function NewViewDialog({
  initialFolder,
  busy,
  onSave,
  onClose,
}: {
  initialFolder: number | null;
  busy: boolean;
  onSave: (
    name: string,
    folderId: number | null,
    rules: ActivityFilterGroup,
  ) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { today } = useActivityView();
  const [rules, setRules] = React.useState(EMPTY_ACTIVITY_FILTER);
  const details = useViewDetails("", initialFolder, (name, folderId) =>
    onSave(name, folderId, rules),
  );
  const formId = React.useId();
  const valid = details.valid && activityRulesSchema.safeParse(rules).success;
  const pending = busy || details.busy;
  return (
    <ResponsiveDialog
      open
      onOpenChange={(open) => {
        // Closing mid-creation would leave the new folder empty.
        if (!open && !details.busy) onClose();
      }}
    >
      <ResponsiveDialogContent className="flex max-h-[94dvh] flex-col gap-4 sm:max-h-[90dvh] sm:max-w-4xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("views.newView")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {/* The inset keeps focus rings from being clipped by the scroll area. */}
        <div className="-m-1 min-h-0 overflow-y-auto p-1">
          {/* Only the name and folder submit on Enter, not the filter values. */}
          <form
            id={formId}
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && !pending) details.submit();
            }}
          >
            <ViewDetailsFields details={details} />
          </form>
          <section
            aria-label={t("views.filterTitle")}
            className="border-border mt-4 border-t pt-4"
          >
            <h3 className="mb-2 text-sm font-medium">
              {t("views.filterTitle")}
            </h3>
            <ActivityFilterBuilder value={rules} onChange={setRules} />
          </section>
        </div>
        <ResponsiveDialogFooter className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-row">
          <div className="col-span-2 sm:mr-auto">
            <ActivitySelectionPreview rules={rules} today={today} />
          </div>
          <Button variant="outline" disabled={details.busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={!valid || pending}>
            {t("views.save")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
