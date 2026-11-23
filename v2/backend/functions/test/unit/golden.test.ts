import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ASHA, FIXTURE_TODAY, fixtureHomeData, generateFixtureTransactions, VIKRAM } from "../../eval/fixture";
import { FixtureBackend } from "../../eval/fixture-backend";
import { buildGoldens } from "../../eval/golden";
import { extractNumbers, flattenBlocks, scoreAnswer, sentenceCount } from "../../eval/scoring";
import { findAnomalies } from "../../src/core/anomalies";
import { budgetStatus } from "../../src/core/budget";
import { comparePeriods } from "../../src/core/compare";
import { buildProposal } from "../../src/core/proposals";
import { queryTransactions } from "../../src/core/query";
import { detectRecurringBills } from "../../src/core/recurring";

const data = fixtureHomeData();
const goldens = buildGoldens();
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const SEP = { from: "2026-09-01", to: "2026-09-30" };
const q = queryTransactions;
const bills = detectRecurringBills(data, FIXTURE_TODAY);
const bill = (label: string) => bills.find((b) => b.label === label)!;
const recurringKeys = new Set(detectRecurringBills(data, FIXTURE_TODAY, { maxResults: 200 }).map((b) => b.key));

/**
 * The same questions answered with the PRODUCTION tool functions — what the
 * agent's tools would hand the model. Must equal the naive expectations in
 * eval/golden.ts number for number.
 */
const TOOL_ANSWERS: Record<string, () => number[]> = {
  spend_oct: () => [q(data, OCT).summary.expenseTotal],
  income_oct: () => [q(data, { ...OCT, type: "income" }).summary.incomeTotal],
  net_oct: () => [q(data, { ...OCT, type: "all" }).summary.net],
  grocery_sep: () => [q(data, { ...SEP, categoryIds: ["grocery"] }).summary.expenseTotal],
  swiggy_oct: () => {
    const s = q(data, { ...OCT, text: "swiggy" }).summary;
    return [s.expenseCount, s.expenseTotal];
  },
  biggest_oct: () => [q(data, OCT).summary.largest!.amount],
  top_category_oct: () => [q(data, OCT, { groupBy: "category" }).groups[0].total],
  avg_grocery_monthly: () => [
    q(data, { from: "2026-03-01", to: "2026-10-31", categoryIds: ["grocery"] }, { groupBy: "month" }).averagePerGroup!,
  ],
  food_oct_vs_sep: () => {
    const c = comparePeriods(data, SEP, OCT, { categoryIds: ["food"] });
    return [c.periodA.total, c.periodB.total, c.delta];
  },
  spend_ytd: () => [q(data, { from: "2026-01-01", to: FIXTURE_TODAY }).summary.expenseTotal],
  asha_oct: () => [q(data, { ...OCT, userIds: [ASHA] }).summary.expenseTotal],
  vikram_oct: () => [q(data, { ...OCT, userIds: [VIKRAM] }).summary.expenseTotal],
  goa_trip: () => {
    const s = q(data, { tagIds: ["tag_goa"] }).summary;
    return [s.expenseTotal, s.expenseCount];
  },
  over_5000_oct: () => [q(data, { ...OCT, minAmount: 5000 }).summary.expenseCount],
  saturday_oct: () => [q(data, OCT, { groupBy: "weekday" }).groups.find((g) => g.label === "Saturday")!.total],
  highest_month: () => [
    Math.max(...q(data, { from: "2026-03-01", to: "2026-10-31" }, { groupBy: "month" }).groups.map((g) => g.total)),
  ],
  food_budget_now: () => {
    const l = budgetStatus(data, FIXTURE_TODAY).lines.find((x) => x.categoryId === "food")!;
    return [l.spent, l.remaining];
  },
  grocery_forecast: () => [budgetStatus(data, FIXTURE_TODAY).lines.find((x) => x.categoryId === "grocery")!.forecast],
  budgets_oct: () => {
    const t = budgetStatus(data, FIXTURE_TODAY, "2026-10").totals;
    return [t.budget, t.spent];
  },
  netflix_price: () => [bill("Netflix").priceChange!.previousAmount, bill("Netflix").priceChange!.currentAmount],
  airtel_spotify: () => [bill("Airtel Broadband").lastAmount, bill("Spotify").lastAmount],
  missed_bill: () => {
    const missed = bills.filter((b) => b.status === "missed");
    expect(missed.map((b) => b.label)).toEqual(["Airtel Broadband"]);
    return [missed[0].averageAmount];
  },
  anomaly_oct: () => {
    const a = findAnomalies(data, { range: OCT, excludeRecurringKeys: recurringKeys }).anomalies;
    expect(a.map((x) => x.transaction.note)).toEqual(["Anniversary dinner at Taj"]);
    return [a[0].transaction.amount];
  },
  duplicate: () => {
    const d = findAnomalies(data, { range: OCT }).duplicates;
    expect(d).toHaveLength(1);
    expect(d[0].transactions).toHaveLength(2);
    return [d[0].amount];
  },
  rent_total: () => {
    const s = q(data, { from: "2026-03-01", text: "house rent" }).summary;
    return [s.expenseCount, s.expenseTotal];
  },
  vikram_income: () => [
    q(data, { from: "2026-03-01", to: "2026-10-31", type: "income", userIds: [VIKRAM] }).summary.incomeTotal,
  ],
  transport_3_months: () =>
    q(data, { from: "2026-08-01", to: "2026-10-31", categoryIds: ["transportation"] }, { groupBy: "month" }).groups.map((g) => g.total),
  q2_vs_q3: () => {
    const c = comparePeriods(data, { from: "2026-04-01", to: "2026-06-30" }, { from: "2026-07-01", to: "2026-09-30" });
    return [c.periodA.total, c.periodB.total, c.delta];
  },
  per_day_oct: () => [q(data, OCT).summary.expensePerDay!],
  uber_sep: () => [q(data, { ...SEP, text: "uber" }).summary.expenseTotal],
  pets_oct: () => [q(data, { ...OCT, categoryIds: ["pets"] }).summary.expenseTotal],
  largest_income: () => [q(data, { type: "income" }).summary.largest!.amount],
  insurance_oct: () => {
    expect(q(data, { ...OCT, categoryIds: ["insurance"] }).summary.count).toBe(0);
    return [];
  },
  propose_budget: () => {
    const p = buildProposal(data, ASHA, { action: "set_budget", categoryId: "food", amount: 14000 });
    expect(p.ok).toBe(true);
    return p.ok && p.proposal.params.action === "set_budget" ? [p.proposal.params.amount] : [];
  },
  propose_tag: () => {
    // The model may pass every household Uber ride; only the caller's own may end up in the proposal.
    const vikrams = q(data, { ...OCT, userIds: [VIKRAM] }, { rowLimit: 3 }).rows.map((r) => r.id);
    const everyone = [...q(data, { ...OCT, text: "uber" }, { rowLimit: 50 }).rows.map((r) => r.id), ...vikrams];
    const p = buildProposal(data, ASHA, { action: "tag_transactions", transactionIds: everyone, tagId: "tag_work" });
    expect(p.ok && p.proposal.skipped).toEqual(vikrams.map((id) => ({ id, reason: "not_owner" })));
    const expected = goldens.find((g) => g.id === "propose_tag")!.proposal!.params.transactionIds as string[];
    expect(p.ok && p.proposal.params.action === "tag_transactions" && [...p.proposal.params.transactionIds].sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(everyone.length);
    return [];
  },
};
// Voice and Malayalam questions (D-028) expect the same figures as their typed English twins.
const TWINS: Record<string, string> = {
  voice_spend_oct: "spend_oct",
  voice_food_oct_vs_sep: "food_oct_vs_sep",
  voice_propose_budget: "propose_budget",
  ml_spend_oct: "spend_oct",
  ml_grocery_sep: "grocery_sep",
  ml_swiggy_oct: "swiggy_oct",
  ml_food_budget_now: "food_budget_now",
  ml_propose_budget: "propose_budget",
};
for (const [id, twin] of Object.entries(TWINS)) TOOL_ANSWERS[id] = TOOL_ANSWERS[twin];

describe("fixture household", () => {
  it("is deterministic", () => {
    const hash = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    expect(hash(generateFixtureTransactions())).toBe(hash(generateFixtureTransactions()));
    expect(generateFixtureTransactions()).toHaveLength(342);
  });
  it("covers ~8 months for two members with budgets, tags and a custom category", () => {
    const days = data.transactions.map((t) => t.day).sort();
    expect(days[0].slice(0, 7)).toBe("2026-03");
    expect(days[days.length - 1] <= FIXTURE_TODAY).toBe(true);
    expect(new Set(data.transactions.map((t) => t.day.slice(0, 7))).size).toBe(9);
    expect(new Set(data.transactions.map((t) => t.userId))).toEqual(new Set([ASHA, VIKRAM]));
    expect(data.budgets).toHaveLength(5);
    expect(data.categories.some((c) => c.id === "pets")).toBe(true);
    expect(new Set(data.transactions.map((t) => t.id)).size).toBe(data.transactions.length);
  });
  it("contains exactly one duplicate group overall (the planted one)", () => {
    const d = findAnomalies(data, { limit: 50 }).duplicates;
    expect(d.map((x) => [x.date, x.note, x.amount])).toEqual([["2026-10-22", "Uber to airport", 742]]);
  });
});

describe("golden questions", () => {
  it("has about 30 questions with unique ids", () => {
    expect(goldens.length).toBeGreaterThanOrEqual(30);
    expect(new Set(goldens.map((g) => g.id)).size).toBe(goldens.length);
  });

  it("every question has a tool-based answer to check against", () => {
    expect(Object.keys(TOOL_ANSWERS).sort()).toEqual(goldens.map((g) => g.id).sort());
  });

  for (const g of goldens) {
    it(`${g.id}: production tools reproduce the expected numbers`, () => {
      expect(TOOL_ANSWERS[g.id]()).toEqual(g.numbers.map((n) => n.value));
      for (const n of g.numbers) expect(Number.isFinite(n.value)).toBe(true);
    });
  }

  it("expected text is consistent with the tools", () => {
    expect(q(data, OCT, { groupBy: "category" }).groups[0].label).toBe(goldens.find((g) => g.id === "top_category_oct")!.text![0]);
    const months = q(data, { from: "2026-03-01", to: "2026-10-31" }, { groupBy: "month" }).groups;
    const top = [...months].sort((a, b) => b.total - a.total)[0];
    expect(top.label.startsWith(goldens.find((g) => g.id === "highest_month")!.text![0])).toBe(true);
    expect(q(data, OCT).summary.largest!.note.toLowerCase()).toContain("rent");
  });
});

describe("eval scoring", () => {
  const golden = goldens.find((g) => g.id === "swiggy_oct")!;
  it("extracts numbers written with Indian grouping", () => {
    expect(extractNumbers("₹1,71,518.44 across 12 orders (-₹500)")).toEqual([171518.44, 12, 500]);
  });
  it("passes a correct answer in any block type", () => {
    const s = scoreAnswer(golden, [
      { type: "stat", label: "Swiggy in October", value: "₹5,107", caption: "12 orders" },
      { type: "text", text: "That is more than usual." },
    ], []);
    expect(s).toMatchObject({ pass: true, numbersExpected: 2, numbersExact: 2 });
  });
  it("fails a wrong or rounded number and names what is missing", () => {
    const s = scoreAnswer(golden, [{ type: "text", text: "You placed 12 Swiggy orders for about ₹5,100." }], []);
    expect(s.pass).toBe(false);
    expect(s.numbersExact).toBe(1);
    expect(s.missing).toEqual(["Swiggy total = 5107"]);
    const perDay = goldens.find((g) => g.id === "per_day_oct")!;
    const rounded = scoreAnswer(perDay, [{ type: "text", text: "About ₹2,715 a day." }], []);
    expect(rounded).toMatchObject({ pass: false, numbersExact: 0, numbersRounded: 1 });
  });
  it("checks required text, no-data honesty and proposals", () => {
    const top = goldens.find((g) => g.id === "top_category_oct")!;
    expect(scoreAnswer(top, [{ type: "text", text: "₹26,460 went on eating out." }], []).pass).toBe(false);
    expect(scoreAnswer(top, [{ type: "text", text: "Food, at ₹26,460." }], []).pass).toBe(true);

    const none = goldens.find((g) => g.id === "insurance_oct")!;
    expect(scoreAnswer(none, [{ type: "text", text: "There were no insurance expenses in October 2026." }], []).pass).toBe(true);
    expect(scoreAnswer(none, [{ type: "text", text: "You spent ₹4,200 on insurance." }], []).pass).toBe(false);

    const budget = goldens.find((g) => g.id === "propose_budget")!;
    const block = { type: "proposal" as const, proposalId: "p", action: "set_budget" as const, summary: "Change the monthly Food budget from ₹12,000 to ₹14,000" };
    const stored = { action: "set_budget" as const, params: { action: "set_budget" as const, categoryId: "food", amount: 14000 }, summary: block.summary, skipped: [] };
    expect(scoreAnswer(budget, [block], [stored]).pass).toBe(true);
    expect(scoreAnswer(budget, [{ type: "text", text: "Done! Budget is now ₹14,000." }], []).pass).toBe(false);
    expect(flattenBlocks([block])).toContain("14,000");
  });
});

describe("eval scoring: voice and Malayalam (D-028)", () => {
  const voice = goldens.find((g) => g.id === "voice_spend_oct")!;
  const ml = goldens.find((g) => g.id === "ml_spend_oct")!;
  const oct = voice.numbers[0].value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  it("counts sentences without splitting figures", () => {
    expect(sentenceCount("You spent ₹1,71,518.44 last month. Mostly food.")).toBe(2);
    expect(sentenceCount("One. Two! Three?")).toBe(3);
  });
  it("needs a short spoken text block first that carries a figure", () => {
    expect(scoreAnswer(voice, [{ type: "text", text: `You spent ₹${oct} in October.` }, { type: "stat", label: "Spent", value: `₹${oct}` }], []).pass).toBe(true);
    expect(scoreAnswer(voice, [{ type: "stat", label: "Spent", value: `₹${oct}` }, { type: "text", text: "That was October." }], []).missing)
      .toEqual(["first block is not a spoken text answer"]);
    expect(scoreAnswer(voice, [{ type: "text", text: "October is done. It was busy. Here it is." }, { type: "stat", label: "Spent", value: `₹${oct}` }], []).missing)
      .toEqual(["spoken answer longer than 2 sentences", "spoken answer carries none of the expected figures"]);
  });
  it("needs Malayalam script for Malayalam questions", () => {
    expect(scoreAnswer(ml, [{ type: "text", text: `കഴിഞ്ഞ മാസം ₹${oct} ചെലവായി.` }], []).pass).toBe(true);
    expect(scoreAnswer(ml, [{ type: "text", text: `You spent ₹${oct} last month.` }], []).missing).toEqual(["answer is not in Malayalam"]);
  });
  it("every voice/Malayalam question is asked in voice mode", () => {
    for (const id of Object.keys(TWINS)) expect(goldens.find((g) => g.id === id)!.reply).toBe("voice");
  });
});

describe("fixture backend", () => {
  it("ranks notes by word overlap and stores proposals in memory only", async () => {
    const backend = new FixtureBackend();
    const hits = await backend.searchNotes("anniversary dinner", 5);
    const top = data.transactions.find((t) => t.id === hits[0].transactionId)!;
    expect(top.note).toBe("Anniversary dinner at Taj");
    expect(await backend.searchNotes("zzzz", 5)).toEqual([]);
    const id = await backend.createProposal({ action: "set_budget", params: { action: "set_budget", categoryId: "food", amount: 1 }, summary: "s", skipped: [] });
    expect(backend.proposals.map((p) => p.id)).toEqual([id]);
  });
});
