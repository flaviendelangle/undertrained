import * as React from "react";

import { RotateCcwIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useDismissedHints } from "~/hooks/useDismissedHints";
import { useT } from "~/i18n/useT";

import { SettingRow } from "./layouts/shared";

export function ResetHintsButton() {
  const t = useT();
  const { resetAll } = useDismissedHints();
  const [didReset, setDidReset] = React.useState(false);

  return (
    <SettingRow label={t("settings.preferences.hints")}>
      <Button
        variant="outline"
        size="sm"
        disabled={didReset}
        className="shrink-0 self-start sm:self-auto"
        onClick={() => {
          resetAll();
          setDidReset(true);
        }}
      >
        <RotateCcwIcon className="size-3.5" />
        {didReset
          ? t("settings.preferences.hintsRestored")
          : t("settings.preferences.resetHints")}
      </Button>
    </SettingRow>
  );
}
