import type { ReactNode } from "react";

import {
  ActivityIcon,
  BikeIcon,
  CircleAlertIcon,
  CloudUploadIcon,
  MonitorIcon,
  ShieldAlertIcon,
  UserRoundIcon,
} from "lucide-react";
import type { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";

import { PageTitle } from "~/components/PageTitle";
import { SharedLayout } from "~/components/layouts/SharedLayout";
import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";
import { authOptions } from "~/pages/api/auth/[...nextauth]";
import {
  APPROVAL_SECONDS,
  CONSENT_ERROR_STATUS,
  type ConsentError,
  approvalPayload,
  isConsentError,
  nowSeconds,
  signApproval,
  validProof,
  validRedirect,
} from "~/server/lib/desktopAuth";

interface Approval {
  redirect_uri: string;
  state: string;
  code_challenge: string;
  expires: number;
  signature: string;
}

export type DesktopConnectProps =
  | { kind: "consent"; name: string | null; approval: Approval }
  | { kind: "error"; error: ConsentError };

/**
 * The consent page has its own policy: forms may only post back to the app
 * and to the desktop app's loopback callback. Chrome checks form-action on the
 * POST's redirect as well as its target, so the callback must be listed here.
 */
function contentSecurityPolicy(nonce: string | null, callback?: URL) {
  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "base-uri 'none'",
    // Serialize the validated URL so raw input cannot add CSP directives.
    `form-action 'self'${callback ? ` ${callback.origin}${callback.pathname}` : ""}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

export const getServerSideProps: GetServerSideProps<
  DesktopConnectProps
> = async ({ req, res, query, resolvedUrl }) => {
  // src/proxy.ts generates the nonce that _app and _document put on scripts.
  const header = req.headers["x-nonce"];
  const nonce =
    typeof header === "string" && /^[A-Za-z0-9+/=]+$/.test(header)
      ? header
      : null;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", contentSecurityPolicy(nonce));
  const fail = (error: ConsentError) => {
    res.statusCode = CONSENT_ERROR_STATUS[error];
    return { props: { kind: "error" as const, error } };
  };
  // Set by /api/desktop/authorize when it rejects an approval.
  if (isConsentError(query.error)) return fail(query.error);
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    // src/proxy.ts usually signs riders in first. The login page only returns
    // to the desktop entry point, which brings the request back here.
    const { search } = new URL(resolvedUrl, "http://localhost");
    return {
      redirect: {
        destination: `/login?callbackUrl=${encodeURIComponent(`/api/desktop/authorize${search}`)}`,
        permanent: false,
      },
    };
  }
  const { redirect_uri: redirect, state, code_challenge: challenge } = query;
  if (
    typeof redirect !== "string" ||
    !validRedirect(redirect) ||
    !validProof(state) ||
    !validProof(challenge)
  ) {
    return fail("invalid");
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return fail("unavailable");
  res.setHeader(
    "Content-Security-Policy",
    contentSecurityPolicy(nonce, new URL(redirect)),
  );
  const expires = nowSeconds() + APPROVAL_SECONDS;
  const signature = signApproval(
    approvalPayload(session.athleteId, redirect, state, challenge, expires),
    secret,
  );
  return {
    props: {
      kind: "consent",
      name: session.user?.name ?? null,
      approval: {
        redirect_uri: redirect,
        state,
        code_challenge: challenge,
        expires,
        signature,
      },
    },
  };
};

const DesktopConnectPage: NextPageWithLayout<DesktopConnectProps> = (props) => {
  return (
    <main className="from-background via-background to-primary/10 relative flex min-h-screen items-center justify-center overflow-hidden bg-linear-to-br px-4 py-12">
      {/* Decorative background element, as on the login page */}
      <ActivityIcon className="text-primary/3 absolute -right-20 -bottom-20 size-112 rotate-12" />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8">
        <div className="flex items-center gap-2.5">
          <ActivityIcon className="text-primary size-8" />
          <span className="text-foreground text-4xl font-black tracking-tight">
            Undertrained
          </span>
        </div>

        <section className="border-border bg-card flex w-full flex-col gap-5 rounded-sm border p-6">
          {props.kind === "consent" ? (
            <Consent name={props.name} approval={props.approval} />
          ) : (
            <ConsentFailure error={props.error} />
          )}
        </section>
      </div>
    </main>
  );
};

function Consent({
  name,
  approval,
}: {
  name: string | null;
  approval: Approval;
}) {
  const t = useT();
  return (
    <>
      <PageTitle title={t("auth.desktop.title")} />
      <div className="flex items-center gap-3">
        <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-sm">
          <MonitorIcon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-foreground text-lg font-semibold">
            {t("auth.desktop.title")}
          </h1>
          <p className="text-muted-foreground truncate text-sm">
            {name
              ? t("auth.desktop.signedInAs", { name })
              : t("auth.desktop.signedIn")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 text-sm">
        <p className="text-muted-foreground">{t("auth.desktop.scopeIntro")}</p>
        <ul className="text-foreground flex flex-col gap-2">
          <Scope icon={<UserRoundIcon />}>
            {t("auth.desktop.scopeProfile")}
          </Scope>
          <Scope icon={<BikeIcon />}>{t("auth.desktop.scopeWorkouts")}</Scope>
          <Scope icon={<CloudUploadIcon />}>
            {t("auth.desktop.scopeUploads")}
          </Scope>
        </ul>
      </div>

      <p className="text-foreground flex items-start gap-2.5 rounded-sm border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
        {t("auth.desktop.warning")}
      </p>

      <form
        method="post"
        action="/api/desktop/authorize"
        className="flex flex-col gap-3"
      >
        <input
          type="hidden"
          name="redirect_uri"
          value={approval.redirect_uri}
        />
        <input type="hidden" name="state" value={approval.state} />
        <input
          type="hidden"
          name="code_challenge"
          value={approval.code_challenge}
        />
        <input type="hidden" name="expires" value={approval.expires} />
        <input type="hidden" name="signature" value={approval.signature} />
        <Button type="submit" size="lg" className="w-full">
          {t("auth.desktop.approve")}
        </Button>
        <p className="text-muted-foreground text-center text-xs">
          {t("auth.desktop.cancel")}
        </p>
      </form>
    </>
  );
}

function Scope({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 [&_svg]:size-4 [&_svg]:shrink-0">
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </li>
  );
}

function ConsentFailure({ error }: { error: ConsentError }) {
  const t = useT();
  return (
    <>
      <PageTitle title={t(`auth.desktop.error.${error}.title`)} />
      <div className="flex items-start gap-3">
        <span className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-sm">
          <CircleAlertIcon className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-foreground text-lg font-semibold">
            {t(`auth.desktop.error.${error}.title`)}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t(`auth.desktop.error.${error}.body`)}
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            {t("auth.desktop.close")}
          </p>
        </div>
      </div>
    </>
  );
}

DesktopConnectPage.getLayout = function getLayout(page) {
  return <SharedLayout>{page}</SharedLayout>;
};

export default DesktopConnectPage;
