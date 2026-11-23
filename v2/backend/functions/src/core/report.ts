/**
 * Expense reports (D-033): every figure of a report, computed in code.
 * Pure: no Firestore, no model. The narrative writer only rewords what this
 * returns, and may only quote numbers that appear in its display strings.
 */
import { findAnomalies } from "./anomalies";
import { categoryNameLookup } from "./categories";
import {
  COMPARISON_MODES,
  ComparisonMode,
  ResolvedComparison,
  ResolvedPeriod,
  resolvePeriod,
} from "./compare";
import { addDays, dayLabel, diffDays, isValidDay, monthKey, monthLabel, weekdayIndex } from "./dates";
import { budgetStatus } from "./budget";
import { formatINR, formatPct, pctChange, round2, sum } from "./money";
import { filterTransactions, makeRowMapper, queryTransactions } from "./query";
import { detectRecurringBills, recurringKey } from "./recurring";
import { DayRange, HomeData, LTx } from "./types";

// ---- shapes ------------------------------------------------------------------

/** A comparison of one figure with the baseline. All deltas are this − baseline. */
export interface FigureCompare {
  base: number;
  baseDisplay: string;
  delta: number;
  deltaDisplay: string;
  /** Null when the baseline is 0 (no "+∞%"), or for figures where a percentage makes no sense. */
  deltaPct: number | null;
  deltaPctDisplay: string | null;
}

export type MetricKey = "spent" | "income" | "net" | "savingsRate" | "entries" | "dailyAverage";

export interface Metric {
  key: MetricKey;
  label: string;
  /** Null when the figure does not exist (savings rate with no income). */
  value: number | null;
  display: string | null;
  compare: FigureCompare | null;
}

export interface EntryRow {
  id: string;
  date: string;
  dateLabel: string;
  /** Merchant, else note, else category name. */
  label: string;
  /** The matched merchant (the only part of a note the narrative model may see). */
  merchant: string | null;
  categoryName: string;
  amount: number;
  amountDisplay: string;
  memberName: string;
  type: "income" | "expense";
}

export interface CategoryRow {
  categoryId: string;
  name: string;
  total: number;
  totalDisplay: string;
  sharePct: number;
  shareDisplay: string;
  count: number;
  compare: FigureCompare | null;
  /** "new": nothing in the baseline; "gone": nothing this period. */
  status: "new" | "gone" | null;
}

export interface MemberRow {
  memberId: string;
  name: string;
  spent: number;
  spentDisplay: string;
  sharePct: number;
  shareDisplay: string;
  count: number;
  compare: FigureCompare | null;
}

export interface WeekRow {
  weekStart: string;
  label: string;
  total: number;
  totalDisplay: string;
}

export interface MerchantRow {
  name: string;
  total: number;
  totalDisplay: string;
  count: number;
  rank: number;
  /** Baseline rank − this rank (positive = moved up); null when new or no comparison. */
  rankChange: number | null;
  isNew: boolean;
}

export interface BillRow {
  key: string;
  label: string;
  categoryName: string;
  cadence: string;
  amount: number;
  amountDisplay: string;
  count: number;
  date: string;
  dateLabel: string;
}

export interface PriceChangeRow {
  key: string;
  label: string;
  previousAmountDisplay: string;
  currentAmountDisplay: string;
  deltaDisplay: string;
  deltaPctDisplay: string;
  direction: "up" | "down";
}

export interface BudgetRow {
  categoryId: string;
  categoryName: string;
  budget: number;
  budgetDisplay: string;
  spent: number;
  spentDisplay: string;
  remainingDisplay: string;
  usedPct: number;
  usedPctDisplay: string;
  status: "over" | "will_cross" | "within";
  /** The comparison month's figures against the same budget (calendar months only). */
  base: { spent: number; spentDisplay: string; usedPct: number; usedPctDisplay: string; status: "over" | "will_cross" | "within" } | null;
}

export interface TagRow {
  tagId: string;
  name: string;
  total: number;
  totalDisplay: string;
  count: number;
  compare: FigureCompare | null;
}

export interface ReportSections {
  headline: {
    metrics: Metric[];
    /** Set when there is a comparison but its period(s) had no entries at all. */
    baselineNote: string | null;
  };
  categories?: { rows: CategoryRow[]; truncated: boolean };
  members?: { rows: MemberRow[] };
  rhythm?: {
    weeks: WeekRow[];
    weekendSharePct: number;
    weekendShareDisplay: string;
    baseWeekendSharePct: number | null;
    baseWeekendShareDisplay: string | null;
    biggestDay: { date: string; label: string; total: number; totalDisplay: string; count: number };
  };
  merchants?: { bySpend: MerchantRow[]; byVisits: MerchantRow[] };
  notable?: {
    largest: EntryRow[];
    anomalies: { entry: EntryRow; basisLabel: string; typicalAmountDisplay: string; timesTypical: number; timesTypicalDisplay: string }[];
    duplicates: {
      date: string;
      dateLabel: string;
      amountDisplay: string;
      categoryName: string;
      label: string;
      merchant: string | null;
      count: number;
      transactionIds: string[];
    }[];
  };
  bills?: { paid: BillRow[]; missed: BillRow[]; priceChanges: PriceChangeRow[] };
  budgets?: {
    month: string;
    monthLabel: string;
    rows: BudgetRow[];
    totalBudgetDisplay: string;
    totalSpentDisplay: string;
    totalUsedPctDisplay: string;
    baseLabel: string | null;
  };
  tags?: { rows: TagRow[] };
}

export interface ReportCompareInfo {
  mode: Exclude<ComparisonMode, "none">;
  label: string;
  from: string;
  to: string;
  days: number;
  periods: number;
  /** Baseline periods with at least one entry. */
  periodsUsed: number;
}

export interface ReportBody {
  period: ResolvedPeriod;
  compare: ReportCompareInfo | null;
  sections: ReportSections;
}

// ---- helpers -----------------------------------------------------------------

/** "+₹500", "-₹500", "₹0". */
export function formatSignedINR(n: number): string {
  const r = round2(n);
  return r > 0 ? `+${formatINR(r)}` : formatINR(r);
}

const pctText = (n: number) => `${Math.round(n * 10) / 10}%`;
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function moneyCompare(value: number, base: number): FigureCompare {
  const delta = round2(value - base);
  const pct = base > 0 ? pctChange(value, base) : null;
  return {
    base: round2(base),
    baseDisplay: formatINR(base),
    delta,
    deltaDisplay: formatSignedINR(delta),
    deltaPct: pct === null ? null : Math.round(pct * 10) / 10,
    deltaPctDisplay: formatPct(pct),
  };
}

function countText(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function countCompare(value: number, base: number): FigureCompare {
  const delta = Math.round((value - base) * 10) / 10;
  const pct = base > 0 ? pctChange(value, base) : null;
  return {
    base: Math.round(base * 10) / 10,
    baseDisplay: countText(base),
    delta,
    deltaDisplay: `${delta > 0 ? "+" : ""}${countText(delta)}`,
    deltaPct: pct === null ? null : Math.round(pct * 10) / 10,
    deltaPctDisplay: formatPct(pct),
  };
}

function pointsCompare(value: number, base: number): FigureCompare {
  const delta = Math.round((value - base) * 10) / 10;
  return {
    base: Math.round(base * 10) / 10,
    baseDisplay: pctText(base),
    delta,
    deltaDisplay: `${delta > 0 ? "+" : ""}${delta} pts`,
    deltaPct: null,
    deltaPctDisplay: null,
  };
}

const sumAmounts = (rows: LTx[]) => round2(sum(rows.map((t) => t.amount)));

/** Totals per key over rows, divided by `divisor` (the number of baseline periods used). */
function totalsBy(rows: LTx[], key: (t: LTx) => string | null, divisor = 1): Map<string, { total: number; count: number }> {
  const out = new Map<string, { total: number; count: number }>();
  for (const t of rows) {
    const k = key(t);
    if (k === null) continue;
    const e = out.get(k) ?? { total: 0, count: 0 };
    e.total += t.amount / divisor;
    e.count += 1 / divisor;
    out.set(k, e);
  }
  return out;
}

// ---- request -----------------------------------------------------------------

/** Thrown for a bad request; the handler turns it into `invalid-argument`. */
export class ReportRequestError extends Error {}

export interface ReportRequest {
  from: string;
  to: string;
  compare: { mode: ComparisonMode; from?: string; to?: string };
}

/**
 * Check the period and comparison of a report request against `today` (the
 * caller's local day): valid days, `from ≤ to`, at most `maxDays` days, not
 * in the future. A custom comparison follows the same rules.
 */
export function parseReportPeriod(data: unknown, today: string, maxDays: number): ReportRequest {
  const d = (data ?? {}) as Record<string, unknown>;
  const range = (from: unknown, to: unknown, what: string): DayRange => {
    if (!isValidDay(from) || !isValidDay(to)) throw new ReportRequestError(`${what} needs from and to as YYYY-MM-DD.`);
    if (from > to) throw new ReportRequestError(`${what}: from must not be after to.`);
    if (to > today) throw new ReportRequestError(`${what} cannot end in the future.`);
    if (diffDays(to, from) + 1 > maxDays) throw new ReportRequestError(`${what} can be at most ${maxDays} days.`);
    return { from, to };
  };
  const period = range(d.from, d.to, "The report period");
  const c = (d.compare ?? { mode: "previous" }) as Record<string, unknown>;
  if (typeof c !== "object" || c === null) throw new ReportRequestError("Invalid compare.");
  const mode = (c.mode ?? "previous") as ComparisonMode;
  if (!COMPARISON_MODES.includes(mode)) throw new ReportRequestError(`compare.mode must be one of: ${COMPARISON_MODES.join(", ")}.`);
  if (mode === "custom") {
    const r = range(c.from, c.to, "The comparison period");
    return { ...period, compare: { mode, from: r.from, to: r.to } };
  }
  return { ...period, compare: { mode } };
}

// ---- the report --------------------------------------------------------------

/**
 * Build every section of a report for `period`, optionally against a
 * resolved comparison. `today` bounds the recurring-bill status. Empty
 * sections are left out.
 */
export function buildReport(data: HomeData, period: DayRange, compare: ResolvedComparison | null, today: string): ReportBody {
  const p = resolvePeriod(period);
  const toRow = makeRowMapper(data);
  const catName = categoryNameLookup(data.categories);
  const memberName = new Map(data.members.map((m) => [m.id, m.name]));
  const entryRow = (t: LTx): EntryRow => {
    const r = toRow(t);
    return {
      id: r.id,
      date: r.date,
      dateLabel: dayLabel(r.date),
      label: r.merchant ?? (r.note.trim() || r.categoryName),
      merchant: r.merchant,
      categoryName: r.categoryName,
      amount: r.amount,
      amountDisplay: r.amountDisplay,
      memberName: r.memberName,
      type: r.type,
    };
  };

  const all = filterTransactions(data.transactions, { from: p.from, to: p.to });
  const expenses = all.filter((t) => t.type === "expense");
  const incomes = all.filter((t) => t.type === "income");
  const spent = sumAmounts(expenses);
  const income = sumAmounts(incomes);
  const net = round2(income - spent);
  const savingsRate = income > 0 ? Math.round((net / income) * 1000) / 10 : null;
  const dailyAverage = round2(spent / p.days);

  // ---- baseline
  const baseRanges = compare?.ranges ?? [];
  const basePeriods = baseRanges.map((r) => filterTransactions(data.transactions, { from: r.from, to: r.to }));
  const usedIdx = basePeriods.map((rows, i) => (rows.length > 0 ? i : -1)).filter((i) => i >= 0);
  const used = usedIdx.length;
  const baseAll = usedIdx.flatMap((i) => basePeriods[i]);
  const baseExpenses = baseAll.filter((t) => t.type === "expense");
  const baseIncomes = baseAll.filter((t) => t.type === "income");
  const hasBase = compare !== null && used > 0;
  const div = Math.max(1, used);
  const baseDays = usedIdx.reduce((s, i) => s + diffDays(baseRanges[i].to, baseRanges[i].from) + 1, 0);

  const baseSpent = round2(sum(baseExpenses.map((t) => t.amount)) / div);
  const baseIncome = round2(sum(baseIncomes.map((t) => t.amount)) / div);
  const baseNet = round2(baseIncome - baseSpent);
  const baseSavings = baseIncome > 0 ? Math.round((baseNet / baseIncome) * 1000) / 10 : null;
  const baseDaily = baseDays > 0 ? round2(sum(baseExpenses.map((t) => t.amount)) / baseDays) : 0;

  const netCompare = (): FigureCompare => {
    const c = moneyCompare(net, baseNet);
    // A percentage of a negative or zero net is misleading.
    return baseNet > 0 ? c : { ...c, deltaPct: null, deltaPctDisplay: null };
  };
  const metrics: Metric[] = [
    { key: "spent", label: "Spent", value: spent, display: formatINR(spent), compare: hasBase ? moneyCompare(spent, baseSpent) : null },
    { key: "income", label: "Income", value: income, display: formatINR(income), compare: hasBase ? moneyCompare(income, baseIncome) : null },
    { key: "net", label: "Net", value: net, display: formatINR(net), compare: hasBase ? netCompare() : null },
    {
      key: "savingsRate",
      label: "Savings rate",
      value: savingsRate,
      display: savingsRate === null ? null : pctText(savingsRate),
      compare: hasBase && savingsRate !== null && baseSavings !== null ? pointsCompare(savingsRate, baseSavings) : null,
    },
    {
      key: "entries",
      label: "Entries",
      value: all.length,
      display: String(all.length),
      compare: hasBase ? countCompare(all.length, baseAll.length / div) : null,
    },
    {
      key: "dailyAverage",
      label: "Spent per day",
      value: dailyAverage,
      display: formatINR(dailyAverage),
      compare: hasBase ? moneyCompare(dailyAverage, baseDaily) : null,
    },
  ];
  const sections: ReportSections = {
    headline: {
      metrics,
      baselineNote: compare && !hasBase ? `No entries in ${compare.label} to compare with.` : null,
    },
  };

  // ---- 2. categories (expenses)
  if (spent > 0 || (hasBase && baseSpent > 0)) {
    const current = totalsBy(expenses, (t) => t.categoryId);
    // Same divisor as the headline: baseline periods with any entry.
    const baseByCat = new Map([...totalsBy(baseExpenses, (t) => t.categoryId, div)].map(([k, v]) => [k, round2(v.total)]));
    const ids = new Set([...current.keys(), ...(hasBase ? [...baseByCat.keys()].filter((k) => (baseByCat.get(k) ?? 0) > 0) : [])]);
    const rows: CategoryRow[] = [...ids].map((id) => {
      const cur = current.get(id);
      const total = round2(cur?.total ?? 0);
      const base = baseByCat.get(id) ?? 0;
      return {
        categoryId: id,
        name: catName(id),
        total,
        totalDisplay: formatINR(total),
        sharePct: share(total, spent),
        shareDisplay: pctText(share(total, spent)),
        count: cur?.count ?? 0,
        compare: hasBase ? moneyCompare(total, base) : null,
        status: !hasBase ? null : total > 0 && base <= 0 ? "new" : total <= 0 && base > 0 ? "gone" : null,
      };
    });
    rows.sort((a, b) => b.total - a.total || (b.compare?.base ?? 0) - (a.compare?.base ?? 0) || (a.name < b.name ? -1 : 1));
    const max = 15;
    sections.categories = { rows: rows.slice(0, max), truncated: rows.length > max };
  }

  // ---- 3. members
  {
    const cur = totalsBy(expenses, (t) => t.userId);
    const base = totalsBy(baseExpenses, (t) => t.userId, div);
    const ids = [...new Set([...data.members.map((m) => m.id), ...cur.keys()])];
    if (ids.length >= 2 && spent > 0) {
      const name = (id: string) =>
        memberName.get(id) ?? expenses.find((t) => t.userId === id)?.userEmail ?? "Former member";
      const rows: MemberRow[] = ids.map((id) => {
        const e = cur.get(id);
        const total = round2(e?.total ?? 0);
        return {
          memberId: id,
          name: name(id),
          spent: total,
          spentDisplay: formatINR(total),
          sharePct: share(total, spent),
          shareDisplay: pctText(share(total, spent)),
          count: e?.count ?? 0,
          compare: hasBase ? moneyCompare(total, base.get(id)?.total ?? 0) : null,
        };
      });
      rows.sort((a, b) => b.spent - a.spent || (a.name < b.name ? -1 : 1));
      sections.members = { rows };
    }
  }

  // ---- 4. rhythm
  if (spent > 0) {
    const weeks = queryTransactions(data, { from: p.from, to: p.to, type: "expense" }, { groupBy: "week", rowLimit: 0 });
    const weekend = (rows: LTx[]) => sum(rows.filter((t) => weekdayIndex(t.day) >= 5).map((t) => t.amount));
    const byDay = totalsBy(expenses, (t) => t.day);
    const [bigDay, big] = [...byDay.entries()].sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1))[0];
    const weekendSharePct = share(weekend(expenses), spent);
    const baseSpentAll = sum(baseExpenses.map((t) => t.amount));
    const baseWeekend = hasBase && baseSpentAll > 0 ? share(weekend(baseExpenses), baseSpentAll) : null;
    sections.rhythm = {
      weeks: weeks.groups.map((g) => ({ weekStart: g.key, label: g.label, total: g.total, totalDisplay: g.totalDisplay })),
      weekendSharePct,
      weekendShareDisplay: pctText(weekendSharePct),
      baseWeekendSharePct: baseWeekend,
      baseWeekendShareDisplay: baseWeekend === null ? null : pctText(baseWeekend),
      biggestDay: { date: bigDay, label: dayLabel(bigDay), total: round2(big.total), totalDisplay: formatINR(big.total), count: big.count },
    };
  }

  // ---- 5. merchants
  {
    const cur = totalsBy(expenses, (t) => t.merchant);
    if (cur.size > 0) {
      const base = totalsBy(baseExpenses, (t) => t.merchant, div);
      const ranked = (m: Map<string, { total: number; count: number }>, by: "total" | "count") =>
        [...m.entries()].sort((a, b) => b[1][by] - a[1][by] || b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
      const rows = (by: "total" | "count"): MerchantRow[] => {
        const baseRank = ranked(base, by);
        return ranked(cur, by)
          .slice(0, 5)
          .map((name, i) => {
            const e = cur.get(name)!;
            const br = baseRank.indexOf(name);
            return {
              name,
              total: round2(e.total),
              totalDisplay: formatINR(e.total),
              count: e.count,
              rank: i + 1,
              rankChange: hasBase && br >= 0 ? br - i : null,
              isNew: hasBase && br < 0,
            };
          });
      };
      sections.merchants = { bySpend: rows("total"), byVisits: rows("count") };
    }
  }

  // ---- 6. notable entries
  // ---- 7. bills
  const asOf = p.to < today ? p.to : today;
  const bills = detectRecurringBills(data, asOf, { maxResults: 200 });
  {
    const largest = [...expenses].sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1)).slice(0, 5).map(entryRow);
    const found = findAnomalies(data, {
      range: { from: p.from, to: p.to },
      excludeRecurringKeys: new Set(bills.map((b) => b.key)),
      limit: 5,
    });
    const byId = new Map(all.map((t) => [t.id, t]));
    const anomalies = found.anomalies
      .filter((a) => byId.has(a.transaction.id))
      .map((a) => ({
        entry: entryRow(byId.get(a.transaction.id)!),
        basisLabel: a.basisLabel,
        typicalAmountDisplay: a.typicalAmountDisplay,
        timesTypical: a.timesTypical,
        timesTypicalDisplay: `${a.timesTypical}×`,
      }));
    const duplicates = found.duplicates.map((g) => ({
      date: g.date,
      dateLabel: dayLabel(g.date),
      amountDisplay: g.amountDisplay,
      categoryName: g.categoryName,
      label: g.transactions[0]?.merchant ?? (g.note.trim() || g.categoryName),
      merchant: g.transactions[0]?.merchant ?? null,
      count: g.transactions.length,
      transactionIds: g.transactions.map((t) => t.id),
    }));
    if (largest.length || anomalies.length || duplicates.length) sections.notable = { largest, anomalies, duplicates };
  }
  {
    const inPeriod = new Map<string, LTx[]>();
    for (const t of expenses) {
      const k = recurringKey(t);
      inPeriod.set(k, [...(inPeriod.get(k) ?? []), t]);
    }
    const paid: BillRow[] = [];
    const missed: BillRow[] = [];
    const priceChanges: PriceChangeRow[] = [];
    for (const b of bills) {
      const pays = inPeriod.get(b.key) ?? [];
      if (pays.length) {
        const amount = sumAmounts(pays);
        const last = pays.reduce((m, t) => (t.day > m ? t.day : m), pays[0].day);
        paid.push({
          key: b.key, label: b.label, categoryName: b.categoryName, cadence: b.cadence,
          amount, amountDisplay: formatINR(amount), count: pays.length, date: last, dateLabel: dayLabel(last),
        });
      } else if (b.status === "missed" && b.nextExpectedDate >= p.from && b.nextExpectedDate <= p.to) {
        missed.push({
          key: b.key, label: b.label, categoryName: b.categoryName, cadence: b.cadence,
          amount: b.lastAmount, amountDisplay: b.lastAmountDisplay, count: 0,
          date: b.nextExpectedDate, dateLabel: dayLabel(b.nextExpectedDate),
        });
      }
      if (b.priceChange && b.lastPaidDate >= p.from && b.lastPaidDate <= p.to) {
        priceChanges.push({
          key: b.key,
          label: b.label,
          previousAmountDisplay: b.priceChange.previousAmountDisplay,
          currentAmountDisplay: b.priceChange.currentAmountDisplay,
          deltaDisplay: formatSignedINR(b.priceChange.delta),
          deltaPctDisplay: b.priceChange.deltaPctDisplay,
          direction: b.priceChange.direction,
        });
      }
    }
    paid.sort((a, b) => b.amount - a.amount || (a.label < b.label ? -1 : 1));
    if (paid.length || missed.length || priceChanges.length) sections.bills = { paid, missed, priceChanges };
  }

  // ---- 8. budgets (calendar months and month to date)
  if (p.shape !== "range" && data.budgets.some((b) => b.amount > 0)) {
    const month = monthKey(p.from);
    const status = budgetStatus(data, p.shape === "month" ? addDays(p.to, 1) : p.to, month);
    const baseMonth =
      p.shape === "month" && compare && compare.ranges.length === 1 && (compare.mode === "previous" || compare.mode === "last_year")
        ? monthKey(compare.from)
        : null;
    const baseStatus = baseMonth ? budgetStatus(data, addDays(compare!.to, 1), baseMonth) : null;
    const baseLines = new Map((baseStatus?.lines ?? []).map((l) => [l.categoryId, l]));
    const rows: BudgetRow[] = status.lines.map((l) => {
      const b = baseLines.get(l.categoryId);
      return {
        categoryId: l.categoryId,
        categoryName: l.categoryName,
        budget: l.budget,
        budgetDisplay: l.budgetDisplay,
        spent: l.spent,
        spentDisplay: l.spentDisplay,
        remainingDisplay: l.remainingDisplay,
        usedPct: l.usedPct,
        usedPctDisplay: pctText(l.usedPct),
        status: l.status,
        base: b ? { spent: b.spent, spentDisplay: b.spentDisplay, usedPct: b.usedPct, usedPctDisplay: pctText(b.usedPct), status: b.status } : null,
      };
    });
    if (rows.length) {
      sections.budgets = {
        month,
        monthLabel: monthLabel(month),
        rows,
        totalBudgetDisplay: status.totals.budgetDisplay,
        totalSpentDisplay: status.totals.spentDisplay,
        totalUsedPctDisplay: pctText(status.totals.usedPct),
        baseLabel: baseMonth ? monthLabel(baseMonth) : null,
      };
    }
  }

  // ---- 9. tags
  {
    const tagName = new Map(data.tags.map((t) => [t.id, t.name]));
    const perTag = (rows: LTx[], divisor = 1) => {
      const out = new Map<string, { total: number; count: number }>();
      for (const t of rows) {
        for (const id of new Set(t.tagIds)) {
          const e = out.get(id) ?? { total: 0, count: 0 };
          e.total += t.amount / divisor;
          e.count += 1 / divisor;
          out.set(id, e);
        }
      }
      return out;
    };
    const cur = perTag(expenses);
    if (cur.size > 0) {
      const base = perTag(baseExpenses, div);
      const rows: TagRow[] = [...cur.entries()]
        .map(([tagId, e]) => ({
          tagId,
          name: tagName.get(tagId) ?? "Tag",
          total: round2(e.total),
          totalDisplay: formatINR(e.total),
          count: e.count,
          compare: hasBase ? moneyCompare(e.total, base.get(tagId)?.total ?? 0) : null,
        }))
        .sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1));
      sections.tags = { rows };
    }
  }

  return {
    period: p,
    compare: compare
      ? {
          mode: compare.mode,
          label: compare.label,
          from: compare.from,
          to: compare.to,
          days: compare.days,
          periods: compare.ranges.length,
          periodsUsed: used,
        }
      : null,
    sections,
  };
}

/** Whether the household has any entry in a period (the monthly job skips homes without). */
export function hasEntries(data: HomeData, r: DayRange): boolean {
  return data.transactions.some((t) => t.day >= r.from && t.day <= r.to);
}

/** Stable id of a monthly report: `monthly_2026-10`. */
export const monthlyReportId = (month: string) => `monthly_${month}`;
