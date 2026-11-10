import { FieldValue, Firestore } from "firebase-admin/firestore";
import { DEFAULT_CATEGORIES } from "../core/categories";
import { buildEmbeddingText } from "../core/embedding-text";
import { buildTransactionNotification, TxSnapshot } from "../core/notification";
import { EMBEDDING_MODEL } from "../config";
import { toDate } from "../data/home";

export type DocEmbedder = (text: string) => Promise<number[]>;

export interface TransactionWrite {
  /** Unique id of the trigger event; makes the notification write idempotent on retries. */
  eventId: string;
  transactionId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function snapshot(d: Record<string, unknown> | null): TxSnapshot | null {
  if (!d) return null;
  return {
    amount: d.amount,
    categoryId: d.categoryId,
    note: d.note,
    type: d.type,
    userId: d.userId,
    userEmail: d.userEmail,
    homeId: d.homeId,
    tagIds: d.tagIds,
    dateMs: toDate(d.date)?.getTime() ?? null,
    createdAtMs: toDate(d.createdAt)?.getTime() ?? null,
  };
}

/** (a) Write the household notification doc for a transaction create / update / delete. */
export async function writeTransactionNotification(db: Firestore, w: TransactionWrite): Promise<string | null> {
  const before = snapshot(w.before);
  const after = snapshot(w.after);
  const doc = after ?? before;
  const userId = typeof doc?.userId === "string" ? doc.userId : "";
  if (!userId) return null;

  const userSnap = await db.collection("users").doc(userId).get();
  const userName =
    (userSnap.data()?.name as string | undefined) ||
    (userSnap.data()?.email as string | undefined) ||
    (typeof doc?.userEmail === "string" ? doc.userEmail : "") ||
    "Someone";

  const draft = buildTransactionNotification(before, after, userName);
  if (!draft) return null;

  const ref = db.collection("notifications").doc(`tx_${w.eventId}`);
  try {
    await ref.create({
      type: draft.type,
      message: draft.message,
      transactionId: w.transactionId,
      homeId: draft.homeId,
      createdBy: draft.createdBy,
      createdByName: userName,
      createdAt: FieldValue.serverTimestamp(),
      readBy: [],
    });
  } catch (e) {
    // ALREADY_EXISTS: the event was delivered twice.
    if ((e as { code?: number }).code !== 6) throw e;
  }
  return ref.id;
}

export type EmbeddingOutcome = "deleted" | "unchanged" | "written" | "skipped";

/**
 * (b) Keep `transactionEmbeddings/{txId}` in step with the transaction.
 * Embedded text is "<note> | <category name> | <merchant> | <tag names>";
 * amount, date and type are never embedded. Entries without a note have no
 * embedding (there is nothing to search).
 */
export async function syncTransactionEmbedding(
  db: Firestore,
  w: TransactionWrite,
  embed: DocEmbedder,
): Promise<EmbeddingOutcome> {
  const ref = db.collection("transactionEmbeddings").doc(w.transactionId);
  const after = w.after;
  if (!after) {
    await ref.delete();
    return "deleted";
  }
  const homeId = typeof after.homeId === "string" ? after.homeId : "";
  if (!homeId) return "skipped";

  const b = w.before;
  if (
    b &&
    b.note === after.note &&
    b.categoryId === after.categoryId &&
    b.homeId === after.homeId &&
    JSON.stringify(b.tagIds ?? []) === JSON.stringify(after.tagIds ?? [])
  ) {
    return "unchanged";
  }

  const note = typeof after.note === "string" ? after.note : "";
  const categoryId = typeof after.categoryId === "string" ? after.categoryId : "";
  const tagIds = Array.isArray(after.tagIds) ? after.tagIds.map(String).slice(0, 30) : [];
  if (!note.trim()) {
    await ref.delete();
    return "deleted";
  }

  const homeRef = db.collection("homes").doc(homeId);
  const [catSnap, ...tagSnaps] = await Promise.all([
    categoryId ? homeRef.collection("categories").doc(categoryId).get() : Promise.resolve(null),
    ...tagIds.map((id) => homeRef.collection("tags").doc(id).get()),
  ]);
  const categoryName =
    (catSnap?.data()?.name as string | undefined) ||
    DEFAULT_CATEGORIES.find((c) => c.id === categoryId)?.name ||
    categoryId;
  const tagNames = tagSnaps.map((s) => (s?.data()?.name as string | undefined) ?? "").filter(Boolean);

  const text = buildEmbeddingText({ note, categoryName, tagNames });
  if (!text) {
    await ref.delete();
    return "deleted";
  }

  const existing = await ref.get();
  if (existing.exists && existing.get("text") === text && existing.get("model") === EMBEDDING_MODEL && existing.get("homeId") === homeId) {
    return "unchanged";
  }

  const vector = await embed(text);
  await ref.set({
    homeId,
    vector: FieldValue.vector(vector),
    text,
    model: EMBEDDING_MODEL,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return "written";
}
