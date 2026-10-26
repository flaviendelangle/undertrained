import { type ReactNode, createContext, useContext, useState } from "react";

const InspectionContainer = createContext<HTMLDivElement | null>(null);

/** The timeline's desktop inspector sits beside the scrollable charts column. */
export function TimelineInspectionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <InspectionContainer value={container}>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
        <div
          ref={setContainer}
          className="border-border bg-background hidden w-80 shrink-0 border-l empty:hidden md:flex"
        />
      </div>
    </InspectionContainer>
  );
}

export function useTimelineInspectionContainer() {
  return useContext(InspectionContainer);
}
