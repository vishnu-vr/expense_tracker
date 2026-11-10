import { categoryNameLookup } from "./categories";
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
