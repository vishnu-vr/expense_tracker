/**
 * Re-embed every transaction of a v2 project (after the migration, or after
 * changing EMBEDDING_MODEL). Idempotent: transactions whose embedding text and
 * model are unchanged are skipped.
 *
 * With a short-lived access token (no key files; see docs/wiki/migration-plan.md):
 *   BACKFILL_ACCESS_TOKEN=<token> GOOGLE_CLOUD_PROJECT=<v2 project> npm run backfill
 *
 * With a service account for the v2 project (Firestore + Vertex AI access):
 *   GOOGLE_APPLICATION_CREDENTIALS=./v2-sa.json GOOGLE_CLOUD_PROJECT=<v2 project> npm run backfill
 */
import { initializeApp } from "firebase-admin/app";
import { firestoreWithToken } from "./migrate-v1-to-v2";
import { getFirestore } from "firebase-admin/firestore";
import { embedText, useAccessTokenForVertex } from "../agent/models";
import { syncTransactionEmbedding } from "../handlers/transactions";

async function main(): Promise<void> {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const token = process.env.BACKFILL_ACCESS_TOKEN;
  if ((!process.env.GOOGLE_APPLICATION_CREDENTIALS && !token) || !project) {
    throw new Error(
      "Set GOOGLE_CLOUD_PROJECT for the v2 project and either BACKFILL_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS.",
    );
  }
  let db;
  if (token) {
    useAccessTokenForVertex(token, project);
    db = firestoreWithToken(project, token);
  } else {
    initializeApp({ projectId: project });
    db = getFirestore();
  }
  const counts: Record<string, number> = {};
  const snap = await db.collection("transactions").get();
  for (const doc of snap.docs) {
    try {
      const outcome = await syncTransactionEmbedding(
        db,
        { eventId: `backfill-${doc.id}`, transactionId: doc.id, before: null, after: doc.data() },
        (text) => embedText(text, "RETRIEVAL_DOCUMENT"),
      );
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch {
      counts.failed = (counts.failed ?? 0) + 1;
    }
  }
  console.log(`Processed ${snap.size} transactions:`, counts);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
