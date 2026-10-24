import * as React from "react";

import { PreviewCard } from "@base-ui/react/preview-card";

import type { JournalActivity } from "./useJournalWeeks";

/** Payload carried by an activity chip's detached preview trigger. */
export interface ActivityPreviewPayload {
  activity: JournalActivity;
  /** All-time record labels this activity holds, badged in the card. */
  records?: string[];
}

/**
 * The Base UI {@link PreviewCard} handle the Journal shares across its activity
 * hover cards. Rather than mounting a `PreviewCard.Root` per activity chip
 * (hundreds of floating-ui contexts on a busy calendar), one card is mounted
 * once and every chip is a cheap detached `PreviewCard.Trigger` that opens it
 * with its own payload.
 */
export interface JournalPreviewHandles {
  activity: PreviewCard.Handle<ActivityPreviewPayload>;
}

const JournalPreviewContext = React.createContext<JournalPreviewHandles | null>(
  null,
);

export const JournalPreviewProvider = JournalPreviewContext.Provider;

/** The shared preview-card handles; provided by the Journal. */
export function useJournalPreviewHandles(): JournalPreviewHandles {
  const handles = React.useContext(JournalPreviewContext);
  if (handles == null) {
    throw new Error(
      "useJournalPreviewHandles must be used within a JournalPreviewProvider",
    );
  }
  return handles;
}
