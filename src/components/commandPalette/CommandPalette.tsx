import * as React from "react";

import { startOfToday } from "date-fns";
import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/router";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { useTimeout } from "@base-ui/utils/useTimeout";

import {
  PlannedTrainingDialog,
  type PlannerDialogState,
} from "~/components/journal/PlannedTrainingDialog";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteItem,
  AutocompleteList,
} from "~/components/ui/autocomplete";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { useT } from "~/i18n/useT";

import {
  type CommandGroup,
  type CommandItem,
  type CommandStep,
  useCommandGroups,
} from "./useCommandGroups";

// Activity search waits for a pause in typing; local results update at once.
const SEARCH_DELAY_MS = 200;

/** Searches the app and runs its actions. Opened with Ctrl+K / ⌘K. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Outlives the palette, which closes to make room for it.
  const [plan, setPlan] = React.useState<PlannerDialogState>(null);
  const close = () => onOpenChange(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-label={t("commandPalette.label")}
          showCloseButton={false}
          initialFocus={inputRef}
          className="top-4 translate-y-0 gap-0 overflow-hidden p-0 sm:top-[12vh] sm:max-w-xl"
        >
          <CommandSearch
            inputRef={inputRef}
            onClose={close}
            onPlanSession={() => {
              close();
              setPlan({ mode: "create", date: startOfToday() });
            }}
          />
        </DialogContent>
      </Dialog>
      <PlannedTrainingDialog state={plan} onClose={() => setPlan(null)} />
    </>
  );
}

function CommandSearch({
  inputRef,
  onClose,
  onPlanSession,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onPlanSession: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [step, setStep] = React.useState<CommandStep>("root");
  const searchTimeout = useTimeout();

  const changeQuery = (next: string) => {
    setQuery(next);
    searchTimeout.start(SEARCH_DELAY_MS, () => setSearchQuery(next));
  };
  const goToStep = (next: CommandStep) => {
    setStep(next);
    changeQuery("");
    inputRef.current?.focus();
  };

  const { groups, searching, searchError } = useCommandGroups({
    query,
    searchQuery,
    step,
  });
  const status = searching
    ? t("commandPalette.searching")
    : searchError
      ? t("commandPalette.searchError")
      : null;

  const choose = (item: CommandItem) => {
    if (item.action === "start-ride") {
      goToStep("ride");
    } else if (item.action === "plan-session") {
      onPlanSession();
    } else if (item.href) {
      void router.push(item.href);
      onClose();
    }
  };

  return (
    <Autocomplete
      open
      inline
      items={groups}
      filter={null}
      value={query}
      onValueChange={(next, details) => {
        // Choosing an item acts on it rather than typing its label.
        if (details.reason !== "item-press") changeQuery(next);
      }}
      itemToStringValue={(item: CommandItem) => item.label}
      autoHighlight="always"
      keepHighlight
    >
      <div className="border-border flex items-center gap-2 border-b px-3">
        {step === "root" ? (
          <SearchIcon className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <button
            type="button"
            aria-label={t("commandPalette.back")}
            className="text-muted-foreground hover:text-foreground -ml-1 rounded-sm p-1"
            onClick={() => goToStep("root")}
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        )}
        <AutocompletePrimitive.Input
          ref={inputRef}
          aria-label={t("commandPalette.label")}
          placeholder={
            step === "root"
              ? t("commandPalette.placeholder")
              : t("commandPalette.ridePlaceholder")
          }
          className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-base outline-none sm:text-sm"
          onKeyDown={(event) => {
            if (step !== "root" && event.key === "Backspace" && !query) {
              goToStep("root");
            }
          }}
        />
      </div>
      <AutocompleteEmpty>
        {status ?? t("commandPalette.noResults")}
      </AutocompleteEmpty>
      <AutocompleteList className="max-h-[min(60dvh,28rem)] scroll-py-2 p-1.5 empty:hidden">
        {(group: CommandGroup) => (
          <AutocompleteGroup
            key={group.id}
            items={group.items}
            className="not-first:mt-1.5"
          >
            <AutocompleteGroupLabel>{group.label}</AutocompleteGroupLabel>
            <AutocompleteCollection>
              {(item: CommandItem) => (
                <CommandRow key={item.id} item={item} onChoose={choose} />
              )}
            </AutocompleteCollection>
          </AutocompleteGroup>
        )}
      </AutocompleteList>
      {groups.length > 0 && status && (
        <div
          role="status"
          className="border-border text-muted-foreground border-t px-3 py-2 text-xs"
        >
          {status}
        </div>
      )}
      <div className="border-border text-muted-foreground hidden items-center justify-end gap-4 border-t px-3 py-2 text-xs sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t("commandPalette.keys.navigate")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {t("commandPalette.keys.open")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {t("commandPalette.keys.close")}
        </span>
      </div>
    </Autocomplete>
  );
}

function CommandRow({
  item,
  onChoose,
}: {
  item: CommandItem;
  onChoose: (item: CommandItem) => void;
}) {
  const Icon = item.icon;
  return (
    <AutocompleteItem
      value={item}
      onClick={() => onChoose(item)}
      className="gap-3 py-2"
    >
      <Icon
        className="text-muted-foreground size-4 shrink-0"
        style={item.iconColor ? { color: item.iconColor } : undefined}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{item.label}</span>
        {item.description && (
          <span className="text-muted-foreground truncate text-xs">
            {item.description}
          </span>
        )}
      </span>
      {item.detail && (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {item.detail}
        </span>
      )}
    </AutocompleteItem>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border bg-muted inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[0.625rem]">
      {children}
    </kbd>
  );
}
