import * as React from "react";

import type { DragPreviewSettings } from "@base-ui/react/draggable";

import type { JournalDrop } from "./journalDnd";

const JournalDragPreviewSettingsContext = React.createContext<
  DragPreviewSettings | undefined
>(undefined);
const JournalDragPreviewDropContext = React.createContext<
  JournalDrop | null | undefined
>(undefined);

/** Shared visual configuration and live destination for Journal drag previews. */
export function JournalDragPreviewProvider({
  settings,
  drop,
  children,
}: {
  settings: DragPreviewSettings;
  drop: JournalDrop | null;
  children: React.ReactNode;
}) {
  return (
    <JournalDragPreviewSettingsContext.Provider value={settings}>
      <JournalDragPreviewDropContext.Provider value={drop}>
        {children}
      </JournalDragPreviewDropContext.Provider>
    </JournalDragPreviewSettingsContext.Provider>
  );
}

export function useJournalDragPreviewSettings(): DragPreviewSettings {
  const settings = React.useContext(JournalDragPreviewSettingsContext);
  if (settings === undefined) {
    throw new Error(
      "useJournalDragPreviewSettings must be used within a JournalDragPreviewProvider",
    );
  }
  return settings;
}

export function useJournalDragPreviewDrop(): JournalDrop | null {
  const drop = React.useContext(JournalDragPreviewDropContext);
  if (drop === undefined) {
    throw new Error(
      "useJournalDragPreviewDrop must be used within a JournalDragPreviewProvider",
    );
  }
  return drop;
}
