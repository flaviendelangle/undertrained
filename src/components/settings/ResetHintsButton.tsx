import * as React from "react";

import { RotateCcwIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useDismissedHints } from "~/hooks/useDismissedHints";
import { useT } from "~/i18n/useT";

export function ResetHintsButton() {
  const t = useT();
  const { resetAll } = useDismissedHints();
  const [didReset, setDidReset] = React.useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={didReset}
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
  );
}
