import * as React from "react";

import { useSession } from "next-auth/react";

/**
 * The signed-in athlete's id. `LoggedInLayout` provides it once the session is
 * authenticated, and only then renders the page, so nothing under it has to
 * handle a missing id.
 */
export const AthleteIdContext = React.createContext<number | null>(null);

/** The signed-in athlete's id. Only available under `LoggedInLayout`. */
export function useAthleteId(): number {
  const athleteId = React.useContext(AthleteIdContext);
  if (athleteId == null) {
    throw new Error(
      "useAthleteId must be used under LoggedInLayout; use useOptionalAthleteId where the athlete may be signed out",
    );
  }
  return athleteId;
}

/**
 * The athlete's id when signed in, read from the session rather than the
 * layout: for code that also renders on public pages or above
 * `LoggedInLayout`'s provider, like the i18n provider in `SharedLayout`.
 */
export function useOptionalAthleteId(): number | undefined {
  const { data: session } = useSession();
  return session?.athleteId;
}
