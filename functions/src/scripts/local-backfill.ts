import { initializeApp } from "firebase-admin/app";

// Set project ID explicitly for local execution
process.env.GCLOUD_PROJECT = "expense-tracker-e7ff7";
process.env.GOOGLE_CLOUD_PROJECT = "expense-tracker-e7ff7";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json";

// Initialize Admin SDK
initializeApp({
    projectId: "expense-tracker-e7ff7"
});

async function main() {
    console.log("Starting local backfill...");
    try {
        // Dynamic import to ensure env vars are set before Genkit initializes
        const { backfillEmbeddingsHandler } = await import("../backfill");

        const result = await backfillEmbeddingsHandler();
        console.log("Backfill complete:", result);
    } catch (error) {
        console.error("Backfill failed:", error);
        process.exit(1);
    }
}

main();
