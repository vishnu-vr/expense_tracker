"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("firebase-admin/app");
// Set project ID explicitly for local execution
process.env.GCLOUD_PROJECT = "expense-tracker-e7ff7";
process.env.GOOGLE_CLOUD_PROJECT = "expense-tracker-e7ff7";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "./service-account.json";
// Initialize Admin SDK
(0, app_1.initializeApp)({
    projectId: "expense-tracker-e7ff7"
});
async function main() {
    console.log("Starting local backfill...");
    try {
        // Dynamic import to ensure env vars are set before Genkit initializes
        const { backfillEmbeddingsHandler } = await Promise.resolve().then(() => __importStar(require("../backfill")));
        const result = await backfillEmbeddingsHandler();
        console.log("Backfill complete:", result);
    }
    catch (error) {
        console.error("Backfill failed:", error);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=local-backfill.js.map