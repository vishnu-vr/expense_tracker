/**
 * Track Expense v2 — Cloud Functions entry point.
 * Each export is a thin wrapper; the logic lives in `handlers/` (Firestore)
 * and `core/` (pure functions).
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { embedText, getAgentRuntime } from "./agent/models";
import { createModelPhraser } from "./agent/phraser";
import {
  agentModelId,
  billingDataset,
  billingLocation,
  billingProjectId,
  defaultTimeZone,
  enforceAppCheck,
  insightsPhrasingModelId,
  REGION,
} from "./config";
import { readAssistantUsage } from "./data/ai-usage";
import { defaultRestClient } from "./data/billing";
import { AdminDashboard, adminDashboardHandler } from "./handlers/admin-dashboard";
import { askAgentHandler, AskAgentChunk, AskAgentResult } from "./handlers/ask-agent";
import { confirmProposalHandler } from "./handlers/confirm-proposal";
import { exportTransactionsCsvHandler } from "./handlers/export-csv";
import { generateAllInsights } from "./handlers/insights";
import { joinHomeHandler } from "./handlers/join-home";
import { leaveHomeHandler } from "./handlers/leave-home";
import { sendNotificationPush } from "./handlers/notifications";
import { syncTransactionEmbedding, writeTransactionNotification } from "./handlers/transactions";

initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 10 });

const callable = { enforceAppCheck: enforceAppCheck() };

function requireUid(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  return request.auth.uid;
}

/** joinHome({displayId}) -> {id, name, displayId, ownerId, memberIds} */
export const joinHome = onCall(callable, (request) => joinHomeHandler(getFirestore(), requireUid(request), request.data));

/** leaveHome({}) -> {homeId, ownershipTransferredTo: string|null} */
export const leaveHome = onCall(callable, (request) => leaveHomeHandler(getFirestore(), requireUid(request)));

/** exportTransactionsCsv({from, to, timeZone}) -> {csv, filename, count} */
export const exportTransactionsCsv = onCall(callable, (request) =>
  exportTransactionsCsvHandler(getFirestore(), requireUid(request), request.data),
);

/**
 * askAgent({threadId?, message, timeZone}) -> {threadId, messageId, blocks}
 * Streams {type:'status', text} and {type:'text', delta} chunks.
 */
export const askAgent = onCall<unknown, Promise<AskAgentResult>, AskAgentChunk>(
  { ...callable, timeoutSeconds: 120, memory: "1GiB" },
  (request, response) =>
    askAgentHandler(
      {
        db: getFirestore(),
        runtime: () => getAgentRuntime(agentModelId()),
        embedQuery: (text) => embedText(text, "RETRIEVAL_QUERY"),
        onMetrics: (m) => logger.info("askAgent complete", { model: agentModelId(), ...m }),
      },
      requireUid(request),
      request.data,
      (chunk) => response?.sendChunk(chunk),
    ),
);

/** confirmProposal({threadId, proposalId, accept}) -> {proposalId, status, appliedCount, skippedTransactionIds} */
export const confirmProposal = onCall(callable, (request) =>
  confirmProposalHandler(getFirestore(), requireUid(request), request.data),
);

/**
 * getAdminDashboard({month: "YYYY-MM"}) -> {month, billing, usage, assistant} (see SCHEMA.md).
 * Admins only (custom claim admin: true). Reads the billing export, Cloud Monitoring
 * and the aiUsage rollup.
 */
let billingApi: ReturnType<typeof defaultRestClient> | null = null;
const dashboardCache = new Map<string, { at: number; value: AdminDashboard }>();
export const getAdminDashboard = onCall({ ...callable, timeoutSeconds: 60 }, (request) =>
  adminDashboardHandler(
    {
      api: (billingApi ??= defaultRestClient()),
      projectId: billingProjectId(),
      dataset: billingDataset(),
      location: billingLocation(),
      now: () => new Date(),
      cache: dashboardCache,
      readAssistantUsage: (month) => readAssistantUsage(getFirestore(), month),
      // Error names and HTTP status only.
      onError: (part, error) =>
        logger.error("Admin dashboard read failed", {
          part,
          name: (error as Error)?.name,
          status: (error as { status?: number })?.status,
        }),
    },
    request.auth ? { uid: request.auth.uid, token: request.auth.token as unknown as Record<string, unknown> } : undefined,
    request.data,
  ),
);

/** FCM push to the other household members when a notification doc is created. */
export const onNotificationCreated = onDocumentCreated("notifications/{notificationId}", async (event) => {
  if (!event.data) return;
  const result = await sendNotificationPush(getFirestore(), getMessaging(), event.params.notificationId, event.data.data());
  logger.info("Push send complete", { notificationId: event.params.notificationId, ...(result ?? { skipped: true }) });
});

/** On any transaction write: (a) household notification doc, (b) transactionEmbeddings upkeep. */
export const onTransactionWritten = onDocumentWritten({ document: "transactions/{txId}", memory: "512MiB" }, async (event) => {
  const write = {
    eventId: event.id,
    transactionId: event.params.txId,
    before: event.data?.before.exists ? (event.data.before.data() ?? null) : null,
    after: event.data?.after.exists ? (event.data.after.data() ?? null) : null,
  };
  const db = getFirestore();
  const [notification, embedding] = await Promise.allSettled([
    writeTransactionNotification(db, write),
    syncTransactionEmbedding(db, write, (text) => embedText(text, "RETRIEVAL_DOCUMENT")),
  ]);
  // Ids and outcomes only — never note text or amounts.
  logger.info("Transaction write processed", {
    transactionId: write.transactionId,
    notification: notification.status === "fulfilled" ? (notification.value ? "written" : "none") : "failed",
    embedding: embedding.status === "fulfilled" ? embedding.value : "failed",
  });
  if (notification.status === "rejected") logger.error("Notification write failed", { name: (notification.reason as Error)?.name });
  if (embedding.status === "rejected") logger.error("Embedding sync failed", { name: (embedding.reason as Error)?.name });
});

/** Daily proactive insight cards for every home. */
export const generateInsights = onSchedule(
  { schedule: "0 6 * * *", timeZone: defaultTimeZone(), timeoutSeconds: 540, memory: "1GiB" },
  async () => {
    const phrasingModel = insightsPhrasingModelId();
    const summary = await generateAllInsights(
      getFirestore(),
      defaultTimeZone(),
      new Date(),
      phrasingModel ? createModelPhraser(phrasingModel) : null,
      (homeId, error) => logger.error("Insights failed for home", { homeId, name: (error as Error)?.name }),
    );
    logger.info("Insights run complete", summary);
  },
);
