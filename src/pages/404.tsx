import Link from "next/link";

import { useT } from "~/i18n/useT";

export default function Custom404() {
  const t = useT();
  return (
    <div className="flex h-screen flex-col items-center justify-center text-center">
      <Link href="/" className="text-muted-foreground underline">
        {t("common.home")}
      </Link>
      <div className="flex flex-col">
        <h1 className="text-9xl font-bold">404</h1>
        <h2 className="text-4xl font-bold">{t("common.notFound")}</h2>
      </div>
    </div>
  );
}
