// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RideNavigationDialog } from "./RideNavigationDialog";

const navigation = vi.hoisted(() => ({
  open: true,
  proceed: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("~/hooks/useRideNavigationGuard", () => ({
  useRideNavigationGuard: () => navigation,
}));
vi.mock("~/i18n/useT", () => ({ useT: () => (key: string) => key }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
it("saves before continuing navigation", () => {
  const save = vi.fn(() => expect(navigation.proceed).not.toHaveBeenCalled());
  render(<RideNavigationDialog enabled onSave={save} />);
  fireEvent.click(screen.getByText("liveTraining.saveAndLeave"));
  expect(save).toHaveBeenCalledOnce();
  expect(navigation.proceed).toHaveBeenCalledOnce();
});
it("keeps the dialog open if saving fails", () => {
  render(
    <RideNavigationDialog
      enabled
      onSave={() => {
        throw new Error("export failed");
      }}
    />,
  );
  fireEvent.click(screen.getByText("liveTraining.saveAndLeave"));
  expect(screen.getByRole("alert").textContent).toBe("common.saveError");
  expect(navigation.proceed).not.toHaveBeenCalled();
});
it("discards without saving", () => {
  const save = vi.fn();
  render(<RideNavigationDialog enabled onSave={save} />);
  fireEvent.click(screen.getByText("liveTraining.discardAndLeave"));
  expect(save).not.toHaveBeenCalled();
  expect(navigation.proceed).toHaveBeenCalledOnce();
});
it("cancels without saving or leaving", () => {
  const save = vi.fn();
  render(<RideNavigationDialog enabled onSave={save} />);
  fireEvent.click(screen.getByText("common.cancel"));
  expect(save).not.toHaveBeenCalled();
  expect(navigation.proceed).not.toHaveBeenCalled();
  expect(navigation.cancel).toHaveBeenCalledOnce();
});
