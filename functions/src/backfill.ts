// import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { vertexAI } from "@genkit-ai/google-genai";
import { ai } from "./genkit";

export const backfillEmbeddingsHandler = async () => {
    const firestore = getFirestore();
    const collection = firestore.collection("transactions");

    // Get all transactions without embeddings
    // Note: 'embedding' equality check might not be efficient or possible depending on index,
    // so we iterate all and check. For large datasets, use cursor/pagination.
    const snapshot = await collection.get();

    let processedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();

        // Skip if already has embedding
        // Note: Check if field valid vector or array
        if (data.embedding) {
            continue;
        }

        const { note, amount, categoryId } = data;

        // Skip if not enough info
        if (!note && !amount) {
            continue;
        }

        try {
            const textToEmbed = `${note || ''} ${categoryId || ''} ${amount || ''}`;
            const embedding = await ai.embed({
                embedder: vertexAI.embedder('text-embedding-004'),
                content: textToEmbed,
            });

            await doc.ref.update({
                embedding: FieldValue.vector(embedding[0].embedding),
            });

            processedCount++;
            console.log(`Backfilled embedding for ${doc.id}`);

        } catch (error) {
            console.error(`Error backfilling ${doc.id}`, error);
        }
    }

    return { success: true, processed: processedCount };
};
