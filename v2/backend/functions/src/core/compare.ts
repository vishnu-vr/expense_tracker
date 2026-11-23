import { categoryNameLookup } from "./categories";
import { addDays, addMonths, dayLabel, daysInMonth, diffDays, makeDay, monthKey, monthLabel, monthRange, parseDay } from "./dates";
import { formatINR, formatPct, pctChange, round2, sum } from "./money";
import { filterTransactions } from "./query";
import { DayRange, HomeData, TxType } from "./types";

export interface CompareOptions {
  type?: TxType;
  categoryIds?: string[];
  tagIds?: string[];
  userIds?: string[];
  /** Max category rows (default 15). Sorted by absolute change. */
  topN?: number;
}

export interface CategoryDelta {
  categoryId: string;
  categoryName: string;
  totalA: number;
  totalADisplay: string;
  totalB: number;
  totalBDisplay: string;
  /** B − A */
  delta: number;
  deltaDisplay: string;
  /** Percent change from A to B; null when A is 0. */
  deltaPct: number | null;
  deltaPctDisplay: string | null;
}

export interface CompareResult {
  type: TxType;
  periodA: DayRange & { total: number; totalDisplay: string; count: number };
  periodB: DayRange & { total: number; totalDisplay: string; count: number };
  /** B − A */
  delta: number;
  deltaDisplay: string;
  deltaPct: number | null;
  deltaPctDisplay: string | null;
  direction: "up" | "down" | "flat";
  categories: CategoryDelta[];
  categoriesTruncated: boolean;
}

/** Compare period A (earlier/baseline) with period B. All deltas are B − A. */
export function comparePeriods(data: HomeData, a: DayRange, b: DayRange, options: CompareOptions = {}): CompareResult {
  const type = options.type ?? "expense";
  const base = { type, categoryIds: options.categoryIds, tagIds: options.tagIds, userIds: options.userIds };
  const rowsA = filterTransactions(data.transactions, { ...base, from: a.from, to: a.to });
  const rowsB = filterTransactions(data.transactions, { ...base, from: b.from, to: b.to });
  const totalA = round2(sum(rowsA.map((t) => t.amount)));
  const totalB = round2(sum(rowsB.map((t) => t.amount)));
  const catName = categoryNameLookup(data.categories);

  const perCat = new Map<string, { a: number; b: number }>();
  for (const t of rowsA) {
    const e = perCat.get(t.categoryId) ?? { a: 0, b: 0 };
    e.a += t.amount;
    perCat.set(t.categoryId, e);
  }
  for (const t of rowsB) {
    const e = perCat.get(t.categoryId) ?? { a: 0, b: 0 };
    e.b += t.amount;
    perCat.set(t.categoryId, e);
  }

  const all: CategoryDelta[] = [...perCat.entries()]
    .map(([categoryId, v]) => {
      const ta = round2(v.a);
      const tb = round2(v.b);
      const delta = round2(tb - ta);
      const pct = pctChange(tb, ta);
      return {
        categoryId,
        categoryName: catName(categoryId),
        totalA: ta,
        totalADisplay: formatINR(ta),
        totalB: tb,
        totalBDisplay: formatINR(tb),
        delta,
        deltaDisplay: formatINR(delta),
        deltaPct: pct === null ? null : Math.round(pct * 10) / 10,
        deltaPctDisplay: formatPct(pct),
      };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.categoryName < y.categoryName ? -1 : 1));

  const topN = Math.max(1, Math.min(50, options.topN ?? 15));
  const delta = round2(totalB - totalA);
  const pct = pctChange(totalB, totalA);
  return {
    type,
    periodA: { ...a, total: totalA, totalDisplay: formatINR(totalA), count: rowsA.length },
    periodB: { ...b, total: totalB, totalDisplay: formatINR(totalB), count: rowsB.length },
    delta,
    deltaDisplay: formatINR(delta),
    deltaPct: pct === null ? null : Math.round(pct * 10) / 10,
    deltaPctDisplay: formatPct(pct),
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    categories: all.slice(0, topN),
    categoriesTruncated: all.length > topN,
  };
}

// ---- averages and period resolution (reports, D-033) -------------------------

export interface AverageCompareResult extends CompareResult {
  /** Baseline periods asked for (3 for "average"). */
  periods: number;
  /** Baseline periods that had at least one entry of the type; totals are divided by this. */
  periodsUsed: number;
}

/**
 * Compare period B with the average of several baseline periods (a "typical
 * month"). Baselines with no entries of the type are left out of the average
 * (the household probably was not tracking then); with none left the
 * baseline is 0 and every percentage is null, never "+∞%".
 */
export function compareToAverage(
  data: HomeData,
  baselines: DayRange[],
  b: DayRange,
  options: CompareOptions = {},
): AverageCompareResult {
  const type = options.type ?? "expense";
  const base = { type, categoryIds: options.categoryIds, tagIds: options.tagIds, userIds: options.userIds };
  const perPeriod = baselines.map((r) => filterTransactions(data.transactions, { ...base, from: r.from, to: r.to }));
  const used = perPeriod.filter((rows) => rows.length > 0);
  const n = used.length;
  const rowsB = filterTransactions(data.transactions, { ...base, from: b.from, to: b.to });
  const catName = categoryNameLookup(data.categories);

  const perCat = new Map<string, { a: number; b: number }>();
  for (const rows of used) {
    for (const t of rows) {
      const e = perCat.get(t.categoryId) ?? { a: 0, b: 0 };
      e.a += t.amount / n;
      perCat.set(t.categoryId, e);
    }
  }
  for (const t of rowsB) {
    const e = perCat.get(t.categoryId) ?? { a: 0, b: 0 };
    e.b += t.amount;
    perCat.set(t.categoryId, e);
  }
  const all: CategoryDelta[] = [...perCat.entries()]
    .map(([categoryId, v]) => {
      const ta = round2(v.a);
      const tb = round2(v.b);
      const delta = round2(tb - ta);
      const pct = pctChange(tb, ta);
      return {
        categoryId,
        categoryName: catName(categoryId),
        totalA: ta,
        totalADisplay: formatINR(ta),
        totalB: tb,
        totalBDisplay: formatINR(tb),
        delta,
        deltaDisplay: formatINR(delta),
        deltaPct: pct === null ? null : Math.round(pct * 10) / 10,
        deltaPctDisplay: formatPct(pct),
      };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.categoryName < y.categoryName ? -1 : 1));

  const totalA = n ? round2(sum(used.flat().map((t) => t.amount)) / n) : 0;
  const countA = n ? Math.round((used.flat().length / n) * 10) / 10 : 0;
  const totalB = round2(sum(rowsB.map((t) => t.amount)));
  const topN = Math.max(1, Math.min(50, options.topN ?? 15));
  const delta = round2(totalB - totalA);
  const pct = pctChange(totalB, totalA);
  const span = baselines.length
    ? { from: baselines.map((r) => r.from).sort()[0], to: baselines.map((r) => r.to).sort().slice(-1)[0] }
    : { from: b.from, to: b.from };
  return {
    type,
    periodA: { ...span, total: totalA, totalDisplay: formatINR(totalA), count: countA },
    periodB: { ...b, total: totalB, totalDisplay: formatINR(totalB), count: rowsB.length },
    delta,
    deltaDisplay: formatINR(delta),
    deltaPct: pct === null ? null : Math.round(pct * 10) / 10,
    deltaPctDisplay: formatPct(pct),
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    categories: all.slice(0, topN),
    categoriesTruncated: all.length > topN,
    periods: baselines.length,
    periodsUsed: n,
  };
}

export type ComparisonMode = "previous" | "last_year" | "average" | "custom" | "none";
export const COMPARISON_MODES: readonly ComparisonMode[] = ["previous", "last_year", "average", "custom", "none"];

/** How a report period is shaped; comparisons follow the shape. */
export type PeriodShape = "month" | "month_to_date" | "range";

export interface ResolvedPeriod extends DayRange {
  label: string;
  days: number;
  shape: PeriodShape;
}

export interface ResolvedComparison extends DayRange {
  mode: Exclude<ComparisonMode, "none">;
  label: string;
  /** The baseline period(s): one, or several for "average". `from`/`to` span them all. */
  ranges: DayRange[];
  /** Total days across the baseline periods. */
  days: number;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "1–15 Aug 2026", "25 Aug – 3 Sep 2026", "25 Dec 2025 – 3 Jan 2026", "3 Mar 2026". */
export function rangeLabel(r: DayRange): string {
  if (r.from === r.to) return dayLabel(r.from);
  const a = parseDay(r.from);
  const b = parseDay(r.to);
  if (a.year === b.year && a.month === b.month) return `${a.date}–${b.date} ${SHORT_MONTHS[b.month - 1]} ${b.year}`;
  if (a.year === b.year) return `${a.date} ${SHORT_MONTHS[a.month - 1]} – ${b.date} ${SHORT_MONTHS[b.month - 1]} ${b.year}`;
  return `${dayLabel(r.from)} – ${dayLabel(r.to)}`;
}

/** "Jul–Sep 2026" or "Nov 2025–Jan 2026" for a run of months. */
function monthSpanLabel(first: string, last: string): string {
  const [fy, fm] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  return fy === ly
    ? `${SHORT_MONTHS[fm - 1]}–${SHORT_MONTHS[lm - 1]} ${ly}`
    : `${SHORT_MONTHS[fm - 1]} ${fy}–${SHORT_MONTHS[lm - 1]} ${ly}`;
}

export function periodShape(r: DayRange): PeriodShape {
  const a = parseDay(r.from);
  const b = parseDay(r.to);
  if (a.date !== 1 || a.year !== b.year || a.month !== b.month) return "range";
  return b.date === daysInMonth(monthKey(r.to)) ? "month" : "month_to_date";
}

export function resolvePeriod(r: DayRange): ResolvedPeriod {
  const shape = periodShape(r);
  return {
    from: r.from,
    to: r.to,
    days: diffDays(r.to, r.from) + 1,
    shape,
    label: shape === "month" ? monthLabel(monthKey(r.from)) : rangeLabel(r),
  };
}

/** The same days of a month `n` months away (month-to-date rule); the end day is clamped to that month. */
function sameDaysOfMonth(period: DayRange, n: number): DayRange {
  const month = addMonths(monthKey(period.from), n);
  const end = Math.min(parseDay(period.to).date, daysInMonth(month));
  return { from: `${month}-01`, to: `${month}-${String(end).padStart(2, "0")}` };
}

/** The same dates a year earlier; 29 Feb becomes 28 Feb. */
function yearEarlier(day: string): string {
  const { year, month, date } = parseDay(day);
  const y = year - 1;
  const d = Math.min(date, daysInMonth(`${y}-${String(month).padStart(2, "0")}`));
  return makeDay(y, month, d);
}

/** The window of the same length ending the day before `period` starts, `k` windows back (k ≥ 1). */
function windowBefore(period: DayRange, k: number): DayRange {
  const len = diffDays(period.to, period.from) + 1;
  return { from: addDays(period.from, -len * k), to: addDays(period.from, -len * (k - 1) - 1) };
}

const spanOf = (ranges: DayRange[]): DayRange => ({
  from: ranges.map((r) => r.from).sort()[0],
  to: ranges.map((r) => r.to).sort().slice(-1)[0],
});

/**
 * The baseline for a report period.
 * - previous: a calendar month gives the previous calendar month; month to
 *   date gives the same days of last month; any other range the same number
 *   of days immediately before.
 * - last_year: the same dates one year earlier (a calendar month stays whole).
 * - average: the previous `averagePeriods` periods of the same shape.
 * - custom: `custom` as given. none: null.
 */
export function resolveComparison(
  period: DayRange,
  mode: ComparisonMode,
  custom?: DayRange | null,
  averagePeriods = 3,
): ResolvedComparison | null {
  const shape = periodShape(period);
  const withDays = (ranges: DayRange[]) => ranges.reduce((s, r) => s + diffDays(r.to, r.from) + 1, 0);
  switch (mode) {
    case "none":
      return null;
    case "custom": {
      if (!custom) return null;
      const r = { from: custom.from, to: custom.to };
      return { mode, ...r, ranges: [r], days: withDays([r]), label: resolvePeriod(r).label };
    }
    case "previous": {
      const r = shape === "range" ? windowBefore(period, 1) : sameDaysOfMonth(period, -1);
      const label = shape === "month" ? monthLabel(monthKey(r.from)) : rangeLabel(r);
      return { mode, ...r, ranges: [r], days: withDays([r]), label };
    }
    case "last_year": {
      const r =
        shape === "month"
          ? monthRange(addMonths(monthKey(period.from), -12))
          : { from: yearEarlier(period.from), to: yearEarlier(period.to) };
      const label = shape === "month" ? monthLabel(monthKey(r.from)) : rangeLabel(r);
      return { mode, ...r, ranges: [r], days: withDays([r]), label };
    }
    case "average": {
      const n = Math.max(1, averagePeriods);
      const ranges: DayRange[] = [];
      for (let k = n; k >= 1; k--) {
        if (shape === "month") ranges.push(monthRange(addMonths(monthKey(period.from), -k)));
        else if (shape === "month_to_date") ranges.push(sameDaysOfMonth(period, -k));
        else ranges.push(windowBefore(period, k));
      }
      const span = spanOf(ranges);
      const months = monthSpanLabel(monthKey(ranges[0].from), monthKey(ranges[ranges.length - 1].from));
      const label =
        shape === "month"
          ? `${n}-month average (${months})`
          : shape === "month_to_date"
            ? `average of the same days in ${months}`
            : `average of the previous ${n} periods`;
      return { mode, ...span, ranges, days: withDays(ranges), label };
    }
  }
}
