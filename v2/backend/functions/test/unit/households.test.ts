import { describe, expect, it } from "vitest";
import { EMPTY_HOUSEHOLD_ACTIVITY, shapeHouseholdActivity } from "../../src/core/households";

const row = (homeId: string, homeName: string, entries: number, entriesInMonth: number) => ({
  homeId, homeName, members: 1, entries, entriesInMonth, lastEntryAt: null,
});

describe("shapeHouseholdActivity", () => {
  it("totals entries and counts households active in the month", () => {
    const s = shapeHouseholdActivity([row("a", "A", 10, 3), row("b", "B", 5, 0), row("c", "C", 0, 0)]);
    expect(s).toMatchObject({ available: true, households: 3, entries: 15, entriesInMonth: 3, activeInMonth: 1 });
  });

  it("sorts by entries this month, then all time, then name", () => {
    const s = shapeHouseholdActivity([row("x", "Zed", 50, 0), row("y", "Amy", 5, 2), row("z", "Bob", 50, 0), row("w", "Cat", 1, 2)]);
    expect(s.byHousehold.map((r) => r.homeName)).toEqual(["Amy", "Cat", "Bob", "Zed"]);
  });

  it("handles no households", () => {
    expect(shapeHouseholdActivity([])).toEqual({ ...EMPTY_HOUSEHOLD_ACTIVITY, available: true });
  });
});
