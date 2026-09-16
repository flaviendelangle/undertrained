import { useState } from "react";

import {
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";

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
import { useT } from "~/i18n/useT";

export function WorkoutActionsMenu({
  name,
  editHref,
  onDuplicate,
  onDelete,
  pending = false,
}: {
  name: string;
  editHref?: string;
  onDuplicate: () => void;
  onDelete?: () => void | Promise<void>;
  pending?: boolean;
}) {
  const t = useT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative z-10 shrink-0"
              aria-label={`${t("workouts.actions")}: ${name}`}
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {editHref && (
            <DropdownMenuLinkItem
              closeOnClick
              render={<Link href={editHref} />}
            >
              <PencilIcon />
              {t("workouts.editAction")}
            </DropdownMenuLinkItem>
          )}
          <DropdownMenuItem disabled={pending} onClick={onDuplicate}>
            <CopyIcon />
            {t("workouts.duplicate")}
          </DropdownMenuItem>
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2Icon />
                {t("common.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {onDelete && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t("common.deleteConfirmTitle", { name })}
          description={t("common.deleteConfirmDescription")}
          confirmLabel={t("common.delete")}
          pendingLabel={t("common.deleting")}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}
