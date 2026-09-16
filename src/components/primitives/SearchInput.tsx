import { SearchIcon, XIcon } from "lucide-react";

import { useT } from "~/i18n/useT";

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const t = useT();
  return (
    <div className="border-border focus-within:ring-ring relative flex min-w-0 items-center rounded-md border focus-within:ring-1">
      <SearchIcon className="text-muted-foreground pointer-events-none absolute left-2.5 size-3.5" />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="placeholder:text-muted-foreground h-9 w-full min-w-0 rounded-md bg-transparent py-1 pr-9 pl-8 text-sm outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label={t("common.clearSearch")}
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground absolute right-0 flex size-9 items-center justify-center"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
