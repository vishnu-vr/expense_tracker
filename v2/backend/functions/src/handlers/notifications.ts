import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";

export interface PushResult {
  recipientCount: number;
  tokenCount: number;
  successCount: number;
  failureCount: number;
  staleTokenDeleteCount: number;
}

const STALE_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

/**
 * Send the FCM push for a new household notification to every other member's
 * devices, and delete tokens FCM reports as dead.
 */
export async function sendNotificationPush(
  db: Firestore,
  messaging: Pick<Messaging, "sendEach">,
  notificationId: string,
  data: Record<string, unknown>,
): Promise<PushResult | null> {
  const homeId = typeof data.homeId === "string" ? data.homeId : "";
  const createdBy = typeof data.createdBy === "string" ? data.createdBy : "";
  if (!homeId || !createdBy) return null;

  const homeSnap = await db.collection("homes").doc(homeId).get();
  if (!homeSnap.exists) return null;
  const memberIds = ((homeSnap.data()?.memberIds ?? []) as unknown[]).map(String);
  // A notification for one member (a report is ready, D-033) goes only to them.
  const recipientId = typeof data.recipientId === "string" ? data.recipientId : "";
  const recipients = recipientId
    ? memberIds.filter((uid) => uid === recipientId)
    : memberIds.filter((uid) => uid && uid !== createdBy);
  const empty = { recipientCount: recipients.length, tokenCount: 0, successCount: 0, failureCount: 0, staleTokenDeleteCount: 0 };
  if (recipients.length === 0) return empty;

  const targets: { token: string; ref: DocumentReference }[] = [];
  await Promise.all(
    recipients.map(async (uid) => {
      const tokens = await db.collection("users").doc(uid).collection("fcmTokens").get();
      for (const doc of tokens.docs) {
        const token = (doc.data().token as string | undefined) || doc.id;
        if (token) targets.push({ token, ref: doc.ref });
      }
    }),
  );
  if (targets.length === 0) return empty;

  const type = typeof data.type === "string" ? data.type : "notification";
  const transactionId = typeof data.transactionId === "string" ? data.transactionId : "";
  const reportId = typeof data.reportId === "string" ? data.reportId : "";
  const route = reportId
    ? `/reports/${reportId}`
    : transactionId && type !== "transaction_deleted"
      ? `/edit-transaction/${transactionId}`
      : "/dashboard";
  const body = typeof data.message === "string" && data.message ? data.message : "New activity in your home";
  const title = typeof data.title === "string" && data.title ? data.title : "Track Expense";

  const response = await messaging.sendEach(
    targets.map((t) => ({
      token: t.token,
      notification: { title, body },
      data: { notificationId, type, transactionId, reportId, route, homeId },
    })),
  );

  const stale: Promise<unknown>[] = [];
  response.responses.forEach((r, i) => {
    if (!r.success && r.error && STALE_CODES.has(r.error.code)) stale.push(targets[i].ref.delete());
  });
  await Promise.all(stale);

  return {
    recipientCount: recipients.length,
    tokenCount: targets.length,
    successCount: response.successCount,
    failureCount: response.failureCount,
    staleTokenDeleteCount: stale.length,
  };
}
