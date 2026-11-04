// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { Records } from "./Records";
import type { Category, RecordsExplorer } from "./useRecordsExplorer";

const categories = Array.from({ length: 16 }, (_, i): Category => ({
  id: `d${i}`,
  label: `${i + 1} min`,
  best: null,
  metric: "power",
  param: i + 1,
}));
const group = {
  key: "power",
  label: "Power",
  categories,
  fallback: categories[0],
};
const explorer = {
  sports: ["cycling"],
  sport: "cycling",
  title: "16 min",
  groups: [group],
  group,
  selectedId: "d15",
  bestsKnown: true,
  entries: [],
  isError: false,
  isLoading: false,
  isRefreshing: false,
  emptyMessage: "",
  select: vi.fn(),
  selectGroup: vi.fn(),
  selectSport: vi.fn(),
  retry: vi.fn(),
} as unknown as RecordsExplorer;

vi.mock("next/router", () => ({ useRouter: () => ({ query: {} }) }));
vi.mock("~/hooks/useIsMobile", () => ({ useIsMobile: () => true }));
vi.mock("~/i18n/useT", () => {
  const t = (key: string) => key;
  return { useT: () => t };
});
vi.mock("./useRecordsExplorer", () => ({
  useRecordsExplorer: () => explorer,
}));
afterEach(cleanup);

it("scrolls the selected category into view once the drawer's list mounts", async () => {
  const scrolled: Element[] = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
  ) {
    scrolled.push(this);
  });
  const view = render(<Records />);
  fireEvent.click(view.getByRole("button", { name: /16 min/ }));
  const selected = await view.findByRole("button", {
    name: /16 min/,
    current: "page",
  });
  await waitFor(() => expect(scrolled).toContain(selected));
});
