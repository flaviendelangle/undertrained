import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  GroupIcon,
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
  canGroup: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onUnroll: () => void;
  onDelete: () => void;
}

/**
 * Per-row actions. Everything here also has a keyboard shortcut; the menu is
 * what makes those actions reachable on touch, where there is no keyboard and
 * no room for seven buttons.
 */
export function StepActionsMenu({
  isRepeat,
  canGroup,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onGroup,
  onUngroup,
  onUnroll,
  onDelete,
}: StepActionsMenuProps) {
  const t = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("workouts.step.select")}
        className="text-muted-foreground hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        <EllipsisVerticalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onMoveUp}>
          <ChevronUpIcon /> {t("workouts.step.moveUp")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onMoveDown}>
          <ChevronDownIcon /> {t("workouts.step.moveDown")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <CopyIcon /> {t("workouts.step.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isRepeat ? (
          <>
            <DropdownMenuItem onClick={onUngroup}>
              <UngroupIcon /> {t("workouts.step.ungroup")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onUnroll}>
              <UngroupIcon /> {t("workouts.step.unroll")}
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={onGroup} disabled={!canGroup}>
            <GroupIcon /> {t("workouts.step.group")}
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
