/**
 * Re-embed every transaction of a v2 project (after the migration, or after
 * changing EMBEDDING_MODEL). Needs a service account for the TARGET project
 * with Firestore + Vertex AI access:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./v2-sa.json GOOGLE_CLOUD_PROJECT=<v2 project> \
 *     npx tsx src/scripts/backfill-embeddings.ts
 *
 * Idempotent: transactions whose embedding text and model are unchanged are skipped.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { embedText } from "../agent/models";
import { syncTransactionEmbedding } from "../handlers/transactions";

async function main(): Promise<void> {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS || !project) {
    throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT for the v2 project.");
  }
  initializeApp({ projectId: project });
  const db = getFirestore();
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
