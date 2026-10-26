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

import { viewInputClass } from "./ActivityFilterEditor";

export function ViewDetailsDialog({
  title,
  initialName = "",
  initialFolder = null,
  busy,
  onSave,
  onClose,
}: {
  title: string;
  initialName?: string;
  initialFolder?: number | null;
  busy?: boolean;
  onSave: (name: string, folderId: number | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { folders } = useActivityView();
  const [name, setName] = React.useState(initialName);
  const [folder, setFolder] = React.useState(
    initialFolder === null ? "" : String(initialFolder),
  );
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
        </ResponsiveDialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim())
              onSave(name.trim(), folder ? Number(folder) : null);
          }}
          className="flex flex-col gap-4"
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
              placeholder={t("views.namePlaceholder")}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm">
            {t("views.folder")}
            <select
              className={viewInputClass}
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
            >
              <option value="">{t("views.ungrouped")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("views.cancel")}
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
