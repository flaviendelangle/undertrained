import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  RepeatIcon,
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
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onWrap: () => void;
  canWrap: boolean;
  onUngroup: () => void;
  onDelete: () => void;
}

/** Row actions, including a keyboard and tap alternative to dragging. */
export function StepActionsMenu({
  isRepeat,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onWrap,
  canWrap,
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
        <DropdownMenuItem onClick={onMoveUp}>
          <ArrowUpIcon /> {t("workouts.step.moveUp")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMoveDown}>
          <ArrowDownIcon /> {t("workouts.step.moveDown")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <CopyIcon /> {t("workouts.step.duplicate")}
        </DropdownMenuItem>
        {/* Wraps this row in a new group — the only way to turn something
            already written into a set without dragging it. */}
        <DropdownMenuItem onClick={onWrap} disabled={!canWrap}>
          <RepeatIcon /> {t("workouts.step.wrapInRepeat")}
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
