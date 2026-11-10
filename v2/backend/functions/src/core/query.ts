import { categoryNameLookup } from "./categories";
import { WEEKDAYS, addDays, addMonths, monthKey, monthLabel, dayLabel, weekStart, weekdayIndex, diffDays } from "./dates";
import { normalizeNote } from "./merchant";
import { formatINR, round2, sum } from "./money";
import { HomeData, LTx, TxType } from "./types";

export type TypeFilter = TxType | "all";
export type GroupBy = "category" | "month" | "week" | "weekday" | "member" | "merchant" | "none";
export type RowSort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export interface TxFilter {
  from?: string;
  to?: string;
  type?: TypeFilter;
  categoryIds?: string[];
  tagIds?: string[];
  userIds?: string[];
  minAmount?: number;
  maxAmount?: number;
  /** Case-insensitive match on the note or the matched merchant name. */
  text?: string;
}

export interface QueryOptions {
  groupBy?: GroupBy;
  /** Max groups returned (default 10, max 50). Month/week/weekday groups are chronological and capped at 60. */
  topN?: number;
  /** Max rows returned (default 10, max 50). */
  rowLimit?: number;
  rowSort?: RowSort;
}

export interface TxRowOut {
  id: string;
  date: string;
  note: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  amountDisplay: string;
  type: TxType;
  memberName: string;
  merchant: string | null;
  tagNames: string[];
}

export interface GroupOut {
  key: string;
  label: string;
  count: number;
  total: number;
  totalDisplay: string;
  average: number;
  averageDisplay: string;
  /** Share of the grouped total, in percent (one decimal). */
  sharePct: number;
  /** Only when type = "all": income in the same bucket (the group totals themselves are expenses). */
  incomeTotal?: number;
  incomeTotalDisplay?: string;
}

export interface QueryResult {
  appliedFilter: { from: string | null; to: string | null; type: TypeFilter };
  summary: {
    count: number;
    expenseCount: number;
    expenseTotal: number;
    expenseTotalDisplay: string;
    expenseAverage: number;
    expenseAverageDisplay: string;
    incomeCount: number;
    incomeTotal: number;
    incomeTotalDisplay: string;
    incomeAverage: number;
    incomeAverageDisplay: string;
    net: number;
    netDisplay: string;
    largest: TxRowOut | null;
    smallest: TxRowOut | null;
    /** Days in the requested range (null when no range given) and expense per day over it. */
    daysInRange: number | null;
    expensePerDay: number | null;
    expensePerDayDisplay: string | null;
  };
  groupBy: GroupBy;
  /** What the group totals measure: the filtered type, or expenses when type = "all". */
  groupsBasis: TxType | null;
  groups: GroupOut[];
  groupCount: number;
  groupsTruncated: boolean;
  /** Mean of the group totals over ALL groups (empty months/weeks inside the range count as 0). */
  averagePerGroup: number | null;
  averagePerGroupDisplay: string | null;
  rows: TxRowOut[];
  rowsTruncated: boolean;
}

const clamp = (n: number | undefined, def: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Number.isFinite(n) ? Math.floor(n as number) : def));

export function filterTransactions(transactions: LTx[], filter: TxFilter): LTx[] {
  const type = filter.type ?? "all";
  const cats = filter.categoryIds?.length ? new Set(filter.categoryIds) : null;
  const tags = filter.tagIds?.length ? new Set(filter.tagIds) : null;
  const users = filter.userIds?.length ? new Set(filter.userIds) : null;
  const text = normalizeNote(filter.text);
  return transactions.filter((t) => {
    if (filter.from && t.day < filter.from) return false;
    if (filter.to && t.day > filter.to) return false;
    if (type !== "all" && t.type !== type) return false;
    if (cats && !cats.has(t.categoryId)) return false;
    if (tags && !t.tagIds.some((id) => tags.has(id))) return false;
    if (users && !users.has(t.userId)) return false;
    if (filter.minAmount !== undefined && t.amount < filter.minAmount) return false;
    if (filter.maxAmount !== undefined && t.amount > filter.maxAmount) return false;
    if (text) {
      const inNote = normalizeNote(t.note).includes(text);
      const inMerchant = t.merchant ? normalizeNote(t.merchant) === text : false;
      if (!inNote && !inMerchant) return false;
    }
    return true;
  });
}

export function makeRowMapper(data: Pick<HomeData, "categories" | "tags" | "members">): (t: LTx) => TxRowOut {
  const catName = categoryNameLookup(data.categories);
  const tagName = new Map(data.tags.map((t) => [t.id, t.name]));
  const memberName = new Map(data.members.map((m) => [m.id, m.name]));
  return (t) => ({
    id: t.id,
    date: t.day,
    note: t.note ?? "",
    categoryId: t.categoryId,
    categoryName: catName(t.categoryId),
    amount: round2(t.amount),
    amountDisplay: formatINR(t.amount),
    type: t.type,
    memberName: memberName.get(t.userId) ?? t.userEmail ?? "Unknown",
    merchant: t.merchant,
    tagNames: t.tagIds.map((id) => tagName.get(id) ?? id),
  });
}

function sortRows(rows: LTx[], sort: RowSort): LTx[] {
  const byId = (a: LTx, b: LTx) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const copy = [...rows];
  switch (sort) {
    case "date_asc":
      return copy.sort((a, b) => a.date.getTime() - b.date.getTime() || byId(a, b));
    case "amount_desc":
      return copy.sort((a, b) => b.amount - a.amount || b.date.getTime() - a.date.getTime() || byId(a, b));
    case "amount_asc":
      return copy.sort((a, b) => a.amount - b.amount || b.date.getTime() - a.date.getTime() || byId(a, b));
    default:
      return copy.sort((a, b) => b.date.getTime() - a.date.getTime() || byId(a, b));
  }
}

const CHRONOLOGICAL: ReadonlySet<GroupBy> = new Set<GroupBy>(["month", "week", "weekday"]);
const MAX_CHRONO_GROUPS = 60;

/**
 * Filter + aggregate transactions. Every number in the result is computed
 * here; the model only quotes them.
 */
export function queryTransactions(data: HomeData, filter: TxFilter = {}, options: QueryOptions = {}): QueryResult {
  const type = filter.type ?? "expense";
  const groupBy = options.groupBy ?? "none";
  const topN = clamp(options.topN, 10, 1, 50);
  const rowLimit = clamp(options.rowLimit, 10, 0, 50);
  const toRow = makeRowMapper(data);

  const matched = filterTransactions(data.transactions, { ...filter, type });
  const expenses = matched.filter((t) => t.type === "expense");
  const incomes = matched.filter((t) => t.type === "income");
  const expenseTotal = round2(sum(expenses.map((t) => t.amount)));
  const incomeTotal = round2(sum(incomes.map((t) => t.amount)));
  const expenseAverage = expenses.length ? round2(expenseTotal / expenses.length) : 0;
  const incomeAverage = incomes.length ? round2(incomeTotal / incomes.length) : 0;

  const byAmount = sortRows(matched, "amount_desc");
  const daysInRange = filter.from && filter.to ? diffDays(filter.to, filter.from) + 1 : null;
  const expensePerDay = daysInRange && daysInRange > 0 ? round2(expenseTotal / daysInRange) : null;

  // ---- groups
  const basis: TxType | null = groupBy === "none" ? null : type === "all" ? "expense" : type;
  let groups: GroupOut[] = [];
  let groupCount = 0;
  let groupsTruncated = false;
  let averagePerGroup: number | null = null;

  if (groupBy !== "none" && basis) {
    const basisRows = matched.filter((t) => t.type === basis);
    const catName = categoryNameLookup(data.categories);
    const memberName = new Map(data.members.map((m) => [m.id, m.name]));
    const keyOf = (t: LTx): { key: string; label: string } => {
      switch (groupBy) {
        case "category":
          return { key: t.categoryId, label: catName(t.categoryId) };
        case "month": {
          const k = monthKey(t.day);
          return { key: k, label: monthLabel(k) };
        }
        case "week": {
          const k = weekStart(t.day);
          return { key: k, label: `Week of ${dayLabel(k)}` };
        }
        case "weekday": {
          const i = weekdayIndex(t.day);
          return { key: String(i), label: WEEKDAYS[i] };
        }
        case "member":
          return { key: t.userId, label: memberName.get(t.userId) ?? t.userEmail ?? "Unknown" };
        default:
          return t.merchant ? { key: t.merchant, label: t.merchant } : { key: "(other)", label: "Other / unmatched" };
      }
    };

    const buckets = new Map<string, { label: string; amounts: number[]; income: number }>();
    const ensure = (key: string, label: string) => {
      let b = buckets.get(key);
      if (!b) {
        b = { label, amounts: [], income: 0 };
        buckets.set(key, b);
      }
      return b;
    };

    // Pre-fill empty periods so per-month / per-week averages are honest.
    const span = basisRows.length
      ? {
          from: filter.from ?? basisRows.reduce((m, t) => (t.day < m ? t.day : m), basisRows[0].day),
          to: filter.to ?? basisRows.reduce((m, t) => (t.day > m ? t.day : m), basisRows[0].day),
        }
      : filter.from && filter.to
        ? { from: filter.from, to: filter.to }
        : null;
    if (span && groupBy === "month") {
      for (let k = monthKey(span.from), n = 0; k <= monthKey(span.to) && n < 240; k = addMonths(k, 1), n++) {
        ensure(k, monthLabel(k));
      }
    } else if (span && groupBy === "week") {
      for (let k = weekStart(span.from), n = 0; k <= span.to && n < 1040; k = addDays(k, 7), n++) {
        ensure(k, `Week of ${dayLabel(k)}`);
      }
    } else if (groupBy === "weekday") {
      WEEKDAYS.forEach((label, i) => ensure(String(i), label));
    }

    for (const t of basisRows) {
      const { key, label } = keyOf(t);
      ensure(key, label).amounts.push(t.amount);
    }
    if (type === "all") {
      for (const t of incomes) {
        const { key, label } = keyOf(t);
        ensure(key, label).income += t.amount;
      }
    }

    const grandTotal = sum(basisRows.map((t) => t.amount));
    let all: GroupOut[] = [...buckets.entries()].map(([key, b]) => {
      const total = round2(sum(b.amounts));
      const average = b.amounts.length ? round2(total / b.amounts.length) : 0;
      const g: GroupOut = {
        key,
        label: b.label,
        count: b.amounts.length,
        total,
        totalDisplay: formatINR(total),
        average,
        averageDisplay: formatINR(average),
        sharePct: grandTotal > 0 ? Math.round((total / grandTotal) * 1000) / 10 : 0,
      };
      if (type === "all") {
        g.incomeTotal = round2(b.income);
        g.incomeTotalDisplay = formatINR(b.income);
      }
      return g;
    });

    groupCount = all.length;
    averagePerGroup = all.length ? round2(sum(all.map((g) => g.total)) / all.length) : null;

    if (CHRONOLOGICAL.has(groupBy)) {
      all.sort((a, b) => (groupBy === "weekday" ? Number(a.key) - Number(b.key) : a.key < b.key ? -1 : 1));
      if (all.length > MAX_CHRONO_GROUPS) {
        all = all.slice(-MAX_CHRONO_GROUPS);
        groupsTruncated = true;
      }
    } else {
      all.sort((a, b) => b.total - a.total || (a.label < b.label ? -1 : 1));
      if (all.length > topN) {
        all = all.slice(0, topN);
        groupsTruncated = true;
      }
    }
    groups = all;
  }

  const sorted = sortRows(matched, options.rowSort ?? "date_desc");

  return {
    appliedFilter: { from: filter.from ?? null, to: filter.to ?? null, type },
    summary: {
      count: matched.length,
      expenseCount: expenses.length,
      expenseTotal,
      expenseTotalDisplay: formatINR(expenseTotal),
      expenseAverage,
      expenseAverageDisplay: formatINR(expenseAverage),
      incomeCount: incomes.length,
      incomeTotal,
      incomeTotalDisplay: formatINR(incomeTotal),
      incomeAverage,
      incomeAverageDisplay: formatINR(incomeAverage),
      net: round2(incomeTotal - expenseTotal),
      netDisplay: formatINR(incomeTotal - expenseTotal),
      largest: byAmount.length ? toRow(byAmount[0]) : null,
      smallest: byAmount.length ? toRow(byAmount[byAmount.length - 1]) : null,
      daysInRange,
      expensePerDay,
      expensePerDayDisplay: expensePerDay === null ? null : formatINR(expensePerDay),
    },
    groupBy,
    groupsBasis: basis,
    groups,
    groupCount,
    groupsTruncated,
    averagePerGroup,
    averagePerGroupDisplay: averagePerGroup === null ? null : formatINR(averagePerGroup),
    rows: sorted.slice(0, rowLimit).map(toRow),
    rowsTruncated: sorted.length > rowLimit,
  };
}
