import * as React from "react";

import type { DragModifiers } from "@base-ui/plus/draggable";

import type { JournalDrop } from "./journalDnd";

const JournalDragPreviewModifiersContext = React.createContext<
  DragModifiers | undefined
>(undefined);
const JournalDragPreviewDropContext = React.createContext<
  JournalDrop | null | undefined
>(undefined);

/** Shared visual configuration and live destination for Journal drag previews. */
export function JournalDragPreviewProvider({
  modifiers,
  drop,
  children,
}: {
  modifiers: DragModifiers;
  drop: JournalDrop | null;
  children: React.ReactNode;
}) {
  return (
    <JournalDragPreviewModifiersContext.Provider value={modifiers}>
      <JournalDragPreviewDropContext.Provider value={drop}>
        {children}
      </JournalDragPreviewDropContext.Provider>
    </JournalDragPreviewModifiersContext.Provider>
  );
}

export function useJournalDragPreviewModifiers(): DragModifiers {
  const modifiers = React.useContext(JournalDragPreviewModifiersContext);
  if (modifiers === undefined) {
    throw new Error(
      "useJournalDragPreviewModifiers must be used within a JournalDragPreviewProvider",
    );
  }
  return modifiers;
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
