import { describe, expect, it } from "vitest";
import { compareToAverage, rangeLabel, resolveComparison, resolvePeriod } from "../../src/core/compare";
import { buildReport, formatSignedINR, hasEntries, monthlyReportId, parseReportPeriod, ReportRequestError } from "../../src/core/report";
import { home, tx } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const metric = (r: ReturnType<typeof buildReport>, key: string) => r.sections.headline.metrics.find((m) => m.key === key)!;

describe("period resolution and comparison modes", () => {
  it("labels calendar months, month to date and ranges", () => {
    expect(resolvePeriod(OCT)).toMatchObject({ label: "October 2026", days: 31, shape: "month" });
    expect(resolvePeriod({ from: "2026-11-01", to: "2026-11-23" })).toMatchObject({ label: "1–23 Nov 2026", days: 23, shape: "month_to_date" });
    expect(resolvePeriod({ from: "2026-08-25", to: "2026-09-03" })).toMatchObject({ label: "25 Aug – 3 Sep 2026", shape: "range" });
    expect(rangeLabel({ from: "2025-12-25", to: "2026-01-03" })).toBe("25 Dec 2025 – 3 Jan 2026");
    expect(rangeLabel({ from: "2026-03-03", to: "2026-03-03" })).toBe("3 Mar 2026");
  });

  it("previous: calendar month, month to date (same days of last month) and same-length range", () => {
    expect(resolveComparison(OCT, "previous")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "September 2026", days: 30 });
    expect(resolveComparison({ from: "2026-03-01", to: "2026-03-31" }, "previous")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    // 1–31 Mar so far → Feb is clamped to its last day.
    expect(resolveComparison({ from: "2026-11-01", to: "2026-11-23" }, "previous")).toMatchObject({ from: "2026-10-01", to: "2026-10-23", label: "1–23 Oct 2026" });
    expect(resolveComparison({ from: "2026-03-01", to: "2026-03-30" }, "previous")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveComparison({ from: "2026-11-10", to: "2026-11-16" }, "previous")).toMatchObject({ from: "2026-11-03", to: "2026-11-09", days: 7 });
  });

  it("last_year, average, custom and none", () => {
    expect(resolveComparison(OCT, "last_year")).toMatchObject({ from: "2025-10-01", to: "2025-10-31", label: "October 2025" });
    expect(resolveComparison({ from: "2028-02-29", to: "2028-03-05" }, "last_year")).toMatchObject({ from: "2027-02-28", to: "2027-03-05" });
    const avg = resolveComparison(OCT, "average")!;
    expect(avg.ranges).toEqual([
      { from: "2026-07-01", to: "2026-07-31" },
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-09-01", to: "2026-09-30" },
    ]);
    expect(avg).toMatchObject({ from: "2026-07-01", to: "2026-09-30", label: "3-month average (Jul–Sep 2026)", days: 92 });
    const mtd = resolveComparison({ from: "2026-11-01", to: "2026-11-23" }, "average")!;
    expect(mtd.ranges[0]).toEqual({ from: "2026-08-01", to: "2026-08-23" });
    expect(mtd.label).toBe("average of the same days in Aug–Oct 2026");
    expect(resolveComparison({ from: "2026-11-10", to: "2026-11-16" }, "average")!.ranges).toEqual([
      { from: "2026-10-20", to: "2026-10-26" },
      { from: "2026-10-27", to: "2026-11-02" },
      { from: "2026-11-03", to: "2026-11-09" },
    ]);
    expect(resolveComparison(OCT, "custom", { from: "2026-08-01", to: "2026-08-15" })).toMatchObject({ label: "1–15 Aug 2026", days: 15 });
    expect(resolveComparison(OCT, "none")).toBeNull();
  });
});

describe("compareToAverage", () => {
  it("averages the baseline periods that have entries and never divides by zero", () => {
    const data = home([
      tx("2026-07-10", 300, "food"),
      tx("2026-09-10", 900, "food"),
      tx("2026-09-12", 600, "grocery"),
      tx("2026-10-10", 1000, "food"),
    ]);
    const months = resolveComparison(OCT, "average")!.ranges;
    const r = compareToAverage(data, months, OCT);
    // August is empty: (300 + 1500) / 2 months.
    expect(r).toMatchObject({ periods: 3, periodsUsed: 2, delta: 100, deltaPctDisplay: "+11.1%" });
    expect(r.periodA.total).toBe(900);
    expect(r.categories.find((c) => c.categoryId === "food")).toMatchObject({ totalA: 600, totalB: 1000 });
    const empty = compareToAverage(data, [{ from: "2025-01-01", to: "2025-01-31" }], OCT);
    expect(empty).toMatchObject({ periodsUsed: 0, deltaPct: null, deltaPctDisplay: null });
    expect(empty.periodA.total).toBe(0);
  });
});

describe("parseReportPeriod", () => {
  const today = "2026-11-23";
  const bad = (d: unknown) => () => parseReportPeriod(d, today, 366);
  it("accepts a valid request and defaults to previous", () => {
    expect(parseReportPeriod({ from: "2026-10-01", to: "2026-10-31" }, today, 366)).toEqual({ from: "2026-10-01", to: "2026-10-31", compare: { mode: "previous" } });
    expect(parseReportPeriod({ from: "2026-10-01", to: "2026-10-31", compare: { mode: "custom", from: "2026-08-01", to: "2026-08-15" } }, today, 366).compare).toEqual({
      mode: "custom", from: "2026-08-01", to: "2026-08-15",
    });
  });
  it("enforces the 366-day limit, order, real dates, not the future and known modes", () => {
    expect(parseReportPeriod({ from: "2025-11-23", to: "2026-11-23" }, today, 366).from).toBe("2025-11-23"); // 366 days
    expect(bad({ from: "2025-11-22", to: "2026-11-23" })).toThrow(ReportRequestError);
    expect(bad({ from: "2026-10-31", to: "2026-10-01" })).toThrow(/after/);
    expect(bad({ from: "2026-02-30", to: "2026-03-01" })).toThrow(ReportRequestError);
    expect(bad({ from: "2026-11-01", to: "2026-11-24" })).toThrow(/future/);
    expect(bad({ from: "2026-10-01", to: "2026-10-31", compare: { mode: "weekly" } })).toThrow(/compare.mode/);
    expect(bad({ from: "2026-10-01", to: "2026-10-31", compare: { mode: "custom" } })).toThrow(/comparison/);
    expect(bad({ from: "2026-10-01", to: "2026-10-31", compare: { mode: "custom", from: "2024-01-01", to: "2026-01-31" } })).toThrow(/366/);
  });
});

describe("buildReport", () => {
  const data = home(
    [
      tx("2026-09-05", 1000, "food", "Swiggy", { id: "s1" }),
      tx("2026-09-12", 500, "transportation", "Uber", { id: "s2", userId: "u2" }),
      tx("2026-09-01", 50000, "salary", "Salary", { id: "s3", type: "income" }),
      tx("2026-10-03", 400, "food", "Swiggy", { id: "o1" }), // Saturday
      tx("2026-10-04", 800, "food", "Zomato", { id: "o2" }), // Sunday
      tx("2026-10-10", 3000, "shopping", "Amazon", { id: "o3", tagIds: ["trip"] }),
      tx("2026-10-15", 1200, "grocery", "DMart", { id: "o4", userId: "u2" }),
      tx("2026-10-01", 60000, "salary", "Salary", { id: "o5", type: "income" }),
      tx("2026-10-20", 250, "food", "Refund Swiggy", { id: "o6", type: "income" }), // a refund is income
    ],
    [{ categoryId: "food", amount: 1000 }],
  );

  it("computes the headline with comparisons, per-day averages and the savings rate", () => {
    const r = buildReport(data, OCT, resolveComparison(OCT, "previous"), "2026-11-23");
    expect(r.period.label).toBe("October 2026");
    expect(r.compare).toMatchObject({ mode: "previous", label: "September 2026", periods: 1, periodsUsed: 1 });
    expect(metric(r, "spent")).toMatchObject({ value: 5400, display: "₹5,400", compare: { base: 1500, deltaDisplay: "+₹3,900", deltaPctDisplay: "+260%" } });
    // The refund counts as income and does not reduce spending.
    expect(metric(r, "income")).toMatchObject({ value: 60250, display: "₹60,250" });
    expect(metric(r, "net")).toMatchObject({ value: 54850, display: "₹54,850" });
    expect(metric(r, "savingsRate")).toMatchObject({ display: "91%", compare: { deltaDisplay: "-6 pts", deltaPct: null } });
    expect(metric(r, "entries")).toMatchObject({ value: 6, compare: { baseDisplay: "3", deltaDisplay: "+3" } });
    // 5400 / 31 vs 1500 / 30
    expect(metric(r, "dailyAverage")).toMatchObject({ display: "₹174.19", compare: { baseDisplay: "₹50", deltaDisplay: "+₹124.19" } });
    expect(r.sections.headline.baselineNote).toBeNull();
  });

  it("builds categories with new and vanished flags, members, rhythm, merchants, tags and budgets", () => {
    const r = buildReport(data, OCT, resolveComparison(OCT, "previous"), "2026-11-23");
    const cats = r.sections.categories!.rows;
    expect(cats.map((c) => [c.categoryId, c.totalDisplay, c.status])).toEqual([
      ["shopping", "₹3,000", "new"],
      // Ties go to the larger baseline first.
      ["food", "₹1,200", null],
      ["grocery", "₹1,200", "new"],
      ["transportation", "₹0", "gone"],
    ]);
    expect(cats[1]).toMatchObject({ shareDisplay: "22.2%", count: 2, compare: { deltaDisplay: "+₹200", deltaPctDisplay: "+20%" } });
    expect(r.sections.members!.rows).toMatchObject([
      { name: "Asha", spentDisplay: "₹4,200", shareDisplay: "77.8%", compare: { baseDisplay: "₹1,000" } },
      { name: "Vikram", spentDisplay: "₹1,200", compare: { baseDisplay: "₹500", deltaDisplay: "+₹700" } },
    ]);
    const rhythm = r.sections.rhythm!;
    expect(rhythm.weekendShareDisplay).toBe("77.8%"); // 3, 4 and 10 Oct are a weekend
    expect(rhythm.biggestDay).toMatchObject({ date: "2026-10-10", totalDisplay: "₹3,000", count: 1 });
    expect(rhythm.weeks[0]).toMatchObject({ weekStart: "2026-09-28", total: 1200 });
    expect(rhythm.baseWeekendShareDisplay).toBe("100%");
    expect(r.sections.merchants!.bySpend[0]).toMatchObject({ name: "Amazon", rank: 1, isNew: true, rankChange: null });
    expect(r.sections.merchants!.bySpend.find((m) => m.name === "Swiggy")).toMatchObject({ rank: 4, rankChange: -3 });
    expect(r.sections.tags!.rows).toMatchObject([{ name: "Trip", totalDisplay: "₹3,000", compare: { deltaDisplay: "+₹3,000", deltaPctDisplay: null } }]);
    expect(r.sections.budgets).toMatchObject({
      monthLabel: "October 2026",
      baseLabel: "September 2026",
      rows: [{ categoryId: "food", spentDisplay: "₹1,200", usedPctDisplay: "120%", status: "over", base: { spentDisplay: "₹1,000", status: "within" } }],
    });
    expect(r.sections.notable!.largest.map((e) => e.id)).toEqual(["o3", "o4", "o2", "o1"]);
    expect(r.sections.notable!.largest[0]).toMatchObject({ label: "Amazon", amountDisplay: "₹3,000", memberName: "Asha", dateLabel: "10 Oct 2026" });
  });

  it("shows a member with no spending as ₹0", () => {
    const r = buildReport(home([tx("2026-10-03", 400, "food")]), OCT, null, "2026-11-23");
    expect(r.sections.members!.rows.map((m) => [m.name, m.spentDisplay])).toEqual([["Asha", "₹400"], ["Vikram", "₹0"]]);
  });

  it("an empty month has only the headline, and no comparison figures", () => {
    const r = buildReport(home([]), OCT, resolveComparison(OCT, "previous"), "2026-11-23");
    expect(Object.keys(r.sections)).toEqual(["headline"]);
    expect(metric(r, "spent")).toMatchObject({ value: 0, display: "₹0", compare: null });
    expect(metric(r, "savingsRate")).toMatchObject({ value: null, display: null });
    expect(r.sections.headline.baselineNote).toBe("No entries in September 2026 to compare with.");
  });

  it("an income-only month", () => {
    const r = buildReport(home([tx("2026-10-01", 60000, "salary", "Salary", { type: "income" })]), OCT, null, "2026-11-23");
    expect(metric(r, "income").display).toBe("₹60,000");
    expect(metric(r, "savingsRate").display).toBe("100%");
    expect(r.sections.categories).toBeUndefined();
    expect(r.sections.rhythm).toBeUndefined();
    expect(r.sections.members).toBeUndefined();
  });

  it("compares periods of different lengths fairly through the per-day average", () => {
    const d = home([tx("2026-08-05", 1500, "food"), tx("2026-10-05", 3100, "food")]);
    const r = buildReport(d, OCT, resolveComparison(OCT, "custom", { from: "2026-08-01", to: "2026-08-15" }), "2026-11-23");
    expect(metric(r, "spent").compare).toMatchObject({ deltaPctDisplay: "+106.7%" });
    // ₹100 a day both times.
    expect(metric(r, "dailyAverage")).toMatchObject({ display: "₹100", compare: { baseDisplay: "₹100", deltaDisplay: "₹0", deltaPctDisplay: "0%" } });
  });

  it("month to date against the same days of last month", () => {
    const d = home([tx("2026-10-05", 700, "food"), tx("2026-10-28", 5000, "food"), tx("2026-11-04", 900, "food")]);
    const period = { from: "2026-11-01", to: "2026-11-23" };
    const r = buildReport(d, period, resolveComparison(period, "previous"), "2026-11-23");
    expect(r.period.label).toBe("1–23 Nov 2026");
    expect(metric(r, "spent").compare).toMatchObject({ baseDisplay: "₹700", deltaDisplay: "+₹200" });
  });

  it("average with a missing month divides by the months that have entries", () => {
    const d = home([tx("2026-07-05", 600, "food"), tx("2026-09-05", 1200, "food"), tx("2026-10-05", 1000, "food")]);
    const r = buildReport(d, OCT, resolveComparison(OCT, "average"), "2026-11-23");
    expect(r.compare).toMatchObject({ periods: 3, periodsUsed: 2, label: "3-month average (Jul–Sep 2026)" });
    expect(metric(r, "spent").compare).toMatchObject({ baseDisplay: "₹900", deltaDisplay: "+₹100" });
    expect(metric(r, "entries").compare).toMatchObject({ baseDisplay: "1" });
  });

  it("reports paid and missed bills, price changes, anomalies and duplicates", () => {
    const d = home([
      ...["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05"].map((day) => tx(day, 499, "bills", "Netflix")),
      tx("2026-10-05", 649, "bills", "Netflix", { id: "nf" }),
      ...["2026-07-02", "2026-08-02", "2026-09-02"].map((day) => tx(day, 1200, "bills", "Broadband")),
      ...["2026-09-03", "2026-09-08", "2026-09-14", "2026-09-20", "2026-09-26"].map((day) => tx(day, 300, "food", "Swiggy")),
      tx("2026-10-12", 4000, "food", "Swiggy", { id: "big" }),
      tx("2026-10-14", 250, "food", "Chai", { id: "d1" }),
      tx("2026-10-14", 250, "food", "Chai", { id: "d2" }),
    ]);
    const r = buildReport(d, OCT, null, "2026-11-23");
    const bills = r.sections.bills!;
    expect(bills.paid.map((b) => [b.label, b.amountDisplay])).toContainEqual(["Netflix", "₹649"]);
    expect(bills.missed.map((b) => [b.label, b.dateLabel])).toEqual([["Broadband", "3 Oct 2026"]]);
    expect(bills.priceChanges).toMatchObject([{ label: "Netflix", previousAmountDisplay: "₹499", currentAmountDisplay: "₹649", deltaDisplay: "+₹150" }]);
    expect(r.sections.notable!.anomalies).toMatchObject([{ entry: { id: "big" }, basisLabel: "Swiggy", typicalAmountDisplay: "₹300" }]);
    expect(r.sections.notable!.duplicates).toMatchObject([{ count: 2, transactionIds: ["d1", "d2"], amountDisplay: "₹250" }]);
  });

  it("helpers", () => {
    expect(formatSignedINR(1500)).toBe("+₹1,500");
    expect(formatSignedINR(-20.5)).toBe("-₹20.50");
    expect(formatSignedINR(0)).toBe("₹0");
    expect(monthlyReportId("2026-10")).toBe("monthly_2026-10");
    expect(hasEntries(data, OCT)).toBe(true);
    expect(hasEntries(data, { from: "2026-12-01", to: "2026-12-31" })).toBe(false);
  });
});
