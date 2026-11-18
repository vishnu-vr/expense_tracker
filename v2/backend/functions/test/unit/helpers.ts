import { mergeCategories } from "../../src/core/categories";
import { prepareTransactions } from "../../src/core/prepare";
import { Budget, HomeData, Tx, TxType } from "../../src/core/types";

export const TZ = "Asia/Kolkata";
let seq = 0;

/** A transaction at local noon (IST) on `day`. */
export function tx(
  day: string,
  amount: number,
  categoryId: string,
  note?: string,
  extra: Partial<Tx> & { type?: TxType } = {},
): Tx {
  const [y, m, d] = day.split("-").map(Number);
  seq += 1;
  return {
    id: extra.id ?? `t${seq}`,
    amount,
    categoryId,
    date: new Date(Date.UTC(y, m - 1, d, 6, 30)),
    note,
    type: extra.type ?? "expense",
    userId: extra.userId ?? "u1",
    userEmail: extra.userEmail,
    tagIds: extra.tagIds ?? [],
  };
}

export function home(transactions: Tx[], budgets: Budget[] = []): HomeData {
  return {
    transactions: prepareTransactions(transactions, TZ),
    categories: mergeCategories([]),
    budgets,
    tags: [{ id: "trip", name: "Trip" }],
    members: [
      { id: "u1", name: "Asha" },
      { id: "u2", name: "Vikram" },
    ],
  };
}
