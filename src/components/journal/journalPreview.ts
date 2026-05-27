import * as React from "react";

import { PreviewCard } from "@base-ui/react/preview-card";

import type { JournalActivity, JournalWeek } from "./useJournalWeeks";

/** Payload carried by an activity chip's detached preview trigger. */
export interface ActivityPreviewPayload {
  activity: JournalActivity;
  /** All-time record labels this activity holds, badged in the card. */
  records?: string[];
}

/**
 * The two Base UI {@link PreviewCard} handles the Journal shares across all of
 * its hover cards. Rather than mounting a `PreviewCard.Root` per activity chip
 * and per week summary (hundreds of floating-ui contexts on a busy calendar),
 * one card of each kind is mounted once and every chip / summary is a cheap
 * detached `PreviewCard.Trigger` that opens it with its own payload.
 */
export interface JournalPreviewHandles {
  activity: PreviewCard.Handle<ActivityPreviewPayload>;
  summary: PreviewCard.Handle<JournalWeek>;
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
