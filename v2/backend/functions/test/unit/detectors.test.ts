import { describe, expect, it } from "vitest";
import { fixtureHomeData, FIXTURE_TODAY } from "../../eval/fixture";
import {
  detectBudgetForecast, detectBudgetSuggestions, detectCategoryDrift, detectMerchantHabits, detectMonthReview,
  detectSubscriptionChanges, detectUnusualAndDuplicates, insightId, runDetectors,
} from "../../src/core/insights/detectors";
import { isSafePhrasing, numbersIn, phraseCards } from "../../src/core/insights/phrasing";
import { home, tx } from "./helpers";

const fixture = fixtureHomeData();
const byKind = <T extends { kind: string }>(cards: T[], kind: string): T[] => cards.filter((c) => c.kind === kind);

describe("insight ids", () => {
  it("are stable and Firestore-safe", () => {
    expect(insightId("bill_missing", "2026-11", "bills::airtel broadband")).toBe("bill_missing_2026-11_bills-airtel-broadband");
    expect(insightId("month_review", "2026-10")).toBe("month_review_2026-10");
    expect(insightId("merchant_habit", "2026-10", "a/b")).not.toContain("/");
  });
});

describe("detectors on the fixture household (today = 2026-11-10)", () => {
  const cards = runDetectors(fixture, FIXTURE_TODAY);

  it("is deterministic and idempotent: same input, same cards, unique ids", () => {
    expect(runDetectors(fixture, FIXTURE_TODAY)).toEqual(cards);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    for (const c of cards) {
      expect(c.id.startsWith(`${c.kind}_`)).toBe(true);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.body.length).toBeGreaterThan(0);
      expect(c.periodKey).toMatch(/^\d{4}-(\d{2}|Q[1-4])$/);
    }
  });

  it("month in review carries the exact totals", () => {
    const [c] = detectMonthReview(fixture, FIXTURE_TODAY);
    expect(c.id).toBe("month_review_2026-10");
    expect(c.data).toMatchObject({ month: "2026-10", expenseTotal: 84151.25, incomeTotal: 147000, net: 62848.75, previousExpenseTotal: 56505.25 });
    expect(c.body).toContain("₹84,151.25");
    expect(c.body).toContain("₹62,848.75");
  });

  it("subscription price change / new / stopped and missing bill", () => {
    const subs = detectSubscriptionChanges(fixture, FIXTURE_TODAY);
    const netflix = byKind(subs, "subscription_price_change").find((c) => c.title.startsWith("Netflix"))!;
    expect(netflix.data).toMatchObject({ previousAmount: 649, currentAmount: 799, deltaPct: 23.1 });
    expect(netflix.body).toBe("Netflix (monthly) was ₹799 on 5 Nov 2026, up from the usual ₹649.");
    expect(byKind(subs, "subscription_new").map((c) => c.data.label)).toEqual(["Spotify"]);
    expect(byKind(subs, "subscription_stopped").map((c) => c.data.label)).toEqual(["Gym Membership"]);
    const missing = byKind(subs, "bill_missing");
    expect(missing.map((c) => c.data.label)).toEqual(["Airtel Broadband"]);
    expect(missing[0].data).toMatchObject({ expectedDate: "2026-11-01", daysOverdue: 9, averageAmount: 1179 });
  });

  it("likely duplicate", () => {
    const dup = byKind(detectUnusualAndDuplicates(fixture, FIXTURE_TODAY), "likely_duplicate");
    expect(dup).toHaveLength(1);
    expect(dup[0].data).toMatchObject({ amount: 742, date: "2026-10-22" });
    expect((dup[0].data.transactionIds as string[]).length).toBe(2);
  });

  it("unusual transaction (seen a week after it happened)", () => {
    const unusual = byKind(detectUnusualAndDuplicates(fixture, "2026-10-25"), "unusual_transaction");
    expect(unusual).toHaveLength(1);
    expect(unusual[0].data).toMatchObject({ amount: 18500, basisLabel: "Food" });
    expect(unusual[0].body).toContain("Anniversary dinner at Taj");
    // …and no longer reported once it is more than two weeks old.
    expect(byKind(detectUnusualAndDuplicates(fixture, FIXTURE_TODAY), "unusual_transaction")).toEqual([]);
  });

  it("budget forecast crossing", () => {
    const f = detectBudgetForecast(fixture, FIXTURE_TODAY);
    expect(f.map((c) => c.id)).toEqual([
      "budget_forecast_2026-11_entertainment",
      "budget_forecast_2026-11_transportation",
      "budget_forecast_2026-11_shopping",
    ]);
    expect(f[1].data).toMatchObject({ state: "will_cross", budget: 6000, spent: 2358.25, crossingDay: 26, forecast: 7074.75 });
    expect(f[1].title).toBe("Transportation will cross budget around the 26th");
  });

  it("merchant habit change, category drift and budget suggestions", () => {
    const swiggy = detectMerchantHabits(fixture, FIXTURE_TODAY).find((c) => c.data.merchant === "Swiggy")!;
    expect(swiggy.data).toMatchObject({ count: 12, total: 5107, deltaPct: 107 });
    const drift = detectCategoryDrift(fixture, FIXTURE_TODAY).find((c) => c.data.categoryId === "education")!;
    expect(drift.data).toMatchObject({ risingMonths: 4, totals: [2000, 2400, 2900, 3500], deltaPct: 75 });
    const suggestions = detectBudgetSuggestions(fixture, FIXTURE_TODAY);
    expect(suggestions[0]).toMatchObject({ id: "budget_suggestion_2026-Q4_home" });
    expect(suggestions[0].data).toMatchObject({ typicalMonthly: 25000, suggestedBudget: 25000 });
    // never suggests a budget for a category that already has one
    expect(suggestions.some((c) => ["food", "grocery", "shopping"].includes(c.data.categoryId as string))).toBe(false);
  });
});

describe("detectors on small inputs", () => {
  it("produce nothing for an empty household", () => {
    expect(runDetectors(home([]), "2026-11-10")).toEqual([]);
  });
  it("budget forecast reports an already-crossed budget with the real day, and waits 5 days before forecasting", () => {
    const over = home([tx("2026-11-02", 900, "food"), tx("2026-11-04", 300, "food")], [{ categoryId: "food", amount: 1000 }]);
    const [c] = detectBudgetForecast(over, "2026-11-06");
    expect(c.data).toMatchObject({ state: "over", crossingDay: 4 });
    expect(c.body).toBe("Food crossed its ₹1,000 budget on the 4th: ₹1,200 spent so far, ₹200 over.");
    const early = home([tx("2026-11-01", 400, "food")], [{ categoryId: "food", amount: 1000 }]);
    expect(detectBudgetForecast(early, "2026-11-02")).toEqual([]);
    expect(detectBudgetForecast(early, "2026-11-05")).toHaveLength(1);
  });
  it("budget suggestion rounds the typical month up to the next ₹100", () => {
    const data = home([tx("2026-08-10", 1820, "health"), tx("2026-09-10", 2240, "health"), tx("2026-10-10", 2010, "health")]);
    expect(detectBudgetSuggestions(data, "2026-11-10")[0].data).toMatchObject({ typicalMonthly: 2010, suggestedBudget: 2100 });
  });
});

describe("phrasing guard", () => {
  const card = detectMonthReview(fixture, FIXTURE_TODAY)[0];
  it("extracts numbers regardless of grouping", () => {
    expect(numbersIn("₹1,71,518.44 on 5 Nov, up 23.1%")).toEqual(["171518.44", "5", "23.1"]);
  });
  it("uses the template when there is no model, the model fails, or it changes a number", async () => {
    expect(await phraseCards([card], null)).toEqual([card]);
    expect(await phraseCards([card], async () => { throw new Error("no model"); })).toEqual([card]);
    expect(await phraseCards([card], async () => null)).toEqual([card]);
    const invented = await phraseCards([card], async () => ({ title: "October recap", body: "You spent ₹90,000 in October 2026." }));
    expect(invented).toEqual([card]);
    expect(isSafePhrasing(card, { title: "x".repeat(200), body: "ok" })).toBe(false);
  });
  it("accepts a rewrite that keeps to the template's numbers", async () => {
    const [out] = await phraseCards([card], async () => ({ title: "Your October 2026", body: "Spending came to ₹84,151.25 in October 2026." }));
    expect(out.title).toBe("Your October 2026");
    expect(out.body).toBe("Spending came to ₹84,151.25 in October 2026.");
    expect(out.id).toBe(card.id);
    expect(out.data).toEqual(card.data);
  });
});
