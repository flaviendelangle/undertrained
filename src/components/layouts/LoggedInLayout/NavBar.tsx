import * as React from "react";

import {
  BikeIcon,
  CalendarDaysIcon,
  EllipsisIcon,
  FolderOpenIcon,
  HeartPulseIcon,
  ListIcon,
  LogOutIcon,
  MoonIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SunIcon,
  TrophyIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tooltip, TooltipProps } from "~/components/primitives/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { PopoverTrigger } from "~/components/ui/popover";
import { useActivityView } from "~/hooks/useActivityView";
import {
  COMMAND_PALETTE_SHORTCUT,
  useCommandPalette,
} from "~/hooks/useCommandPalette";
import { useRiderSettingsTimeline } from "~/hooks/useRiderSettings";
import {
  SYNC_TRIGGER_ID,
  useSyncPanel,
  useSyncPanelHandle,
} from "~/hooks/useSyncPanel";
import { useTheme } from "~/hooks/useTheme";
import { useT } from "~/i18n/useT";
import { isRoutesEnabled } from "~/lib/features";
import { cn } from "~/lib/utils";

import { NavBarContext } from "./NavBarContext";

interface NavBarLinkProps {
  icon: React.ElementType;
  label: string;
  href: string;
  activeFor?: string;
  badge?: React.ReactNode;
}

function NavBarLink({
  icon: Icon,
  label,
  href,
  activeFor,
  badge,
}: NavBarLinkProps) {
  const { isMenuExpanded } = React.useContext(NavBarContext);
  const pathname = usePathname();
  const isActive = (pathname ?? "").startsWith(activeFor ?? href);

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
      aria-current={isActive ? "page" : undefined}
    >
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
  /** Shown at the end of the expanded button, e.g. a keyboard shortcut. */
  hint?: string;
}

function NavBarButton({ icon: Icon, label, onClick, hint }: NavBarButtonProps) {
  const { isMenuExpanded } = React.useContext(NavBarContext);

  return (
    <button
      className="text-muted-foreground hover:bg-accent hover:text-foreground mx-2 flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors"
      aria-label={label}
      onClick={onClick}
    >
      <Icon className="size-4.5 shrink-0" />
      {isMenuExpanded && <span>{label}</span>}
      {isMenuExpanded && hint && (
        <span className="ml-auto text-xs font-normal">{hint}</span>
      )}
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
  const scope = useActivityView();
  const syncHandle = useSyncPanelHandle();
  const openCommandPalette = useCommandPalette();
  const [isMenuExpanded, setIsMenuExpanded] = React.useState(false);

  return (
    <NavBarContext value={{ isMenuExpanded }}>
      <nav
        data-expanded={isMenuExpanded}
        className="bg-sidebar border-sidebar-border hidden h-full w-14 shrink-0 flex-col justify-between border-r py-3 data-[expanded=true]:w-52 md:flex"
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
              <Image
                src="/favicon.svg"
                alt=""
                width={20}
                height={20}
                className="size-5 shrink-0"
              />
              {isMenuExpanded ? (
                <>
                  <span className="text-foreground flex-1">Undertrained</span>
                  <XIcon className="text-muted-foreground size-4" />
                </>
              ) : null}
            </button>
          </TooltipIfMenuCollapsed>

          <TooltipIfMenuCollapsed
            label={t("commandPalette.shortcut", {
              shortcut: COMMAND_PALETTE_SHORTCUT,
            })}
          >
            <NavBarButton
              icon={SearchIcon}
              label={t("commandPalette.label")}
              hint={COMMAND_PALETTE_SHORTCUT}
              onClick={openCommandPalette}
            />
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
              href={scope.href("/activities")}
              activeFor="/activities"
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.fitness")}>
            <NavBarLink
              icon={HeartPulseIcon}
              label={t("nav.fitness")}
              href="/fitness"
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.personalBests")}>
            <NavBarLink
              icon={TrophyIcon}
              label={t("nav.personalBests")}
              href="/personal-bests"
            />
          </TooltipIfMenuCollapsed>
          <TooltipIfMenuCollapsed label={t("nav.views")}>
            <NavBarLink
              icon={FolderOpenIcon}
              label={t("nav.views")}
              href="/views"
            />
          </TooltipIfMenuCollapsed>
          {isRoutesEnabled && (
            <TooltipIfMenuCollapsed label={t("routes.myRoutes")}>
              <NavBarLink
                icon={RouteIcon}
                label={t("routes.myRoutes")}
                href="/routes"
              />
            </TooltipIfMenuCollapsed>
          )}
          <TooltipIfMenuCollapsed label={t("nav.workouts")}>
            <NavBarLink
              icon={BikeIcon}
              label={t("nav.workouts")}
              href="/workouts"
            />
          </TooltipIfMenuCollapsed>
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
          <TooltipIfMenuCollapsed label={t("sync.label")}>
            <PopoverTrigger
              id={SYNC_TRIGGER_ID}
              handle={syncHandle}
              aria-label={t("sync.label")}
              className="text-muted-foreground hover:bg-accent hover:text-foreground mx-2 flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors"
            >
              <RefreshCwIcon className="size-4.5 shrink-0" />
              {isMenuExpanded && <span>{t("sync.label")}</span>}
            </PopoverTrigger>
          </TooltipIfMenuCollapsed>
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
  activeFor?: string;
}

const MOBILE_TAB_CLASS =
  "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors";

function MobileTabLink({
  icon: Icon,
  label,
  href,
  activeFor,
}: MobileTabLinkProps) {
  const pathname = usePathname();
  const isActive = (pathname ?? "").startsWith(activeFor ?? href);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        MOBILE_TAB_CLASS,
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

function MobileTabButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        MOBILE_TAB_CLASS,
        "text-muted-foreground active:text-foreground",
      )}
    >
      <Icon className="size-5" />
      <span>{label}</span>
    </button>
  );
}

export function MobileBottomBar() {
  const scope = useActivityView();
  const openSync = useSyncPanel();
  const openCommandPalette = useCommandPalette();
  const pathname = usePathname() ?? "";
  const moreActive = [
    "/personal-bests",
    "/views",
    "/toolbox",
    "/settings",
    "/workouts",
    "/routes",
    "/privacy",
  ].some((path) => pathname.startsWith(path));
  const t = useT();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <nav className="bg-sidebar border-sidebar-border fixed right-0 bottom-0 left-0 z-30 flex h-14 items-stretch border-t md:hidden">
      <MobileTabLink
        icon={CalendarDaysIcon}
        label={t("nav.journal")}
        href="/journal"
      />
      <MobileTabLink
        icon={ListIcon}
        label={t("nav.activities")}
        href={scope.href("/activities")}
        activeFor="/activities"
      />
      <MobileTabLink
        icon={HeartPulseIcon}
        label={t("nav.fitness")}
        href="/fitness"
      />
      <MobileTabButton
        icon={SearchIcon}
        label={t("commandPalette.label")}
        onClick={openCommandPalette}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          data-active={moreActive}
          className="text-muted-foreground data-[active=true]:text-primary data-popup-open:text-primary active:text-foreground flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-colors"
        >
          <EllipsisIcon className="size-5" />
          <span>{t("nav.more")}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-56 rounded-xl"
        >
          {isRoutesEnabled && (
            <DropdownMenuLinkItem closeOnClick render={<Link href="/routes" />}>
              <RouteIcon />
              {t("routes.myRoutes")}
            </DropdownMenuLinkItem>
          )}
          <DropdownMenuItem onClick={openSync}>
            <RefreshCwIcon />
            {t("sync.label")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLinkItem
            closeOnClick
            aria-current={
              pathname.startsWith("/personal-bests") ? "page" : undefined
            }
            className="aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
            render={<Link href="/personal-bests" />}
          >
            <TrophyIcon className="size-4" />
            {t("nav.personalBests")}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            closeOnClick
            aria-current={pathname.startsWith("/views") ? "page" : undefined}
            className="aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
            render={<Link href="/views" />}
          >
            <FolderOpenIcon className="size-4" />
            {t("nav.views")}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            closeOnClick
            aria-current={pathname.startsWith("/toolbox") ? "page" : undefined}
            className="aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
            render={<Link href="/toolbox" />}
          >
            <WrenchIcon className="size-4" />
            {t("nav.toolbox")}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            closeOnClick
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className="aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
            render={<Link href="/settings" />}
          >
            <span className="relative">
              <SettingsIcon className="size-4" />
              <SettingsSetupDot />
            </span>
            {t("nav.settings")}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            closeOnClick
            aria-current={pathname.startsWith("/workouts") ? "page" : undefined}
            className="aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
            render={<Link href="/workouts" />}
          >
            <BikeIcon className="size-4" />
            {t("nav.workouts")}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            closeOnClick
            aria-current={pathname.startsWith("/privacy") ? "page" : undefined}
            className="aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
            render={<Link href="/privacy" />}
          >
            <ShieldCheckIcon className="size-4" />
            {t("nav.privacy")}
          </DropdownMenuLinkItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }}
          >
            {resolvedTheme === "dark" ? (
              <SunIcon className="size-4" />
            ) : (
              <MoonIcon className="size-4" />
            )}
            {resolvedTheme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
            <LogOutIcon className="size-4" />
            {t("nav.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
