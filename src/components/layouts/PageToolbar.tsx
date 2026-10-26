import type { ElementType, ReactNode } from "react";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import { Toolbar } from "@base-ui/react/toolbar";

import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

interface PageToolbarTab {
  label: string;
  icon: ElementType;
  href: string;
  active: boolean;
}

/** Owns the title, actions and subpage navigation for every app page. */
export function PageToolbar({
  title,
  icon: Icon,
  backHref,
  actions,
  children,
  tabs,
}: {
  title: string;
  icon: ElementType;
  backHref?: string;
  actions?: ReactNode;
  children?: ReactNode;
  tabs?: { label: string; items: readonly PageToolbarTab[] };
}) {
  const t = useT();
  return (
    <Toolbar.Root
      render={<header />}
      aria-label={title}
      className="border-border bg-background flex min-h-14 min-w-0 shrink-0 items-stretch gap-4 border-b px-4 md:min-h-16"
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 py-2",
          tabs ? "shrink-0" : "flex-1",
        )}
      >
        {backHref && (
          <Toolbar.Link
            render={<Link href={backHref} />}
            aria-label={t("common.back")}
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring -ml-2 flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
          >
            <ArrowLeftIcon className="size-4" />
          </Toolbar.Link>
        )}
        <Icon className="size-4 shrink-0" />
        <h1 className="min-w-0 truncate text-base font-semibold" title={title}>
          {title}
        </h1>
        {children}
      </div>
      {tabs && (
        <nav
          aria-label={tabs.label}
          className="flex min-w-0 flex-1 [scrollbar-width:thin] items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain md:gap-4"
        >
          {tabs.items.map(({ label, icon: TabIcon, href, active }) => (
            <Toolbar.Link
              key={href}
              render={<Link href={href} scroll={false} />}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring relative flex min-h-11 min-w-max flex-1 items-center justify-center gap-1.5 px-2 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset md:flex-none",
                active
                  ? "text-foreground after:bg-primary font-medium after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <TabIcon className="size-4 shrink-0" />
              {label}
            </Toolbar.Link>
          ))}
        </nav>
      )}
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-2 py-2">
          {actions}
        </div>
      )}
    </Toolbar.Root>
  );
}
