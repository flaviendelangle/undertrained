import {
  CopyIcon,
  EllipsisVerticalIcon,
  Trash2Icon,
  UngroupIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useT } from "~/i18n/useT";

interface StepActionsMenuProps {
  isRepeat: boolean;
  onDuplicate: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}

/**
 * Per-row actions.
 *
 * Deliberately short: reordering is dragging, and nesting is "+ Repeat" plus a
 * drag into the group. Menu entries duplicating a direct manipulation only make
 * the list of real actions harder to find.
 */
export function StepActionsMenu({
  isRepeat,
  onDuplicate,
  onUngroup,
  onDelete,
}: StepActionsMenuProps) {
  const t = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("workouts.step.actions")}
        className="text-muted-foreground hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        <EllipsisVerticalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onDuplicate}>
          <CopyIcon /> {t("workouts.step.duplicate")}
        </DropdownMenuItem>
        {isRepeat && (
          <DropdownMenuItem onClick={onUngroup}>
            <UngroupIcon /> {t("workouts.step.ungroup")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon /> {t("workouts.step.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
