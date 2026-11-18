import { categoryNameLookup } from "./categories";
import { addDays, diffDays } from "./dates";
import { recurringNoteKey, toTitleCase } from "./merchant";
import { formatINR, formatPct, mean, median, pctChange, round2, stdDev } from "./money";
import { HomeData, LTx } from "./types";

export type Cadence = "weekly" | "every 2 weeks" | "monthly" | "quarterly";
export type RecurringStatus = "active" | "missed" | "stopped";

export interface RecurringBill {
  /** `${categoryId}::${noteKey || 'no-note'}` — stable id of the series. */
  key: string;
  label: string;
  categoryId: string;
  categoryName: string;
  cadence: Cadence;
  /** Median gap between payments, in days. */
  intervalDays: number;
  occurrences: number;
  averageAmount: number;
  averageAmountDisplay: string;
  lastAmount: number;
  lastAmountDisplay: string;
  firstPaidDate: string;
  lastPaidDate: string;
  lastTransactionId: string;
  /** lastPaidDate + intervalDays */
  nextExpectedDate: string;
  status: RecurringStatus;
  /** Days past nextExpectedDate as of today (0 when not overdue). */
  daysOverdue: number;
  /** First payment is recent (within about three cycles). */
  isNew: boolean;
  /** Set when the latest payment differs from the usual earlier amount by ≥5% and ≥₹10. */
  priceChange: {
    previousAmount: number;
    previousAmountDisplay: string;
    currentAmount: number;
    currentAmountDisplay: string;
    delta: number;
    deltaDisplay: string;
    deltaPct: number;
    deltaPctDisplay: string;
    direction: "up" | "down";
  } | null;
}

export interface RecurringOptions {
  /** Max series returned (default 20). */
  maxResults?: number;
  userId?: string | null;
  /** Include series that have stopped (default true). */
  includeStopped?: boolean;
}

/** Cadence thresholds — identical to v1 recurring-expenses.ts. */
export function detectCadence(avgInterval: number, intervalStdDev: number): Cadence | null {
  if (avgInterval >= 5 && avgInterval <= 9 && intervalStdDev <= 2) return "weekly";
  if (avgInterval >= 10 && avgInterval <= 18 && intervalStdDev <= 3) return "every 2 weeks";
  if (avgInterval >= 24 && avgInterval <= 40 && intervalStdDev <= 7) return "monthly";
  if (avgInterval >= 75 && avgInterval <= 105 && intervalStdDev <= 12) return "quarterly";
  return null;
}

export function recurringKey(t: Pick<LTx, "categoryId" | "note">): string {
  return `${t.categoryId}::${recurringNoteKey(t.note) || "no-note"}`;
}

const PRICE_CHANGE_MIN_PCT = 5;
const PRICE_CHANGE_MIN_ABS = 10;

/**
 * Detect recurring expenses (port of v1 `detectRecurringExpenses`: same
 * grouping, cadence and amount-variation thresholds), extended with
 * next-expected date, missed / stopped status, new-series flag and price change.
 *
 * - missed: overdue by more than max(3 days, 25% of the interval), up to two intervals.
 * - stopped: overdue by more than two intervals.
 */
export function detectRecurringBills(data: HomeData, today: string, options: RecurringOptions = {}): RecurringBill[] {
  const maxResults = options.maxResults ?? 20;
  const includeStopped = options.includeStopped ?? true;
  const catName = categoryNameLookup(data.categories);

  const filtered = data.transactions
    .filter((t) => t.type === "expense" && t.day <= today)
    .filter((t) => !options.userId || t.userId === options.userId);
  if (filtered.length < 3) return [];

  const groups = new Map<string, LTx[]>();
  for (const t of filtered) {
    const key = recurringKey(t);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const out: RecurringBill[] = [];
  for (const [key, txns] of groups) {
    if (txns.length < 3) continue;
    const sorted = [...txns].sort((a, b) => a.date.getTime() - b.date.getTime());
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) intervals.push(diffDays(sorted[i].day, sorted[i - 1].day));

    const avgInterval = mean(intervals);
    const cadence = detectCadence(avgInterval, stdDev(intervals, avgInterval));
    if (!cadence) continue;

    const amounts = sorted.map((t) => t.amount);
    const avgAmount = mean(amounts);
    if (avgAmount <= 0) continue;
    const noteKey = recurringNoteKey(sorted[0].note);
    const maxVariation = noteKey.length === 0 ? 0.2 : 0.35;
    if (stdDev(amounts, avgAmount) / avgAmount > maxVariation) continue;

    const last = sorted[sorted.length - 1];
    const intervalDays = Math.round(median(intervals));
    const nextExpectedDate = addDays(last.day, intervalDays);
    const overdue = Math.max(0, diffDays(today, nextExpectedDate));
    const grace = Math.max(3, Math.round(intervalDays * 0.25));
    const status: RecurringStatus = overdue > intervalDays * 2 ? "stopped" : overdue > grace ? "missed" : "active";
    if (status === "stopped" && !includeStopped) continue;

    const previousUsual = median(amounts.slice(0, -1));
    const pct = pctChange(last.amount, previousUsual);
    const delta = round2(last.amount - previousUsual);
    const priceChange =
      pct !== null && Math.abs(pct) >= PRICE_CHANGE_MIN_PCT && Math.abs(delta) >= PRICE_CHANGE_MIN_ABS
        ? {
            previousAmount: round2(previousUsual),
            previousAmountDisplay: formatINR(previousUsual),
            currentAmount: round2(last.amount),
            currentAmountDisplay: formatINR(last.amount),
            delta,
            deltaDisplay: formatINR(delta),
            deltaPct: Math.round(pct * 10) / 10,
            deltaPctDisplay: formatPct(pct) as string,
            direction: delta > 0 ? ("up" as const) : ("down" as const),
          }
        : null;

    const categoryName = catName(last.categoryId) || "Uncategorized";
    out.push({
      key,
      label: noteKey ? toTitleCase(noteKey) : categoryName,
      categoryId: last.categoryId,
      categoryName,
      cadence,
      intervalDays,
      occurrences: sorted.length,
      averageAmount: round2(avgAmount),
      averageAmountDisplay: formatINR(avgAmount),
      lastAmount: round2(last.amount),
      lastAmountDisplay: formatINR(last.amount),
      firstPaidDate: sorted[0].day,
      lastPaidDate: last.day,
      lastTransactionId: last.id,
      nextExpectedDate,
      status,
      daysOverdue: overdue,
      isNew: diffDays(today, sorted[0].day) <= Math.round(intervalDays * 3.5),
      priceChange,
    });
  }

  return out
    .sort((a, b) => b.averageAmount - a.averageAmount || (a.key < b.key ? -1 : 1))
    .slice(0, maxResults);
}

/** Monthly-equivalent cost of the active series (weekly ×52/12, etc.). */
export function recurringMonthlyTotal(bills: RecurringBill[]): number {
  const perMonth = (b: RecurringBill) => {
    switch (b.cadence) {
      case "weekly":
        return (b.lastAmount * 52) / 12;
      case "every 2 weeks":
        return (b.lastAmount * 26) / 12;
      case "quarterly":
        return b.lastAmount / 3;
      default:
        return b.lastAmount;
    }
  };
  return round2(bills.filter((b) => b.status !== "stopped").reduce((s, b) => s + perMonth(b), 0));
}
