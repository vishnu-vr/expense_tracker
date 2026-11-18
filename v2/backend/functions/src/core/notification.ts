import { formatINR } from "./money";

export type NotificationType = "transaction_added" | "transaction_updated" | "transaction_deleted";

export interface TxSnapshot {
  amount?: unknown;
  categoryId?: unknown;
  note?: unknown;
  type?: unknown;
  userId?: unknown;
  userEmail?: unknown;
  homeId?: unknown;
  tagIds?: unknown;
  /** Milliseconds since epoch of the `date` Timestamp. */
  dateMs?: number | null;
  /** Milliseconds since epoch of `createdAt`, when present. */
  createdAtMs?: number | null;
}

/**
 * A newly created doc whose `createdAt` is older than this is treated as an
 * import (data migration, restore) and produces no notification / push.
 */
export const IMPORT_AGE_MS = 24 * 60 * 60 * 1000;

export interface NotificationDraft {
  type: NotificationType;
  message: string;
  homeId: string;
  createdBy: string;
}

const FIELDS: (keyof TxSnapshot)[] = ["amount", "categoryId", "note", "type", "dateMs"];

/** True when a user-visible field differs (ignores updatedAt and other bookkeeping). */
export function hasMeaningfulChange(before: TxSnapshot, after: TxSnapshot): boolean {
  for (const f of FIELDS) {
    if ((before[f] ?? null) !== (after[f] ?? null)) return true;
  }
  const tags = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort().join("\u0000") : "");
  return tags(before.tagIds) !== tags(after.tagIds);
}

/**
 * Decide which household notification (if any) a transaction write produces.
 * Wording follows the v1 client. Returns null when nothing should be sent.
 */
export function buildTransactionNotification(
  before: TxSnapshot | null,
  after: TxSnapshot | null,
  userName: string,
  nowMs: number = Date.now(),
): NotificationDraft | null {
  const doc = after ?? before;
  if (!doc) return null;
  const homeId = typeof doc.homeId === "string" ? doc.homeId : "";
  const createdBy = typeof doc.userId === "string" ? doc.userId : "";
  if (!homeId || !createdBy) return null;

  const amount = typeof doc.amount === "number" && Number.isFinite(doc.amount) ? doc.amount : 0;
  const note = typeof doc.note === "string" && doc.note.trim() ? doc.note.trim() : "No note";
  const typeLabel = doc.type === "income" ? "income" : "expense";

  if (!before && after) {
    if (typeof after.createdAtMs === "number" && nowMs - after.createdAtMs > IMPORT_AGE_MS) return null;
    return {
      type: "transaction_added",
      message: `${userName} added a new ${typeLabel} of ${formatINR(amount)}`,
      homeId,
      createdBy,
    };
  }
  if (before && !after) {
    return {
      type: "transaction_deleted",
      message: `${userName} deleted a transaction: ${note} - ${formatINR(amount)}`,
      homeId,
      createdBy,
    };
  }
  if (before && after) {
    if (!hasMeaningfulChange(before, after)) return null;
    return {
      type: "transaction_updated",
      message: `${userName} updated a transaction: ${note} - ${formatINR(amount)}`,
      homeId,
      createdBy,
    };
  }
  return null;
}
