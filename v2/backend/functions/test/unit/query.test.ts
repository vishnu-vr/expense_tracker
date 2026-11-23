import { describe, expect, it } from "vitest";
import { comparePeriods } from "../../src/core/compare";
import { filterTransactions, queryTransactions } from "../../src/core/query";
import { home, tx } from "./helpers";

const data = home([
  tx("2026-09-03", 100, "food", "Swiggy dinner", { id: "a" }),
  tx("2026-09-10", 250.5, "food", "lunch", { id: "b", userId: "u2" }),
  tx("2026-09-28", 1000, "grocery", "DMart", { id: "c", tagIds: ["trip"] }),
  tx("2026-10-05", 400, "food", "swiggy", { id: "d" }),
  tx("2026-10-06", 60, "transportation", "Uber", { id: "e", userId: "u2" }),
  tx("2026-10-17", 5000, "shopping", "Amazon phone case", { id: "f" }),
  tx("2026-10-01", 50000, "salary", "Salary", { id: "g", type: "income" }),
  tx("2026-12-01", 75, "food", "coffee", { id: "h" }),
]);

describe("queryTransactions", () => {
  it("defaults to expenses and computes exact totals", () => {
    const r = queryTransactions(data, { from: "2026-10-01", to: "2026-10-31" });
    expect(r.appliedFilter.type).toBe("expense");
    expect(r.summary.expenseTotal).toBe(5460);
    expect(r.summary.expenseTotalDisplay).toBe("₹5,460");
    expect(r.summary.expenseCount).toBe(3);
    expect(r.summary.expenseAverage).toBe(1820);
    expect(r.summary.incomeTotal).toBe(0);
    expect(r.summary.largest?.id).toBe("f");
    expect(r.summary.smallest?.id).toBe("e");
    expect(r.summary.daysInRange).toBe(31);
    expect(r.summary.expensePerDay).toBe(176.13);
  });

  it("handles income, all and net", () => {
    const all = queryTransactions(data, { from: "2026-10-01", to: "2026-10-31", type: "all" });
    expect(all.summary.incomeTotal).toBe(50000);
    expect(all.summary.net).toBe(44540);
    expect(all.summary.netDisplay).toBe("₹44,540");
    expect(all.summary.count).toBe(4);
    expect(queryTransactions(data, { type: "income" }).summary.incomeCount).toBe(1);
  });

  it("applies every filter", () => {
    const ids = (f: Parameters<typeof filterTransactions>[1]) => filterTransactions(data.transactions, f).map((t) => t.id).sort();
    expect(ids({ categoryIds: ["food"], type: "expense" })).toEqual(["a", "b", "d", "h"]);
    expect(ids({ tagIds: ["trip"] })).toEqual(["c"]);
    expect(ids({ userIds: ["u2"] })).toEqual(["b", "e"]);
    expect(ids({ minAmount: 1000, type: "expense" })).toEqual(["c", "f"]);
    expect(ids({ maxAmount: 100 })).toEqual(["a", "e", "h"]);
    expect(ids({ text: "SWIGGY" })).toEqual(["a", "d"]);
    expect(ids({ text: "uber" })).toEqual(["e"]);
    expect(ids({ from: "2026-09-10", to: "2026-09-28" })).toEqual(["b", "c"]); // inclusive both ends
  });

  it("groups by category with shares, sorted by total", () => {
    const r = queryTransactions(data, { from: "2026-09-01", to: "2026-10-31" }, { groupBy: "category" });
    expect(r.groups.map((g) => [g.label, g.total, g.count])).toEqual([
      ["Shopping", 5000, 1],
      ["Grocery", 1000, 1],
      ["Food", 750.5, 3],
      ["Transportation", 60, 1],
    ]);
    expect(r.groups[0].sharePct).toBe(73.4);
    expect(r.groups[2].average).toBe(250.17);
    expect(r.groups[2].totalDisplay).toBe("₹750.50");
  });

  it("groups by month chronologically and fills empty months so averages are honest", () => {
    const r = queryTransactions(data, { from: "2026-09-01", to: "2026-12-31" }, { groupBy: "month" });
    expect(r.groups.map((g) => [g.key, g.total])).toEqual([
      ["2026-09", 1350.5],
      ["2026-10", 5460],
      ["2026-11", 0],
      ["2026-12", 75],
    ]);
    expect(r.averagePerGroup).toBe(1721.38);
    expect(r.groups[0].label).toBe("September 2026");
  });

  it("groups by week, weekday, member and merchant", () => {
    const week = queryTransactions(data, { from: "2026-10-01", to: "2026-10-18" }, { groupBy: "week" });
    expect(week.groups.map((g) => [g.key, g.total])).toEqual([
      ["2026-09-28", 0],
      ["2026-10-05", 460],
      ["2026-10-12", 5000],
    ]);
    const weekday = queryTransactions(data, { from: "2026-10-01", to: "2026-10-31" }, { groupBy: "weekday" });
    expect(weekday.groups).toHaveLength(7);
    expect(weekday.groups.find((g) => g.label === "Saturday")?.total).toBe(5000);
    expect(weekday.groups.find((g) => g.label === "Monday")?.total).toBe(400);
    const member = queryTransactions(data, {}, { groupBy: "member" });
    expect(member.groups.map((g) => [g.label, g.total])).toEqual([["Asha", 6575], ["Vikram", 310.5]]);
    const merchant = queryTransactions(data, {}, { groupBy: "merchant" });
    expect(merchant.groups.find((g) => g.label === "Swiggy")).toMatchObject({ total: 500, count: 2 });
    expect(merchant.groups.find((g) => g.key === "(other)")?.count).toBe(2);
  });

  it("with type=all groups expenses and reports income alongside", () => {
    const r = queryTransactions(data, { from: "2026-10-01", to: "2026-10-31", type: "all" }, { groupBy: "month" });
    expect(r.groupsBasis).toBe("expense");
    expect(r.groups[0]).toMatchObject({ total: 5460, incomeTotal: 50000 });
  });

  it("caps rows and groups and says so", () => {
    const r = queryTransactions(data, {}, { rowLimit: 2, rowSort: "amount_desc", groupBy: "category", topN: 2 });
    expect(r.rows.map((x) => x.id)).toEqual(["f", "c"]);
    expect(r.rowsTruncated).toBe(true);
    expect(r.groups).toHaveLength(2);
    expect(r.groupsTruncated).toBe(true);
    expect(r.groupCount).toBe(4);
    expect(queryTransactions(data, {}, { rowLimit: 9999 }).rows.length).toBeLessThanOrEqual(50);
    expect(r.rows[0]).toMatchObject({ categoryName: "Shopping", memberName: "Asha", merchant: "Amazon", amountDisplay: "₹5,000", date: "2026-10-17" });
  });

  it("returns zeros, not errors, when nothing matches", () => {
    const r = queryTransactions(data, { categoryIds: ["insurance"] }, { groupBy: "category" });
    expect(r.summary).toMatchObject({ count: 0, expenseTotal: 0, largest: null });
    expect(r.groups).toEqual([]);
    expect(r.averagePerGroup).toBeNull();
  });
});

describe("comparePeriods", () => {
  it("reports totals and per-category deltas (B − A)", () => {
    const r = comparePeriods(data, { from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" });
    expect(r.periodA.total).toBe(1350.5);
    expect(r.periodB.total).toBe(5460);
    expect(r.delta).toBe(4109.5);
    expect(r.deltaPct).toBe(304.3);
    expect(r.direction).toBe("up");
    expect(r.categories.map((c) => [c.categoryId, c.totalA, c.totalB, c.delta, c.deltaPct])).toEqual([
      ["shopping", 0, 5000, 5000, null],
      ["grocery", 1000, 0, -1000, -100],
      ["transportation", 0, 60, 60, null],
      ["food", 350.5, 400, 49.5, 14.1],
    ]);
    expect(r.categories[1].deltaDisplay).toBe("-₹1,000");
  });
  it("supports income and filters", () => {
    const r = comparePeriods(data, { from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" }, { type: "income" });
    expect(r.periodB.total).toBe(50000);
    expect(r.deltaPct).toBeNull();
    const food = comparePeriods(data, { from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" }, { categoryIds: ["food"], userIds: ["u1"] });
    expect([food.periodA.total, food.periodB.total]).toEqual([100, 400]);
  });
});
