// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { renderHook } from "@testing-library/react";

import { useAthleteId } from "./useAthleteId";

it("throws outside LoggedInLayout rather than returning no athlete", () => {
  expect(() => renderHook(() => useAthleteId())).toThrow(
    "useAthleteId must be used under LoggedInLayout",
  );
});
