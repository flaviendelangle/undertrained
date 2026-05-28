import { ActivityIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";

import { LoggedInLayout } from "~/components/layouts/LoggedInLayout";
import { SharedLayout } from "~/components/layouts/SharedLayout";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";

function PrivacyContent() {
  const t = useT();
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          href="/"
          className="text-primary mb-8 inline-flex items-center gap-2 text-sm font-medium hover:underline"
        >
          <ActivityIcon className="size-4" />
          Undertrained
        </Link>

        <h1 className="text-foreground mb-2 text-3xl font-bold">
          {t("auth.privacy.title")}
        </h1>
        <p className="text-muted-foreground mb-8 text-sm">
          {t("auth.privacy.lastUpdated")}
        </p>

        <div className="text-foreground space-y-6 text-sm leading-relaxed">
          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.whatIsHeading")}
            </h2>
            <p>{t("auth.privacy.whatIsBody")}</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.collectHeading")}
            </h2>
            <p>{t("auth.privacy.collectIntro")}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>{t("auth.privacy.collectAthlete")}</li>
              <li>{t("auth.privacy.collectTokens")}</li>
              <li>{t("auth.privacy.collectActivity")}</li>
              <li>{t("auth.privacy.collectSettings")}</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.useHeading")}
            </h2>
            <p>{t("auth.privacy.useBody")}</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.thirdPartiesHeading")}
            </h2>
            <p>{t("auth.privacy.thirdPartiesIntro")}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <strong>Strava API</strong> &mdash; {t("auth.privacy.thirdPartyStrava")}
              </li>
              <li>
                <strong>OpenStreetMap</strong> &mdash; {t("auth.privacy.thirdPartyOsm")}
              </li>
            </ul>
            <p className="mt-2">{t("auth.privacy.thirdPartiesOutro")}</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.securityHeading")}
            </h2>
            <p>{t("auth.privacy.securityBody")}</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.retentionHeading")}
            </h2>
            <p>{t("auth.privacy.retentionIntro")}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                {t("auth.privacy.retentionDeleteButtonBefore")}{" "}
                <strong>{t("auth.privacy.retentionDeleteButtonLabel")}</strong>{" "}
                {t("auth.privacy.retentionDeleteButtonAfter")}
              </li>
              <li>
                {t("auth.privacy.retentionRevokeBefore")}{" "}
                <a
                  href="https://www.strava.com/settings/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {t("auth.privacy.retentionRevokeLink")}
                </a>
                {t("auth.privacy.retentionRevokeAfter")}
              </li>
            </ul>
            <p className="mt-2">{t("auth.privacy.retentionOutro")}</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.cookiesHeading")}
            </h2>
            <p>{t("auth.privacy.cookiesBody")}</p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              {t("auth.privacy.contactHeading")}
            </h2>
            <p>
              {t("auth.privacy.contactBefore")}{" "}
              <a
                href="https://github.com/flaviendelangle/undertrained"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {t("auth.privacy.contactLink")}
              </a>
              {t("auth.privacy.contactAfter")}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

const PrivacyPage: NextPageWithLayout = () => {
  return <PrivacyContent />;
};

PrivacyPage.getLayout = function getLayout(page) {
  return <PrivacyLayout>{page}</PrivacyLayout>;
};

function PrivacyLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === "authenticated") {
    return <LoggedInLayout>{children}</LoggedInLayout>;
  }

  return <SharedLayout>{children}</SharedLayout>;
}

export default PrivacyPage;
