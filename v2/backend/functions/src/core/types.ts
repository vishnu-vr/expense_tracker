/**
 * Plain data types used by every pure function in `core/`.
 * Nothing in `core/` imports Firebase or Genkit, so it is unit-testable as is.
 */

export type TxType = "income" | "expense";

/** A transaction as stored (date already converted to a JS Date). */
export interface Tx {
  id: string;
  amount: number;
  categoryId: string;
  date: Date;
  note?: string;
  type: TxType;
  userId: string;
  userEmail?: string;
  tagIds: string[];
}

/**
 * A transaction prepared for analysis: `day` is the calendar date in the
 * household's time zone (YYYY-MM-DD) and `merchant` the canonical merchant
 * matched from the note (or null).
 */
export interface LTx extends Tx {
  day: string;
  merchant: string | null;
}

export interface Category {
  id: string;
  name: string;
  type: TxType;
  icon?: string;
  color?: string;
}

export interface Budget {
  categoryId: string;
  amount: number;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Member {
  id: string;
  name: string;
  email?: string;
}

/** Everything the tools and detectors need about one household. */
export interface HomeData {
  transactions: LTx[];
  categories: Category[];
  budgets: Budget[];
  tags: Tag[];
  members: Member[];
}

/** Inclusive calendar-day range, both `YYYY-MM-DD`. */
export interface DayRange {
  from: string;
  to: string;
}
