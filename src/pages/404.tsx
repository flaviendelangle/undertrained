import { FileQuestionMarkIcon } from "lucide-react";
import Link from "next/link";

import { PageToolbar } from "~/components/layouts/PageToolbar";
import { useT } from "~/i18n/useT";

export default function Custom404() {
  const t = useT();
  return (
    <>
      <PageToolbar title={t("common.notFound")} icon={FileQuestionMarkIcon} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        <Link href="/" className="text-muted-foreground underline">
          {t("common.home")}
        </Link>
        <div className="flex flex-col">
          <p className="text-9xl font-bold">404</p>
        </div>
      </div>
    </>
  );
}
