import { LockIcon } from "lucide-react";

import { CardTitle } from "~/components/primitives/CardTitle";
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";

/**
 * The athlete's own words about the activity: the public description and the
 * private note, side by side on desktop when both exist. Renders nothing
 * without either.
 */
export function ActivityNotes({
  description,
  privateNote,
}: {
  description: string | null;
  privateNote: string | null;
}) {
  const t = useT();
  const descriptionText = normalize(description);
  const noteText = normalize(privateNote);
  if (!descriptionText && !noteText) return null;
  const both = !!descriptionText && !!noteText;

  return (
    <div
      className={cn(
        "md:border-border md:bg-card grid p-5 md:rounded-sm md:border",
        both && "md:grid-cols-2 md:divide-x",
      )}
    >
      {descriptionText && (
        <section className={cn("min-w-0", both && "md:pr-6")}>
          <CardTitle className="mb-3">{t("activities.description")}</CardTitle>
          <NoteText text={descriptionText} />
        </section>
      )}
      {noteText && (
        <section
          className={cn(
            "min-w-0",
            both &&
              "border-border mt-5 border-t pt-5 md:mt-0 md:border-t-0 md:pt-0 md:pl-6",
          )}
        >
          <CardTitle className="mb-3">
            <span className="inline-flex items-center gap-2">
              {t("activities.privateNote")}
              {/* The one mark that tells the private note from the public
                  description at a glance. */}
              <LockIcon className="text-muted-foreground size-4" aria-hidden />
            </span>
          </CardTitle>
          <NoteText text={noteText} />
        </section>
      )}
    </div>
  );
}

/**
 * The text as typed, line breaks included: a strength log keeps one exercise
 * per line and the blank lines that group them, a paragraph keeps its measure.
 */
function NoteText({ text }: { text: string }) {
  return (
    <p className="max-w-prose text-base leading-relaxed whitespace-pre-wrap tabular-nums">
      {text}
    </p>
  );
}

/**
 * Tidies the raw text for display without touching its content: Windows line
 * endings, trailing spaces and runs of blank lines (one is enough to separate
 * two groups) go, and an empty note counts as none.
 */
function normalize(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
