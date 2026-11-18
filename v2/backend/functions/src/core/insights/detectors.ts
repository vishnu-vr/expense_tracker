import { findAnomalies } from "../anomalies";
import { budgetStatus } from "../budget";
import { categoryNameLookup } from "../categories";
import { comparePeriods } from "../compare";
import { addDays, addMonths, dayLabel, monthKey, monthLabel, monthRange, parseDay } from "../dates";
import { formatINR, formatPct, median, pctChange, round2, sum } from "../money";
import { detectRecurringBills, recurringKey, RecurringBill } from "../recurring";
import { HomeData, LTx } from "../types";

export type InsightKind =
  | "month_review"
  | "subscription_price_change"
  | "subscription_new"
  | "subscription_stopped"
  | "bill_missing"
  | "unusual_transaction"
  | "budget_forecast"
  | "merchant_habit"
  | "category_drift"
  | "budget_suggestion"
  | "likely_duplicate";

export interface InsightCard {
  /** Stable id: kind + periodKey + subject. Re-running the detectors yields the same id. */
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  /** Exact figures and ids behind the card (for deep links / native rendering). */
  data: Record<string, unknown>;
  periodKey: string;
}

export function insightId(kind: InsightKind, periodKey: string, subject = ""): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return [kind, clean(periodKey), clean(subject)].filter(Boolean).join("_");
}

function card(
  kind: InsightKind,
  periodKey: string,
  subject: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): InsightCard {
  return { id: insightId(kind, periodKey, subject), kind, title, body, data, periodKey };
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function monthlyTotals(rows: LTx[], months: string[]): number[] {
  const totals = new Map(months.map((m) => [m, 0]));
  for (const t of rows) {
    const m = monthKey(t.day);
    if (totals.has(m)) totals.set(m, (totals.get(m) as number) + t.amount);
  }
  return months.map((m) => round2(totals.get(m) as number));
}

// 1 ---------------------------------------------------------------------------
export function detectMonthReview(data: HomeData, today: string): InsightCard[] {
  const month = addMonths(monthKey(today), -1);
  const prev = addMonths(month, -1);
  const inMonth = data.transactions.filter((t) => monthKey(t.day) === month);
  if (inMonth.length === 0) return [];
  const cmp = comparePeriods(data, monthRange(prev), monthRange(month), { type: "expense", topN: 50 });
  const income = round2(sum(inMonth.filter((t) => t.type === "income").map((t) => t.amount)));
  const expense = cmp.periodB.total;
  const net = round2(income - expense);
  const top = [...cmp.categories].sort((a, b) => b.totalB - a.totalB).filter((c) => c.totalB > 0).slice(0, 3);
  const rise = cmp.categories.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta)[0];
  const fall = cmp.categories.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta)[0];

  const parts: string[] = [];
  if (cmp.deltaPct !== null) {
    const dir = cmp.delta > 0 ? "more" : cmp.delta < 0 ? "less" : null;
    parts.push(
      dir
        ? `You spent ${formatINR(expense)} in ${monthLabel(month)}, ${Math.abs(cmp.deltaPct)}% ${dir} than ${monthLabel(prev)} (${formatINR(cmp.periodA.total)}).`
        : `You spent ${formatINR(expense)} in ${monthLabel(month)}, the same as ${monthLabel(prev)}.`,
    );
  } else {
    parts.push(`You spent ${formatINR(expense)} in ${monthLabel(month)}.`);
  }
  if (income > 0) {
    parts.push(
      net >= 0
        ? `Income was ${formatINR(income)}, leaving ${formatINR(net)}.`
        : `Income was ${formatINR(income)}, so spending exceeded it by ${formatINR(-net)}.`,
    );
  }
  if (top.length) parts.push(`Top categories: ${top.map((c) => `${c.categoryName} ${formatINR(c.totalB)}`).join(", ")}.`);
  if (rise) parts.push(`Biggest rise: ${rise.categoryName} (+${formatINR(rise.delta)}).`);
  if (fall) parts.push(`Biggest drop: ${fall.categoryName} (-${formatINR(-fall.delta)}).`);

  return [
    card("month_review", month, "", `${monthLabel(month)} in review`, parts.join(" "), {
      month,
      expenseTotal: expense,
      incomeTotal: income,
      net,
      previousMonth: prev,
      previousExpenseTotal: cmp.periodA.total,
      expenseDelta: cmp.delta,
      expenseDeltaPct: cmp.deltaPct,
      topCategories: top.map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, total: c.totalB })),
      biggestRise: rise ? { categoryId: rise.categoryId, categoryName: rise.categoryName, delta: rise.delta } : null,
      biggestDrop: fall ? { categoryId: fall.categoryId, categoryName: fall.categoryName, delta: fall.delta } : null,
    }),
  ];
}

// 2 + 3 -----------------------------------------------------------------------
export function detectSubscriptionChanges(data: HomeData, today: string, bills?: RecurringBill[]): InsightCard[] {
  const all = bills ?? detectRecurringBills(data, today, { maxResults: 200 });
  const out: InsightCard[] = [];
  for (const b of all) {
    const base = {
      seriesKey: b.key,
      label: b.label,
      categoryId: b.categoryId,
      cadence: b.cadence,
      lastTransactionId: b.lastTransactionId,
    };
    // Report a price change until the next payment is due (plus two weeks).
    if (b.priceChange && b.lastPaidDate >= addDays(today, -(b.intervalDays + 14))) {
      const p = b.priceChange;
      out.push(
        card(
          "subscription_price_change",
          monthKey(b.lastPaidDate),
          b.key,
          `${b.label} went ${p.direction} ${Math.abs(p.deltaPct)}%`,
          `${b.label} (${b.cadence}) was ${p.currentAmountDisplay} on ${dayLabel(b.lastPaidDate)}, ${p.direction} from the usual ${p.previousAmountDisplay}.`,
          { ...base, previousAmount: p.previousAmount, currentAmount: p.currentAmount, delta: p.delta, deltaPct: p.deltaPct },
        ),
      );
    }
    if (b.isNew && b.status === "active") {
      out.push(
        card(
          "subscription_new",
          monthKey(b.firstPaidDate),
          b.key,
          `New recurring payment: ${b.label}`,
          `${b.label} has been paid ${b.occurrences} times since ${dayLabel(b.firstPaidDate)}, about ${b.averageAmountDisplay} ${b.cadence}.`,
          { ...base, occurrences: b.occurrences, averageAmount: b.averageAmount, firstPaidDate: b.firstPaidDate },
        ),
      );
    }
    if (b.status === "stopped" && b.daysOverdue <= b.intervalDays * 4) {
      out.push(
        card(
          "subscription_stopped",
          monthKey(b.nextExpectedDate),
          b.key,
          `${b.label} seems to have stopped`,
          `No ${b.label} payment since ${dayLabel(b.lastPaidDate)} (it was ${b.averageAmountDisplay} ${b.cadence}). If you cancelled it, nothing to do.`,
          { ...base, lastPaidDate: b.lastPaidDate, averageAmount: b.averageAmount },
        ),
      );
    }
    if (b.status === "missed") {
      out.push(
        card(
          "bill_missing",
          monthKey(b.nextExpectedDate),
          b.key,
          `${b.label} not logged yet`,
          `${b.label} (about ${b.averageAmountDisplay} ${b.cadence}) was expected around ${dayLabel(b.nextExpectedDate)} and is ${b.daysOverdue} days late.`,
          {
            ...base,
            expectedDate: b.nextExpectedDate,
            daysOverdue: b.daysOverdue,
            averageAmount: b.averageAmount,
            lastPaidDate: b.lastPaidDate,
          },
        ),
      );
    }
  }
  return out;
}

// 4 + 9 -----------------------------------------------------------------------
export function detectUnusualAndDuplicates(data: HomeData, today: string, bills?: RecurringBill[]): InsightCard[] {
  const recurring = bills ?? detectRecurringBills(data, today, { maxResults: 200 });
  const out: InsightCard[] = [];
  const unusual = findAnomalies(data, {
    range: { from: addDays(today, -14), to: today },
    excludeRecurringKeys: new Set(recurring.map((b) => b.key)),
    limit: 5,
  });
  for (const a of unusual.anomalies) {
    const t = a.transaction;
    out.push(
      card(
        "unusual_transaction",
        monthKey(t.date),
        t.id,
        `Unusually large ${a.basisLabel} entry`,
        `${t.amountDisplay} on ${dayLabel(t.date)}${t.note ? ` ("${t.note}")` : ""} is ${a.timesTypical}× the usual ${a.typicalAmountDisplay} for ${a.basisLabel}.`,
        {
          transactionId: t.id,
          amount: t.amount,
          basis: a.basis,
          basisLabel: a.basisLabel,
          typicalAmount: a.typicalAmount,
          timesTypical: a.timesTypical,
        },
      ),
    );
  }
  const dups = findAnomalies(data, { range: { from: addDays(today, -30), to: today }, limit: 5 });
  for (const d of dups.duplicates) {
    out.push(
      card(
        "likely_duplicate",
        monthKey(d.date),
        d.transactions[0].id,
        "Possible duplicate entry",
        `${d.transactions.length} identical entries of ${d.amountDisplay} in ${d.categoryName}${d.note ? ` ("${d.note}")` : ""} on ${dayLabel(d.date)}. Delete one if it was logged twice.`,
        { transactionIds: d.transactions.map((t) => t.id), amount: d.amount, categoryId: d.categoryId, date: d.date },
      ),
    );
  }
  return out;
}

// 5 ---------------------------------------------------------------------------
export function detectBudgetForecast(data: HomeData, today: string): InsightCard[] {
  const status = budgetStatus(data, today);
  const out: InsightCard[] = [];
  for (const l of status.lines) {
    if (l.status === "over" && l.crossingDay !== null) {
      out.push(
        card(
          "budget_forecast",
          status.month,
          l.categoryId,
          `${l.categoryName} is over budget`,
          `${l.categoryName} crossed its ${l.budgetDisplay} budget on the ${ordinal(l.crossingDay)}: ${l.spentDisplay} spent so far, ${formatINR(-l.remaining)} over.`,
          { categoryId: l.categoryId, state: "over", budget: l.budget, spent: l.spent, crossingDay: l.crossingDay, forecast: l.forecast },
        ),
      );
    } else if (l.status === "will_cross" && l.crossingDay !== null && status.daysElapsed >= 5) {
      out.push(
        card(
          "budget_forecast",
          status.month,
          l.categoryId,
          `${l.categoryName} will cross budget around the ${ordinal(l.crossingDay)}`,
          `${l.spentDisplay} of ${l.budgetDisplay} spent in ${status.daysElapsed} days. At this pace ${l.categoryName} ends the month near ${l.forecastDisplay}.`,
          { categoryId: l.categoryId, state: "will_cross", budget: l.budget, spent: l.spent, crossingDay: l.crossingDay, forecast: l.forecast },
        ),
      );
    }
  }
  return out;
}

// 6 ---------------------------------------------------------------------------
export function detectMerchantHabits(data: HomeData, today: string): InsightCard[] {
  const month = addMonths(monthKey(today), -1);
  const baseline = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)];
  const expenses = data.transactions.filter((t) => t.type === "expense" && t.merchant);
  const merchants = new Set(expenses.filter((t) => monthKey(t.day) === month).map((t) => t.merchant as string));
  const out: InsightCard[] = [];
  for (const merchant of merchants) {
    const rows = expenses.filter((t) => t.merchant === merchant);
    const current = rows.filter((t) => monthKey(t.day) === month);
    const total = round2(sum(current.map((t) => t.amount)));
    const base = monthlyTotals(rows, baseline);
    if (base.some((v) => v === 0)) continue; // need a habit to compare against
    const baseAvg = round2(sum(base) / base.length);
    const pct = pctChange(total, baseAvg);
    if (current.length < 3 || total < 500 || pct === null || Math.abs(pct) < 30) continue;
    const rounded = Math.round(pct);
    const dir = rounded > 0 ? "up" : "down";
    out.push(
      card(
        "merchant_habit",
        month,
        merchant,
        `${merchant}: ${dir} ${Math.abs(rounded)}% in ${monthLabel(month)}`,
        `${current.length} ${merchant} entries totalling ${formatINR(total)} in ${monthLabel(month)}, ${dir} ${Math.abs(rounded)}% on your usual ${formatINR(baseAvg)} a month.`,
        { merchant, month, count: current.length, total, baselineAverage: baseAvg, deltaPct: rounded },
      ),
    );
  }
  return out.sort((a, b) => Math.abs(b.data.deltaPct as number) - Math.abs(a.data.deltaPct as number)).slice(0, 3);
}

// 7 ---------------------------------------------------------------------------
export function detectCategoryDrift(data: HomeData, today: string): InsightCard[] {
  const last = addMonths(monthKey(today), -1);
  const months = [5, 4, 3, 2, 1, 0].map((n) => addMonths(last, -n));
  const catName = categoryNameLookup(data.categories);
  const expenses = data.transactions.filter((t) => t.type === "expense");
  const out: InsightCard[] = [];
  for (const categoryId of new Set(expenses.map((t) => t.categoryId))) {
    const totals = monthlyTotals(expenses.filter((t) => t.categoryId === categoryId), months);
    // Longest strictly-rising run that ends at the last complete month.
    let run = 1;
    for (let i = totals.length - 1; i > 0 && totals[i] > totals[i - 1] && totals[i - 1] > 0; i--) run++;
    if (run < 3) continue;
    const first = totals[totals.length - run];
    const latest = totals[totals.length - 1];
    const pct = pctChange(latest, first);
    if (pct === null || pct < 20 || latest < 1000) continue;
    const rounded = Math.round(pct);
    out.push(
      card(
        "category_drift",
        last,
        categoryId,
        `${catName(categoryId)} has risen ${run} months in a row`,
        `${catName(categoryId)} went from ${formatINR(first)} in ${monthLabel(months[months.length - run])} to ${formatINR(latest)} in ${monthLabel(last)} (${formatPct(rounded)}).`,
        {
          categoryId,
          months: months.slice(-run),
          totals: totals.slice(-run),
          risingMonths: run,
          deltaPct: rounded,
        },
      ),
    );
  }
  return out.sort((a, b) => (b.data.deltaPct as number) - (a.data.deltaPct as number)).slice(0, 3);
}

// 8 ---------------------------------------------------------------------------
export function detectBudgetSuggestions(data: HomeData, today: string): InsightCard[] {
  const last = addMonths(monthKey(today), -1);
  const months = [addMonths(last, -2), addMonths(last, -1), last];
  const { year, month } = parseDay(today);
  const periodKey = `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  const budgeted = new Set(data.budgets.filter((b) => b.amount > 0).map((b) => b.categoryId));
  const catName = categoryNameLookup(data.categories);
  const expenses = data.transactions.filter((t) => t.type === "expense" && !budgeted.has(t.categoryId));
  const out: InsightCard[] = [];
  for (const categoryId of new Set(expenses.map((t) => t.categoryId))) {
    const totals = monthlyTotals(expenses.filter((t) => t.categoryId === categoryId), months);
    if (totals.some((v) => v === 0)) continue;
    const typical = round2(median(totals));
    if (typical < 1000) continue;
    const suggested = Math.ceil(typical / 100) * 100;
    out.push(
      card(
        "budget_suggestion",
        periodKey,
        categoryId,
        `Set a budget for ${catName(categoryId)}?`,
        `${catName(categoryId)} has no budget. You typically spend ${formatINR(typical)} a month on it; ${formatINR(suggested)} would be a realistic limit.`,
        { categoryId, months, monthlyTotals: totals, typicalMonthly: typical, suggestedBudget: suggested },
      ),
    );
  }
  return out.sort((a, b) => (b.data.typicalMonthly as number) - (a.data.typicalMonthly as number)).slice(0, 3);
}

/** Run every detector. Pure: same data + same `today` => same cards, same ids. */
export function runDetectors(data: HomeData, today: string): InsightCard[] {
  const bills = detectRecurringBills(data, today, { maxResults: 200 });
  const cards = [
    ...detectMonthReview(data, today),
    ...detectSubscriptionChanges(data, today, bills),
    ...detectUnusualAndDuplicates(data, today, bills),
    ...detectBudgetForecast(data, today),
    ...detectMerchantHabits(data, today),
    ...detectCategoryDrift(data, today),
    ...detectBudgetSuggestions(data, today),
  ];
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export { recurringKey };
