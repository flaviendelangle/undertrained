import * as React from "react";

import { FolderPlusIcon } from "lucide-react";

import { Select as SelectPrimitive } from "@base-ui/react/select";

import { Button } from "~/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { showErrorToast } from "~/components/ui/toast";
import { useActivityView } from "~/hooks/useActivityView";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

import { viewInputClass } from "./ActivityFilterEditor";

/** The folder select's value for "create a folder on save". */
const NEW_FOLDER = "new";

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
  const details = useViewDetails(initialName, initialFolder, onSave);
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
            if (details.valid && !details.busy) details.submit();
          }}
          className="flex flex-col gap-4"
        >
          <ViewDetailsFields details={details} />
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={busy || details.busy || !details.valid}
            >
              {t("views.save")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export type ViewDetails = ReturnType<typeof useViewDetails>;

/**
 * A view's name and folder while editing them. `folder` is a folder ID, ""
 * for ungrouped, or `NEW_FOLDER` to create `newFolder` when saving.
 */
export function useViewDetails(
  initialName: string,
  initialFolder: number | null,
  onSave: (name: string, folderId: number | null) => void,
) {
  const t = useT();
  const athleteId = useAthleteId();
  const utils = trpc.useUtils();
  const { folders } = useActivityView();
  const [name, setName] = React.useState(initialName);
  const [folder, setFolder] = React.useState(
    initialFolder === null ? "" : String(initialFolder),
  );
  const [newFolder, setNewFolder] = React.useState("");
  const createFolder = trpc.views.createFolder.useMutation({
    onError: () => showErrorToast(t("common.saveError")),
  });
  const creating = folder === NEW_FOLDER;
  return {
    name,
    setName,
    folder,
    setFolder,
    newFolder,
    setNewFolder,
    valid: !!name.trim() && (!creating || !!newFolder.trim()),
    busy: createFolder.isPending,
    submit: () => {
      if (!creating) return onSave(name.trim(), folder ? Number(folder) : null);
      const folderName = newFolder.trim();
      const existing = folders.find((f) => f.name === folderName);
      if (existing) {
        setFolder(String(existing.id));
        return onSave(name.trim(), existing.id);
      }
      createFolder.mutate(
        { athleteId, name: folderName },
        {
          onSuccess: (created) => {
            utils.views.listFolders.setData({ athleteId }, (old) =>
              [...(old ?? []), created].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            );
            // A retry after a failed view save must not create it twice.
            setFolder(String(created.id));
            onSave(name.trim(), created.id);
          },
        },
      );
    },
  };
}

export function ViewDetailsFields({ details }: { details: ViewDetails }) {
  const t = useT();
  const { folders } = useActivityView();
  const newFolderInput = React.useRef<HTMLInputElement>(null);
  const options = [
    { value: "", label: t("views.ungrouped") },
    ...folders.map((f) => ({ value: String(f.id), label: f.name })),
  ];
  return (
    <>
      <label className="flex flex-col gap-2 text-sm">
        {t("views.name")}
        <input
          autoFocus
          required
          maxLength={100}
          className={viewInputClass}
          value={details.name}
          onChange={(event) => details.setName(event.target.value)}
          placeholder={t("views.namePlaceholder")}
        />
      </label>
      <div className="flex flex-col gap-2 text-sm">
        <Select
          value={details.folder}
          onValueChange={(value) => {
            if (value !== null) details.setFolder(value);
          }}
        >
          <SelectPrimitive.Label>{t("views.folder")}</SelectPrimitive.Label>
          <SelectTrigger className="w-full">
            <SelectValue>
              {(value: string) =>
                value === NEW_FOLDER
                  ? t("views.newFolder")
                  : options.find((o) => o.value === value)?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            finalFocus={() =>
              details.folder === NEW_FOLDER ? newFolderInput.current : true
            }
          >
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={NEW_FOLDER}>
              <FolderPlusIcon />
              {t("views.newFolder")}
            </SelectItem>
          </SelectContent>
        </Select>
        {details.folder === NEW_FOLDER && (
          <input
            ref={newFolderInput}
            required
            maxLength={100}
            aria-label={t("views.newFolderName")}
            className={viewInputClass}
            value={details.newFolder}
            onChange={(event) => details.setNewFolder(event.target.value)}
            placeholder={t("views.newFolderName")}
          />
        )}
      </div>
    </>
  );
}
