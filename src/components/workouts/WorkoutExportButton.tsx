import * as React from "react";

import { DownloadIcon } from "lucide-react";

import { Tooltip } from "~/components/primitives/Tooltip";
import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/useT";
import {
  type StructuredWorkout,
  hasPowerTarget,
} from "~/utils/structuredWorkout/types";
import { generateZwo, getZwoExportIssue } from "~/utils/structuredWorkout/zwo";

export function WorkoutExportButton({
  name,
  description,
  structure,
  ftp,
}: {
  name: string;
  description?: string | null;
  structure: StructuredWorkout;
  ftp: number | null;
}) {
  const t = useT();
  const issue = React.useMemo(
    () => getZwoExportIssue(structure, ftp),
    [structure, ftp],
  );
  const fixedTargets = hasPowerTarget(structure.nodes, ["watts"]);
  const help = issue
    ? t(`workouts.${issue}`)
    : fixedTargets
      ? t("workouts.exportFixedTargets", { ftp: ftp! })
      : t("workouts.exportHelp");

  const download = () => {
    if (issue) return;
    const title = name.trim() || t("workouts.defaultName");
    const blob = new Blob(
      [generateZwo({ name: title, description, structure, ftp })],
      {
        type: "application/xml;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\p{L}\p{N} _.-]/gu, "_").slice(0, 100)}.zwo`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Tooltip label={help} side="bottom">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("workouts.exportZwo")}
        aria-description={help}
        aria-disabled={issue != null}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={download}
      >
        <DownloadIcon />
        <span className="hidden sm:inline">{t("workouts.exportZwo")}</span>
      </Button>
    </Tooltip>
  );
}
