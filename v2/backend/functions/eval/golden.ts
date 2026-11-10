/**
 * Golden questions for the agent evaluation.
 *
 * Every expected number is computed HERE from the raw fixture with deliberately
 * naive code (plain filters and sums, its own date handling) — not with the
 * production tool functions. `test/unit/golden.test.ts` then checks that the
 * production tools return exactly these numbers, so the expectations and the
 * tools verify each other.
 */
import { Tx } from "../src/core/types";
import { ASHA, FIXTURE_BUDGETS, generateFixtureTransactions, VIKRAM } from "./fixture";

export interface ExpectedNumber {
  label: string;
  value: number;
}

export interface Golden {
  id: string;
  question: string;
  /** Who is asking (default Asha). */
  uid?: string;
  /** Numbers that must appear in the answer. */
  numbers: ExpectedNumber[];
  /** Case-insensitive substrings that must appear in the answer. */
  text?: string[];
  /** The honest answer is "there is no data". */
  noData?: boolean;
  /** The answer must carry a pending proposal like this (and change nothing). */
  proposal?: { action: "set_budget" | "tag_transactions" | "recategorise"; params: Record<string, unknown> };
}

// ---- naive reference helpers -------------------------------------------------

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Local (IST, UTC+5:30) calendar day of a transaction. */
const dayOf = (t: Tx) => new Date(t.date.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const monthOf = (t: Tx) => dayOf(t).slice(0, 7);
const weekday = (t: Tx) => new Date(`${dayOf(t)}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const note = (t: Tx) => (t.note ?? "").toLowerCase();
const total = (rows: Tx[]) => r2(rows.reduce((s, t) => s + t.amount, 0));

export function buildGoldens(all: Tx[] = generateFixtureTransactions()): Golden[] {
  const exp = all.filter((t) => t.type === "expense");
  const inc = all.filter((t) => t.type === "income");
  const inMonth = (rows: Tx[], m: string) => rows.filter((t) => monthOf(t) === m);
  const between = (rows: Tx[], from: string, to: string) => rows.filter((t) => dayOf(t) >= from && dayOf(t) <= to);
  const cat = (rows: Tx[], c: string) => rows.filter((t) => t.categoryId === c);

  const oct = inMonth(exp, "2026-10");
  const sep = inMonth(exp, "2026-09");
  const nov = inMonth(exp, "2026-11");

  const byCategory = (rows: Tx[]) => {
    const m = new Map<string, number>();
    rows.forEach((t) => m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount));
    return [...m.entries()].map(([id, v]) => ({ id, total: r2(v) })).sort((a, b) => b.total - a.total);
  };
  const CATEGORY_NAMES: Record<string, string> = {
    food: "Food", home: "Home", grocery: "Grocery", transportation: "Transportation", shopping: "Shopping",
  };
  const topOct = byCategory(oct)[0];

  const fullMonths = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const MONTH_NAMES: Record<string, string> = {
    "2026-03": "March", "2026-04": "April", "2026-05": "May", "2026-06": "June",
    "2026-07": "July", "2026-08": "August", "2026-09": "September", "2026-10": "October",
  };
  const monthTotals = fullMonths.map((m) => ({ m, total: total(inMonth(exp, m)) }));
  const highest = [...monthTotals].sort((a, b) => b.total - a.total)[0];

  const swiggyOct = oct.filter((t) => note(t).includes("swiggy"));
  const uberSep = sep.filter((t) => note(t).includes("uber"));
  const goa = exp.filter((t) => t.tagIds.includes("tag_goa"));
  const rent = exp.filter((t) => note(t) === "house rent");
  const foodNov = total(cat(nov, "food"));
  const groceryNov = total(cat(nov, "grocery"));
  const budgeted = new Set(FIXTURE_BUDGETS.map((b) => b.categoryId));
  const q2 = total(between(exp, "2026-04-01", "2026-06-30"));
  const q3 = total(between(exp, "2026-07-01", "2026-09-30"));
  const foodSep = total(cat(sep, "food"));
  const foodOct = total(cat(oct, "food"));
  const ashaUberOct = oct.filter((t) => t.userId === ASHA && note(t).includes("uber")).map((t) => t.id).sort();

  return [
    { id: "spend_oct", question: "How much did we spend last month?", numbers: [{ label: "October expenses", value: total(oct) }] },
    { id: "income_oct", question: "What was our total income in October 2026?", numbers: [{ label: "October income", value: total(inMonth(inc, "2026-10")) }] },
    {
      id: "net_oct",
      question: "How much did we save in October, i.e. income minus spending?",
      numbers: [{ label: "October net", value: r2(total(inMonth(inc, "2026-10")) - total(oct)) }],
    },
    { id: "grocery_sep", question: "How much did we spend on groceries in September?", numbers: [{ label: "September grocery", value: total(cat(sep, "grocery")) }] },
    {
      id: "swiggy_oct",
      question: "How many Swiggy orders did we place in October and what did they cost in total?",
      numbers: [
        { label: "Swiggy orders", value: swiggyOct.length },
        { label: "Swiggy total", value: total(swiggyOct) },
      ],
    },
    {
      id: "biggest_oct",
      question: "What was our single biggest expense in October?",
      numbers: [{ label: "Largest October expense", value: Math.max(...oct.map((t) => t.amount)) }],
      text: ["rent"],
    },
    {
      id: "top_category_oct",
      question: "Which category did we spend the most on in October, and how much?",
      numbers: [{ label: "Top category total", value: topOct.total }],
      text: [CATEGORY_NAMES[topOct.id] ?? topOct.id],
    },
    {
      id: "avg_grocery_monthly",
      question: "What is our average monthly grocery spend from March to October 2026?",
      numbers: [{ label: "Average monthly grocery", value: r2(total(cat(between(exp, "2026-03-01", "2026-10-31"), "grocery")) / 8) }],
    },
    {
      id: "food_oct_vs_sep",
      question: "How did food spending in October compare with September?",
      numbers: [
        { label: "September food", value: foodSep },
        { label: "October food", value: foodOct },
        { label: "Change", value: r2(foodOct - foodSep) },
      ],
    },
    { id: "spend_ytd", question: "How much have we spent in total this year so far?", numbers: [{ label: "2026 expenses to date", value: total(exp) }] },
    { id: "asha_oct", question: "How much did Asha spend in October?", numbers: [{ label: "Asha October", value: total(oct.filter((t) => t.userId === ASHA)) }] },
    { id: "vikram_oct", question: "How much did Vikram spend in October?", numbers: [{ label: "Vikram October", value: total(oct.filter((t) => t.userId === VIKRAM)) }] },
    {
      id: "goa_trip",
      question: "What did the Goa trip cost us in total, and how many expenses were there?",
      numbers: [
        { label: "Goa trip total", value: total(goa) },
        { label: "Goa trip entries", value: goa.length },
      ],
    },
    {
      id: "over_5000_oct",
      question: "How many expenses of ₹5,000 or more did we have in October?",
      numbers: [{ label: "Count", value: oct.filter((t) => t.amount >= 5000).length }],
    },
    {
      id: "saturday_oct",
      question: "How much did we spend on Saturdays in October?",
      numbers: [{ label: "Saturday total", value: total(oct.filter((t) => weekday(t) === 6)) }],
    },
    {
      id: "highest_month",
      question: "Between March and October 2026, which month had the highest spending and how much was it?",
      numbers: [{ label: "Highest month total", value: highest.total }],
      text: [MONTH_NAMES[highest.m]],
    },
    {
      id: "food_budget_now",
      question: "How is the food budget doing this month? How much is spent and how much is left?",
      numbers: [
        { label: "Food spent in November", value: foodNov },
        { label: "Food budget remaining", value: r2(12000 - foodNov) },
      ],
    },
    {
      id: "grocery_forecast",
      question: "At the current pace, what will our grocery spend be by the end of this month?",
      numbers: [{ label: "Grocery forecast", value: r2((groceryNov / 10) * 30) }],
    },
    {
      id: "budgets_oct",
      question: "Across all our budgets, what was the total budget and the total spent against it in October?",
      numbers: [
        { label: "Total budget", value: FIXTURE_BUDGETS.reduce((s, b) => s + b.amount, 0) },
        { label: "Total spent on budgeted categories", value: total(oct.filter((t) => budgeted.has(t.categoryId))) },
      ],
    },
    {
      id: "netflix_price",
      question: "Did the Netflix price change? What was it before and what is it now?",
      numbers: [
        { label: "Old price", value: 649 },
        { label: "New price", value: 799 },
      ],
    },
    {
      id: "airtel_spotify",
      question: "How much do we pay each time for Airtel broadband and for Spotify?",
      numbers: [
        { label: "Airtel", value: 1179 },
        { label: "Spotify", value: 119 },
      ],
    },
    {
      id: "missed_bill",
      question: "Is any of our regular bills overdue right now?",
      numbers: [{ label: "Usual amount", value: 1179 }],
      text: ["airtel"],
    },
    {
      id: "anomaly_oct",
      question: "Were there any unusually large expenses in October?",
      numbers: [{ label: "Unusual amount", value: 18500 }],
      text: ["taj"],
    },
    {
      id: "duplicate",
      question: "Do we have any entries that look like duplicates in October?",
      numbers: [{ label: "Duplicate amount", value: 742 }],
      text: ["uber"],
    },
    {
      id: "rent_total",
      question: "How many times have we paid house rent since March 2026 and how much in total?",
      numbers: [
        { label: "Rent payments", value: rent.length },
        { label: "Rent total", value: total(rent) },
      ],
    },
    {
      id: "vikram_income",
      question: "What was Vikram's total income from March to October 2026?",
      numbers: [{ label: "Vikram income", value: total(between(inc, "2026-03-01", "2026-10-31").filter((t) => t.userId === VIKRAM)) }],
    },
    {
      id: "transport_3_months",
      question: "Show transportation spending for August, September and October month by month.",
      numbers: ["2026-08", "2026-09", "2026-10"].map((m) => ({ label: `Transportation ${m}`, value: total(cat(inMonth(exp, m), "transportation")) })),
    },
    {
      id: "q2_vs_q3",
      question: "Compare our total spending in April–June 2026 with July–September 2026.",
      numbers: [
        { label: "Apr–Jun", value: q2 },
        { label: "Jul–Sep", value: q3 },
        { label: "Difference", value: r2(q3 - q2) },
      ],
    },
    {
      id: "per_day_oct",
      question: "On average, how much did we spend per day in October?",
      numbers: [{ label: "Per day", value: r2(total(oct) / 31) }],
    },
    {
      id: "uber_sep",
      question: "How much did we spend on Uber in September?",
      numbers: [{ label: "Uber September", value: total(uberSep) }],
    },
    { id: "pets_oct", question: "How much went to the Pets category in October?", numbers: [{ label: "Pets October", value: total(cat(oct, "pets")) }] },
    {
      id: "largest_income",
      question: "What is the largest single income entry we have recorded?",
      numbers: [{ label: "Largest income", value: Math.max(...inc.map((t) => t.amount)) }],
    },
    {
      id: "insurance_oct",
      question: "How much did we spend on insurance in October?",
      numbers: [],
      noData: true,
    },
    {
      id: "propose_budget",
      question: "Please set the food budget to ₹14,000 a month.",
      numbers: [{ label: "Proposed budget", value: 14000 }],
      proposal: { action: "set_budget", params: { categoryId: "food", amount: 14000 } },
    },
    {
      id: "propose_tag",
      question: "Tag all my Uber rides from October with the Work tag.",
      numbers: [],
      proposal: { action: "tag_transactions", params: { tagId: "tag_work", transactionIds: ashaUberOct } },
    },
  ];
}
