"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillEmbeddingsHandler = void 0;
// import * as logger from "firebase-functions/logger";
const firestore_1 = require("firebase-admin/firestore");
const google_genai_1 = require("@genkit-ai/google-genai");
const genkit_1 = require("./genkit");
const backfillEmbeddingsHandler = async () => {
    const firestore = (0, firestore_1.getFirestore)();
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
            const embedding = await genkit_1.ai.embed({
                embedder: google_genai_1.vertexAI.embedder('text-embedding-004'),
                content: textToEmbed,
            });
            await doc.ref.update({
                embedding: firestore_1.FieldValue.vector(embedding[0].embedding),
            });
            processedCount++;
            console.log(`Backfilled embedding for ${doc.id}`);
        }
        catch (error) {
            console.error(`Error backfilling ${doc.id}`, error);
        }
    }
    return { success: true, processed: processedCount };
};
exports.backfillEmbeddingsHandler = backfillEmbeddingsHandler;
//# sourceMappingURL=backfill.js.map