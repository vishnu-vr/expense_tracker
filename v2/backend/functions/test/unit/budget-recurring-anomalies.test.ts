import { describe, expect, it } from "vitest";
import { findAnomalies } from "../../src/core/anomalies";
import { budgetDraftAlert, budgetPacingRatio, budgetStatus, dailyBurnRate, monthEndForecast, pacingStatus } from "../../src/core/budget";
import { detectCadence, detectRecurringBills, recurringMonthlyTotal } from "../../src/core/recurring";
import { home, tx } from "./helpers";

describe("insights-math ports", () => {
  it("matches the v1 formulas", () => {
    expect(dailyBurnRate(3000, 10)).toBe(300);
    expect(dailyBurnRate(3000, 0)).toBe(0);
    expect(dailyBurnRate(-1, 10)).toBe(0);
    expect(monthEndForecast(300, 30)).toBe(9000);
    expect(budgetPacingRatio(5000, 10000, 15, 30)).toBe(1);
    expect(budgetPacingRatio(5000, 0, 15, 30)).toBeNull();
    expect(pacingStatus(null)).toBe("on_track");
    expect(pacingStatus(1.0)).toBe("on_track");
    expect(pacingStatus(1.05)).toBe("ahead");
    expect(pacingStatus(1.11)).toBe("warning");
  });
  it("matches the v1 draft alert", () => {
    expect(budgetDraftAlert(1000, 800, 50)).toBeNull();
    expect(budgetDraftAlert(1000, 800, 100)?.level).toBe("approach");
    expect(budgetDraftAlert(1000, 800, 201)).toMatchObject({ level: "over", projected: 1001 });
    expect(budgetDraftAlert(0, 800, 100)).toBeNull();
  });
});

describe("budgetStatus", () => {
  const data = home(
    [
      tx("2026-11-02", 3000, "food"),
      tx("2026-11-08", 3000, "food"),
      tx("2026-11-03", 500, "grocery"),
      tx("2026-11-04", 4000, "shopping"),
      tx("2026-11-09", 2500, "shopping"),
      tx("2026-11-05", 700, "health"),
      tx("2026-11-20", 9999, "food"), // after "today": must be ignored
      tx("2026-10-10", 11000, "food"),
      tx("2026-10-20", 2000, "food"),
    ],
    [
      { categoryId: "food", amount: 12000 },
      { categoryId: "grocery", amount: 15000 },
      { categoryId: "shopping", amount: 6000 },
    ],
  );

  it("computes spent, pacing, forecast and the projected crossing day", () => {
    const r = budgetStatus(data, "2026-11-10");
    expect(r).toMatchObject({ month: "2026-11", daysElapsed: 10, daysInMonth: 30, isCurrentMonth: true, hasBudgets: true });
    const food = r.lines.find((l) => l.categoryId === "food")!;
    // 6000 in 10 days -> 600/day -> 18000 by month end; 600 × 21 = 12600 > 12000, so it crosses on the 21st.
    expect(food).toMatchObject({
      spent: 6000, remaining: 6000, usedPct: 50, dailyBurn: 600, forecast: 18000, forecastOverBudget: true,
      pacingRatio: 1.5, pacing: "warning", status: "will_cross", crossingDay: 21, crossingDate: "2026-11-21",
      forecastDisplay: "₹18,000",
    });
    const grocery = r.lines.find((l) => l.categoryId === "grocery")!;
    expect(grocery).toMatchObject({ spent: 500, forecast: 1500, status: "within", crossingDay: null, pacingRatio: 0.1, pacing: "on_track" });
  });

  it("reports the actual day a budget was crossed", () => {
    const shopping = budgetStatus(data, "2026-11-10").lines.find((l) => l.categoryId === "shopping")!;
    expect(shopping).toMatchObject({ spent: 6500, remaining: -500, status: "over", crossingDay: 9, remainingDisplay: "-₹500" });
  });

  it("totals budgets and lists unbudgeted spend", () => {
    const r = budgetStatus(data, "2026-11-10");
    expect(r.totals).toMatchObject({ budget: 33000, spent: 13000, remaining: 20000, usedPct: 39.4, forecast: 39000 });
    expect(r.unbudgeted).toEqual([{ categoryId: "health", categoryName: "Health", spent: 700, spentDisplay: "₹700" }]);
  });

  it("treats a past month as fully elapsed", () => {
    const r = budgetStatus(data, "2026-11-10", "2026-10");
    const food = r.lines.find((l) => l.categoryId === "food")!;
    expect(r.daysElapsed).toBe(31);
    expect(food).toMatchObject({ spent: 13000, forecast: 13000, status: "over", crossingDay: 20 });
  });

  it("says so when there are no budgets", () => {
    const r = budgetStatus(home([tx("2026-11-02", 100, "food")]), "2026-11-10");
    expect(r.hasBudgets).toBe(false);
    expect(r.lines).toEqual([]);
    expect(r.totals.budget).toBe(0);
  });
});

describe("recurring bills", () => {
  it("uses the v1 cadence thresholds", () => {
    expect(detectCadence(7, 1)).toBe("weekly");
    expect(detectCadence(14, 2)).toBe("every 2 weeks");
    expect(detectCadence(30.4, 0.5)).toBe("monthly");
    expect(detectCadence(91, 3)).toBe("quarterly");
    expect(detectCadence(30, 8)).toBeNull();
    expect(detectCadence(20, 1)).toBeNull();
  });

  const monthly = (note: string, cat: string, amounts: number[], startMonth = 5, day = 5) =>
    amounts.map((a, i) => tx(`2026-${String(startMonth + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`, a, cat, note));

  it("detects a steady monthly bill and its next expected date", () => {
    const [b] = detectRecurringBills(home(monthly("House rent", "home", [25000, 25000, 25000, 25000])), "2026-08-20");
    expect(b).toMatchObject({
      label: "House Rent", cadence: "monthly", occurrences: 4, averageAmount: 25000, lastPaidDate: "2026-08-05",
      nextExpectedDate: "2026-09-05", status: "active", daysOverdue: 0, priceChange: null, intervalDays: 31,
    });
  });

  it("needs three occurrences and a regular rhythm", () => {
    expect(detectRecurringBills(home(monthly("Rent", "home", [100, 100])), "2026-08-20")).toEqual([]);
    const irregular = home([tx("2026-05-01", 100, "food", "x"), tx("2026-05-03", 100, "food", "x"), tx("2026-07-20", 100, "food", "x"), tx("2026-07-21", 100, "food", "x")]);
    expect(detectRecurringBills(irregular, "2026-08-20")).toEqual([]);
  });

  it("rejects groups whose amount varies too much (v1 limits: 35% with a note, 20% without)", () => {
    expect(detectRecurringBills(home(monthly("Groceries", "grocery", [1000, 3000, 500, 2500])), "2026-08-20")).toEqual([]);
    expect(detectRecurringBills(home(monthly("Electricity", "bills", [2000, 2300, 1900, 2200])), "2026-08-20")).toHaveLength(1);
  });

  it("flags a price change, a missed payment, a stopped series and a new one", () => {
    const priced = detectRecurringBills(home(monthly("Netflix", "entertainment", [649, 649, 649, 799])), "2026-08-20")[0];
    expect(priced.priceChange).toMatchObject({ previousAmount: 649, currentAmount: 799, delta: 150, deltaPct: 23.1, direction: "up", deltaPctDisplay: "+23.1%" });

    const series = home(monthly("Broadband", "bills", [1179, 1179, 1179, 1179], 5, 1)); // last paid 1 Aug, next 1 Sep
    expect(detectRecurringBills(series, "2026-09-05")[0]).toMatchObject({ status: "active", daysOverdue: 4 });
    expect(detectRecurringBills(series, "2026-09-12")[0]).toMatchObject({ status: "missed", daysOverdue: 11, nextExpectedDate: "2026-09-01" });
    expect(detectRecurringBills(series, "2026-11-10")[0]).toMatchObject({ status: "stopped" });
    expect(detectRecurringBills(series, "2026-11-10", { includeStopped: false })).toEqual([]);

    expect(detectRecurringBills(home(monthly("Spotify", "entertainment", [119, 119, 119])), "2026-08-01")[0].isNew).toBe(true);
    expect(detectRecurringBills(home(monthly("Spotify", "entertainment", [119, 119, 119, 119, 119, 119])), "2026-10-20")[0].isNew).toBe(false);
  });

  it("only counts what has happened by today, and can be limited to one member", () => {
    const data = home([...monthly("Rent", "home", [100, 100, 100, 100]), ...monthly("Maid", "home", [50, 50, 50]).map((t) => ({ ...t, userId: "u2" }))]);
    expect(detectRecurringBills(data, "2026-06-30")).toEqual([]); // only two payments so far
    expect(detectRecurringBills(data, "2026-08-20", { userId: "u2" }).map((b) => b.label)).toEqual(["Maid"]);
    expect(recurringMonthlyTotal(detectRecurringBills(data, "2026-08-20"))).toBe(150);
  });
});

describe("findAnomalies", () => {
  const usual = [300, 320, 280, 350, 310, 290, 330].map((a, i) => tx(`2026-09-${String(i + 1).padStart(2, "0")}`, a, "food", "lunch"));
  it("flags an entry far outside its category norm", () => {
    const data = home([...usual, tx("2026-10-18", 18500, "food", "Anniversary dinner", { id: "big" })]);
    const r = findAnomalies(data);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]).toMatchObject({ basis: "category", basisLabel: "Food", typicalAmount: 310, timesTypical: 59.7, sampleSize: 7 });
    expect(r.anomalies[0].transaction.id).toBe("big");
  });
  it("prefers the merchant norm when the note matches a merchant", () => {
    const swiggy = [200, 220, 240, 210, 230].map((a, i) => tx(`2026-09-${String(i + 10)}`, a, "food", "Swiggy"));
    const data = home([...usual, ...swiggy, tx("2026-10-02", 1400, "food", "Swiggy party order", { id: "s" })]);
    const [a] = findAnomalies(data).anomalies;
    expect(a).toMatchObject({ basis: "merchant", basisLabel: "Swiggy", typicalAmount: 220 });
    expect(a.transaction.id).toBe("s");
  });
  it("does not flag ordinary variation, small samples, or recurring series", () => {
    expect(findAnomalies(home([...usual, tx("2026-10-01", 700, "food", "dinner")])).anomalies).toEqual([]);
    expect(findAnomalies(home([tx("2026-10-01", 100, "food"), tx("2026-10-02", 90000, "food")])).anomalies).toEqual([]);
    const data = home([...usual, tx("2026-10-18", 18500, "food", "Catering contract", { id: "big" })]);
    expect(findAnomalies(data, { excludeRecurringKeys: new Set(["food::catering contract"]) }).anomalies).toEqual([]);
  });
  it("limits reporting to a range while still using all history as the norm", () => {
    const data = home([...usual, tx("2026-10-18", 18500, "food", "Anniversary dinner")]);
    expect(findAnomalies(data, { range: { from: "2026-10-01", to: "2026-10-31" } }).anomalies).toHaveLength(1);
    expect(findAnomalies(data, { range: { from: "2026-11-01" } }).anomalies).toEqual([]);
  });
  it("finds likely duplicates: same day, amount, category and note", () => {
    const data = home([
      tx("2026-10-22", 742, "transportation", "Uber to airport", { id: "d1" }),
      tx("2026-10-22", 742, "transportation", "uber to  AIRPORT", { id: "d2", userId: "u2" }),
      tx("2026-10-22", 742, "transportation", "Uber home", { id: "x1" }),
      tx("2026-10-23", 742, "transportation", "Uber to airport", { id: "x2" }),
      tx("2026-10-22", 743, "transportation", "Uber to airport", { id: "x3" }),
    ]);
    const r = findAnomalies(data);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toMatchObject({ date: "2026-10-22", amount: 742, categoryName: "Transportation" });
    expect(r.duplicates[0].transactions.map((t) => t.id)).toEqual(["d1", "d2"]);
  });
});
