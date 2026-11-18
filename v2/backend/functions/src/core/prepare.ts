import { toLocalDay } from "./dates";
import { matchMerchant } from "./merchant";
import { LTx, Tx } from "./types";

/** Attach the local calendar day and matched merchant to raw transactions. */
export function prepareTransactions(transactions: Tx[], timeZone: string): LTx[] {
  return transactions
    .filter((t) => Number.isFinite(t.amount) && t.date instanceof Date && !Number.isNaN(t.date.getTime()))
    .map((t) => ({
      ...t,
      tagIds: t.tagIds ?? [],
      day: toLocalDay(t.date, timeZone),
      merchant: matchMerchant(t.note),
    }));
}
