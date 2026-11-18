import { formatDateTime } from "./dates";

export function csvEscape(value: unknown): string {
  const normalized = value == null ? "" : String(value);
  if (/[",\n\r]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`;
  return normalized;
}

export interface CsvTx {
  amount?: number;
  categoryId?: string;
  date?: Date;
  note?: string;
  type?: string;
  userId?: string;
  userEmail?: string;
  tagIds?: string[];
}

export const CSV_HEADER = "Date,Type,Amount,Category,Note,Tags,User,Email";

/** Same columns as the v1 export. */
export function buildTransactionsCsv(
  transactions: CsvTx[],
  lookups: {
    categoryName: (id: string) => string;
    userName: (id: string) => string;
    tagName: (id: string) => string;
  },
  timeZone: string,
): string {
  const lines = [CSV_HEADER];
  for (const tx of transactions) {
    lines.push(
      [
        tx.date ? formatDateTime(tx.date, timeZone) : "",
        tx.type ?? "",
        typeof tx.amount === "number" ? tx.amount.toString() : "",
        tx.categoryId ? lookups.categoryName(tx.categoryId) : "",
        tx.note ?? "",
        (tx.tagIds ?? []).map(lookups.tagName).join("; "),
        tx.userId ? lookups.userName(tx.userId) : "",
        tx.userEmail ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
