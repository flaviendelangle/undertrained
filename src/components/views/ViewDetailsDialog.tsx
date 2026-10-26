import * as React from "react";

import { Select } from "~/components/primitives/Select";
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
          <ViewDetailsFields
            name={name}
            folder={folder}
            onNameChange={setName}
            onFolderChange={setFolder}
          />
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

/** A view's name and folder; `folder` is a folder ID, or "" for ungrouped. */
export function ViewDetailsFields({
  name,
  folder,
  onNameChange,
  onFolderChange,
}: {
  name: string;
  folder: string;
  onNameChange: (name: string) => void;
  onFolderChange: (folder: string) => void;
}) {
  const t = useT();
  const { folders } = useActivityView();
  return (
    <>
      <label className="flex flex-col gap-2 text-sm">
        {t("views.name")}
        <input
          autoFocus
          required
          maxLength={100}
          className={viewInputClass}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t("views.namePlaceholder")}
        />
      </label>
      <div className="flex flex-col gap-2 text-sm">
        <Select
          label={t("views.folder")}
          className="w-full"
          value={folder}
          onValueChange={onFolderChange}
          options={[
            { value: "", label: t("views.ungrouped") },
            ...folders.map((f) => ({ value: String(f.id), label: f.name })),
          ]}
        />
      </div>
    </>
  );
}
