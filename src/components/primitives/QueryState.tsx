import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/useT";

export function QueryState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <div
      role={error ? "alert" : "status"}
      className="text-muted-foreground flex flex-col items-center gap-3 px-4 py-16 text-center text-sm"
    >
      {loading ? t("common.loading") : error ? t("common.loadError") : children}
      {error && onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}
