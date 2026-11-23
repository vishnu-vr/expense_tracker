/**
 * Pure v1 -> v2 document transforms for the migration (no Firebase imports,
 * unit-tested in test/unit/migrate-transform.test.ts).
 */

export interface V2Transaction {
  amount: number;
  categoryId: string;
  /** Written to Firestore as a Timestamp. */
  date: Date;
  note?: string;
  type: "income" | "expense";
  userId: string;
  userEmail: string;
  homeId: string;
  tagIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type TransformResult = { ok: true; doc: V2Transaction } | { ok: false; reason: string };

/** ISO string, epoch millis, Date, or anything with toDate() (a Firestore Timestamp). */
export function coerceDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof (value as { toDate?: unknown }).toDate === "function") d = (value as { toDate: () => Date }).toDate();
  else if (typeof value === "string" || typeof value === "number") d = new Date(value);
  else return null;
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * v1 transaction -> v2:
 *  - `date` ISO string -> Date (stored as Timestamp)
 *  - `accountId` and `embedding` dropped (and any other unknown field)
 *  - `tagIds` defaults to []
 *  - `createdAt` / `updatedAt` kept when present, otherwise derived from `date`
 * Documents that cannot be represented in v2 are reported, never guessed.
 */
export function transformTransaction(v1: Record<string, unknown>): TransformResult {
  const date = coerceDate(v1.date);
  if (!date) return { ok: false, reason: `invalid date: ${JSON.stringify(v1.date)}` };

  const amount = typeof v1.amount === "number" ? v1.amount : typeof v1.amount === "string" && v1.amount.trim() ? Number(v1.amount) : NaN;
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: `invalid amount: ${JSON.stringify(v1.amount)}` };

  if (v1.type !== "income" && v1.type !== "expense") return { ok: false, reason: `invalid type: ${JSON.stringify(v1.type)}` };
  if (typeof v1.homeId !== "string" || !v1.homeId) return { ok: false, reason: "missing homeId" };
  if (typeof v1.userId !== "string" || !v1.userId) return { ok: false, reason: "missing userId" };

  const createdAt = coerceDate(v1.createdAt) ?? date;
  const note = typeof v1.note === "string" ? v1.note.trim() : "";
  const doc: V2Transaction = {
    amount,
    categoryId: typeof v1.categoryId === "string" ? v1.categoryId : "",
    date,
    type: v1.type,
    userId: v1.userId,
    userEmail: typeof v1.userEmail === "string" ? v1.userEmail : "",
    homeId: v1.homeId,
    tagIds: Array.isArray(v1.tagIds) ? v1.tagIds.filter((t): t is string => typeof t === "string" && !!t) : [],
    createdAt,
    updatedAt: coerceDate(v1.updatedAt) ?? createdAt,
  };
  if (note) doc.note = note;
  return { ok: true, doc };
}

export interface HomeTotals {
  count: number;
  income: number;
  expense: number;
}

/** Per-home document count and income / expense sums (rounded to paise). */
export function summarizeByHome(
  docs: { homeId?: unknown; type?: unknown; amount?: unknown }[],
): Map<string, HomeTotals> {
  const out = new Map<string, HomeTotals>();
  for (const d of docs) {
    const homeId = typeof d.homeId === "string" && d.homeId ? d.homeId : "(no home)";
    const t = out.get(homeId) ?? { count: 0, income: 0, expense: 0 };
    const amount = Number(d.amount);
    t.count += 1;
    if (Number.isFinite(amount)) {
      if (d.type === "income") t.income += amount;
      else if (d.type === "expense") t.expense += amount;
    }
    out.set(homeId, t);
  }
  for (const t of out.values()) {
    t.income = Math.round(t.income * 100) / 100;
    t.expense = Math.round(t.expense * 100) / 100;
  }
  return out;
}

export function totalsEqual(a: HomeTotals | undefined, b: HomeTotals | undefined): boolean {
  if (!a || !b) return false;
  return a.count === b.count && Math.abs(a.income - b.income) < 0.005 && Math.abs(a.expense - b.expense) < 0.005;
}
