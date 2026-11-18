import { categoryNameLookup } from "./categories";
import { normalizeNote } from "./merchant";
import { formatINR, median, round2 } from "./money";
import { makeRowMapper, TxRowOut } from "./query";
import { recurringKey } from "./recurring";
import { DayRange, HomeData, LTx } from "./types";

export interface Anomaly {
  transaction: TxRowOut;
  /** What the entry was compared against. */
  basis: "merchant" | "category";
  basisLabel: string;
  /** Median of the other entries in the same merchant/category. */
  typicalAmount: number;
  typicalAmountDisplay: string;
  /** amount ÷ typicalAmount, one decimal. */
  timesTypical: number;
  sampleSize: number;
}

export interface DuplicateGroup {
  date: string;
  amount: number;
  amountDisplay: string;
  categoryId: string;
  categoryName: string;
  note: string;
  transactions: TxRowOut[];
}

export interface AnomalyResult {
  anomalies: Anomaly[];
  anomaliesTruncated: boolean;
  duplicates: DuplicateGroup[];
  duplicatesTruncated: boolean;
}

export interface AnomalyOptions {
  /** Only report entries inside this range (history outside it still forms the norm). */
  range?: Partial<DayRange>;
  /** Keys of recurring series (see `recurringKey`) to leave out: a monthly rent is not an anomaly. */
  excludeRecurringKeys?: Set<string>;
  limit?: number;
}

const MIN_SAMPLE = 5;
const ROBUST_Z = 3.5;
const MIN_TIMES_TYPICAL = 4;
const MIN_ABOVE_TYPICAL = 500;

/**
 * Unusually large expenses and likely duplicate entries.
 *
 * Outliers use a robust (median / MAD) score against the other entries of the
 * same merchant when the note matches one (≥5 entries), otherwise of the same
 * category. An entry is flagged when its robust z-score is > 3.5 AND it is at
 * least 4× the typical (median) amount AND at least ₹500 above it.
 *
 * Duplicates: two or more entries with the same type, amount, category, local
 * day and normalised note.
 */
export function findAnomalies(data: HomeData, options: AnomalyOptions = {}): AnomalyResult {
  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const toRow = makeRowMapper(data);
  const catName = categoryNameLookup(data.categories);
  const inRange = (t: LTx) =>
    (!options.range?.from || t.day >= options.range.from) && (!options.range?.to || t.day <= options.range.to);

  const expenses = data.transactions.filter((t) => t.type === "expense");
  const byMerchant = new Map<string, LTx[]>();
  const byCategory = new Map<string, LTx[]>();
  for (const t of expenses) {
    if (t.merchant) byMerchant.set(t.merchant, [...(byMerchant.get(t.merchant) ?? []), t]);
    byCategory.set(t.categoryId, [...(byCategory.get(t.categoryId) ?? []), t]);
  }

  const anomalies: Anomaly[] = [];
  for (const t of expenses) {
    if (!inRange(t)) continue;
    if (options.excludeRecurringKeys?.has(recurringKey(t))) continue;

    const merchantGroup = t.merchant ? byMerchant.get(t.merchant) ?? [] : [];
    const useMerchant = merchantGroup.length >= MIN_SAMPLE;
    const group = useMerchant ? merchantGroup : byCategory.get(t.categoryId) ?? [];
    if (group.length < MIN_SAMPLE) continue;

    const others = group.filter((o) => o.id !== t.id).map((o) => o.amount);
    const typical = median(others);
    if (typical <= 0) continue;
    const mad = median(others.map((a) => Math.abs(a - typical)));
    // 1.4826 × MAD estimates the standard deviation; floor it so a group of
    // identical amounts does not make every small difference an outlier.
    const scale = Math.max(1.4826 * mad, typical * 0.1);
    const z = (t.amount - typical) / scale;
    const times = t.amount / typical;
    if (z > ROBUST_Z && times >= MIN_TIMES_TYPICAL && t.amount - typical >= MIN_ABOVE_TYPICAL) {
      anomalies.push({
        transaction: toRow(t),
        basis: useMerchant ? "merchant" : "category",
        basisLabel: useMerchant ? (t.merchant as string) : catName(t.categoryId),
        typicalAmount: round2(typical),
        typicalAmountDisplay: formatINR(typical),
        timesTypical: Math.round(times * 10) / 10,
        sampleSize: others.length,
      });
    }
  }
  anomalies.sort(
    (a, b) => b.timesTypical - a.timesTypical || (a.transaction.id < b.transaction.id ? -1 : 1),
  );

  // ---- duplicates
  const dupGroups = new Map<string, LTx[]>();
  for (const t of data.transactions) {
    if (!inRange(t)) continue;
    const key = [t.type, t.day, t.categoryId, round2(t.amount), normalizeNote(t.note)].join("|");
    dupGroups.set(key, [...(dupGroups.get(key) ?? []), t]);
  }
  const duplicates: DuplicateGroup[] = [...dupGroups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => {
      const sorted = [...g].sort((a, b) => (a.id < b.id ? -1 : 1));
      return {
        date: sorted[0].day,
        amount: round2(sorted[0].amount),
        amountDisplay: formatINR(sorted[0].amount),
        categoryId: sorted[0].categoryId,
        categoryName: catName(sorted[0].categoryId),
        note: sorted[0].note ?? "",
        transactions: sorted.map(toRow),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.amount - a.amount));

  return {
    anomalies: anomalies.slice(0, limit),
    anomaliesTruncated: anomalies.length > limit,
    duplicates: duplicates.slice(0, limit),
    duplicatesTruncated: duplicates.length > limit,
  };
}
