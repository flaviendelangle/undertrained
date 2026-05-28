import * as React from "react";

import {
  BarChart3Icon,
  BikeIcon,
  CalendarDaysIcon,
  CalendarIcon,
  EllipsisIcon,
  ListIcon,
  LogOutIcon,
  MapIcon,
  MenuIcon,
  MoonIcon,
  PlayCircleIcon,
  RouteIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SunIcon,
  TrophyIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tooltip, TooltipProps } from "~/components/primitives/Tooltip";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import { useTheme } from "~/hooks/useTheme";
import { useT } from "~/i18n/useT";
import { isLiveTrainingEnabled, isRoutesEnabled } from "~/lib/features";
import { cn } from "~/lib/utils";

import { NavBarContext } from "./NavBarContext";

interface NavBarLinkProps {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: React.ReactNode;
}

function NavBarLink({ icon: Icon, label, href, badge }: NavBarLinkProps) {
  const { isMenuExpanded } = React.useContext(NavBarContext);
  const pathname = usePathname();
  const isActive = (pathname ?? "").startsWith(href);

  return (
    <Link
      className={cn(
        "group relative mx-2 flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      aria-label={label}
      href={href}
    >
      {isActive && (
        <span className="bg-primary absolute top-1.5 bottom-1.5 left-0 w-0.75 rounded-r-full" />
      )}
      <span className="relative">
        <Icon className="size-4.5 shrink-0" />
        {badge}
      </span>
      {isMenuExpanded && <span>{label}</span>}
    </Link>
  );
}

interface NavBarButtonProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}

function NavBarButton({ icon: Icon, label, onClick }: NavBarButtonProps) {
  const { isMenuExpanded } = React.useContext(NavBarContext);

  return (
    <button
      className="text-muted-foreground hover:bg-accent hover:text-foreground mx-2 flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors"
      aria-label={label}
      onClick={onClick}
    >
      <Icon className="size-4.5 shrink-0" />
      {isMenuExpanded && <span>{label}</span>}
    </button>
  );
}

function TooltipIfMenuCollapsed(props: TooltipProps) {
  const { isMenuExpanded } = React.useContext(NavBarContext);

  if (isMenuExpanded) {
    return props.children;
  }

  return <Tooltip {...props} />;
}

function ThemeToggleNavButton() {
  const t = useT();
  const { resolvedTheme, setTheme } = useTheme();
  const label =
    resolvedTheme === "dark" ? t("nav.lightMode") : t("nav.darkMode");

  return (
    <TooltipIfMenuCollapsed label={label}>
      <NavBarButton
        icon={resolvedTheme === "dark" ? SunIcon : MoonIcon}
        label={label}
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      />
    </TooltipIfMenuCollapsed>
  );
}

function SettingsSetupDot() {
  const { hasSettings } = useRiderSettingsTimeline();
  if (hasSettings) return null;
  return (
    <span className="absolute -top-1 -right-1 flex size-2.5">
      <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
      <span className="bg-primary relative inline-flex size-2.5 rounded-full" />
    </span>
  );
}

/* ── Desktop sidebar ── */
export function NavBar() {
  const t = useT();
  const [isMenuExpanded, setIsMenuExpanded] = React.useState(false);

  return (
    <NavBarContext value={{ isMenuExpanded }}>
      <nav
        data-expanded={isMenuExpanded}
        className="bg-sidebar border-sidebar-border hidden h-full w-14 shrink-0 flex-col justify-between border-r py-3 md:flex data-[expanded=true]:w-52"
      >
        <div className="flex flex-col gap-0.5">
          <TooltipIfMenuCollapsed
            label={isMenuExpanded ? t("nav.collapseMenu") : t("nav.expandMenu")}
          >
            <button
              className="hover:bg-accent mx-2 mb-2 flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-bold whitespace-nowrap transition-colors"
              aria-label={
                isMenuExpanded ? t("nav.collapseMenu") : t("nav.expandMenu")
              }
              onClick={() => setIsMenuExpanded((prev) => !prev)}
            >
              {isMenuExpanded ? (
                <>
                  <BikeIcon className="text-primary size-4.5 shrink-0" />
                  <span className="text-foreground flex-1">Undertrained</span>
                  <XIcon className="text-muted-foreground size-4" />
                </>
              ) : (
                <MenuIcon className="text-muted-foreground size-4.5 shrink-0" />
              )}
            </button>
          </TooltipIfMenuCollapsed>

          <TooltipIfMenuCollapsed label={t("nav.journal")}>
            <NavBarLink
              icon={CalendarDaysIcon}
              label={t("nav.journal")}
              href="/journal"
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.activities")}>
            <NavBarLink
              icon={ListIcon}
              label={t("nav.activities")}
              href="/activities"
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.map")}>
            <NavBarLink
              icon={MapIcon}
              label={t("nav.map")}
              href="/map"
            />
          </TooltipIfMenuCollapsed>
          {isRoutesEnabled && (
            <TooltipIfMenuCollapsed label={t("nav.routes")}>
              <NavBarLink
                icon={RouteIcon}
                label={t("nav.routes")}
                href="/routes"
              />
            </TooltipIfMenuCollapsed>
          )}
          <TooltipIfMenuCollapsed label={t("nav.statistics")}>
            <NavBarLink
              icon={BarChart3Icon}
              label={t("nav.statistics")}
              href="/statistics"
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.personalBests")}>
            <NavBarLink
              icon={TrophyIcon}
              label={t("nav.personalBests")}
              href="/personal-bests"
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.timePeriods")}>
            <NavBarLink
              icon={CalendarIcon}
              label={t("nav.timePeriods")}
              href="/time-periods"
            />
          </TooltipIfMenuCollapsed>
          {isLiveTrainingEnabled && (
            <TooltipIfMenuCollapsed label={t("nav.liveTraining")}>
              <NavBarLink
                icon={PlayCircleIcon}
                label={t("nav.liveTraining")}
                href="/live-training"
              />
            </TooltipIfMenuCollapsed>
          )}
          <TooltipIfMenuCollapsed label={t("nav.toolbox")}>
            <NavBarLink
              icon={WrenchIcon}
              label={t("nav.toolbox")}
              href="/toolbox"
            />
          </TooltipIfMenuCollapsed>
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="border-sidebar-border mx-3 mb-1 border-t" />
          <TooltipIfMenuCollapsed label={t("nav.settings")}>
            <NavBarLink
              icon={SettingsIcon}
              label={t("nav.settings")}
              href="/settings"
              badge={<SettingsSetupDot />}
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.privacyPolicy")}>
            <NavBarLink
              icon={ShieldCheckIcon}
              label={t("nav.privacy")}
              href="/privacy"
            />
          </TooltipIfMenuCollapsed>
          <ThemeToggleNavButton />
          <TooltipIfMenuCollapsed label={t("nav.logout")}>
            <NavBarButton
              icon={LogOutIcon}
              label={t("nav.logout")}
              onClick={() => signOut({ callbackUrl: "/login" })}
            />
          </TooltipIfMenuCollapsed>
        </div>
      </nav>
    </NavBarContext>
  );
}

/* ── Mobile bottom tab bar ── */

interface MobileTabLinkProps {
  icon: React.ElementType;
  label: string;
  href: string;
}

function MobileTabLink({ icon: Icon, label, href }: MobileTabLinkProps) {
  const pathname = usePathname();
  const isActive = (pathname ?? "").startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors",
        isActive
          ? "text-primary"
          : "text-muted-foreground active:text-foreground",
      )}
    >
      <Icon className="size-5" />
      <span>{label}</span>
    </Link>
  );
}

export function MobileBottomBar() {
  const t = useT();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div
          className="bg-background/30 fixed inset-0 z-40 backdrop-blur-[1px] md:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}
      {moreOpen && (
        <div className="bg-popover border-border fixed right-2 bottom-16 z-50 rounded-xl border p-1 shadow-lg md:hidden">
          <Link
            href="/personal-bests"
            className="text-foreground hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
            onClick={() => setMoreOpen(false)}
          >
            <TrophyIcon className="size-4" />
            {t("nav.personalBests")}
          </Link>
          <Link
            href="/time-periods"
            className="text-foreground hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
            onClick={() => setMoreOpen(false)}
          >
            <CalendarIcon className="size-4" />
            {t("nav.timePeriods")}
          </Link>
          {isRoutesEnabled && (
            <Link
              href="/routes"
              className="text-foreground hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
              onClick={() => setMoreOpen(false)}
            >
              <RouteIcon className="size-4" />
              {t("nav.routes")}
            </Link>
          )}
          <Link
            href="/toolbox"
            className="text-foreground hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
            onClick={() => setMoreOpen(false)}
          >
            <WrenchIcon className="size-4" />
            {t("nav.toolbox")}
          </Link>
          <Link
            href="/settings"
            className="text-foreground hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
            onClick={() => setMoreOpen(false)}
          >
            <span className="relative">
              <SettingsIcon className="size-4" />
              <SettingsSetupDot />
            </span>
            {t("nav.settings")}
          </Link>
          {isLiveTrainingEnabled && (
            <Link
              href="/live-training"
              className="text-foreground hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
              onClick={() => setMoreOpen(false)}
            >
              <PlayCircleIcon className="size-4" />
              {t("nav.liveTraining")}
            </Link>
          )}
          <Link
            href="/privacy"
            className="text-foreground hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
            onClick={() => setMoreOpen(false)}
          >
            <ShieldCheckIcon className="size-4" />
            {t("nav.privacy")}
          </Link>
          <button
            className="text-foreground hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
            onClick={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              setMoreOpen(false);
            }}
          >
            {resolvedTheme === "dark" ? (
              <SunIcon className="size-4" />
            ) : (
              <MoonIcon className="size-4" />
            )}
            {resolvedTheme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
          </button>
          <button
            className="text-foreground hover:bg-accent flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOutIcon className="size-4" />
            {t("nav.logout")}
          </button>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="bg-sidebar border-sidebar-border fixed right-0 bottom-0 left-0 z-30 flex h-14 items-stretch border-t md:hidden">
        <MobileTabLink
          icon={CalendarDaysIcon}
          label={t("nav.journal")}
          href="/journal"
        />
        <MobileTabLink
          icon={ListIcon}
          label={t("nav.activities")}
          href="/activities"
        />
        <MobileTabLink
          icon={MapIcon}
          label={t("nav.map")}
          href="/map"
        />
        <MobileTabLink
          icon={BarChart3Icon}
          label={t("nav.statistics")}
          href="/statistics"
        />
        <button
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors",
            moreOpen
              ? "text-primary"
              : "text-muted-foreground active:text-foreground",
          )}
          onClick={() => setMoreOpen((prev) => !prev)}
        >
          <EllipsisIcon className="size-5" />
          <span>{t("nav.more")}</span>
        </button>
      </nav>
    </>
  );
}
