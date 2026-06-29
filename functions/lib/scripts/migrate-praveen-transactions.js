"use strict";
/**
 * migrate-praveen-transactions.ts
 *
 * Migrates the `transactions` collection from Praveen's Firestore
 * into Vishnu's Firestore, adding homeId = 'praveen' to every document.
 *
 * HOW TO RUN:
 *   1. Place Praveen's Firebase service account JSON at:
 *        functions/service-account_praveen.json
 *   2. From the `functions/` directory, run:
 *        npx ts-node src/scripts/migrate-praveen-transactions.ts
 *
 * PRE-REQUISITES:
 *   - Praveen's service account must have Firestore read access on his project.
 *   - Vishnu's service account (service-account.json) must have Firestore
 *     read/write access on public-exp-tracker.
 */
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
const admin = __importStar(require("firebase-admin"));
const app_1 = require("firebase-admin/app");
const path = __importStar(require("path"));
// ─── Configuration ────────────────────────────────────────────────────────────
/** Path to Praveen's service account key (relative to functions/ dir) */
const PRAVEEN_SA_PATH = path.resolve(__dirname, "../../service-account_private.json");
/** Path to Vishnu's service account key */
const VISHNU_SA_PATH = path.resolve(__dirname, "../../service-account.json");
/** The homeId to stamp on every migrated transaction */
const HOME_ID = "tNb6OFW20pjIK7AbNLxj";
/** Firestore collection to migrate */
const COLLECTION = "transactions";
/** Batch size for Firestore writes (max 500) */
const BATCH_SIZE = 400;
// ─── Helpers ──────────────────────────────────────────────────────────────────
function initApp(name, credPath, projectId) {
    return admin.initializeApp({
        credential: admin.credential.cert(credPath),
        projectId,
    }, name);
}
// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    // Load Praveen's service account to get his project ID dynamically
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const praveenSA = require(PRAVEEN_SA_PATH);
    const praveenProjectId = praveenSA.project_id;
    console.log(`\n📦  Source project : ${praveenProjectId} (Praveen)`);
    console.log(`🎯  Target project : public-exp-tracker (Vishnu)`);
    console.log(`🏠  homeId to add  : ${HOME_ID}\n`);
    // Initialize two separate Firebase app instances
    const praveenApp = initApp("praveen", PRAVEEN_SA_PATH, praveenProjectId);
    const vishnuApp = initApp("vishnu", VISHNU_SA_PATH, "public-exp-tracker");
    const srcDb = admin.firestore(praveenApp);
    const destDb = admin.firestore(vishnuApp);
    // ── Step 1: Read all documents from Praveen's transactions collection ──
    console.log(`🔍  Reading '${COLLECTION}' collection from source…`);
    const snapshot = await srcDb.collection(COLLECTION).get();
    if (snapshot.empty) {
        console.log("✅  No documents found in source. Nothing to migrate.");
        process.exit(0);
    }
    console.log(`📄  Found ${snapshot.size} transaction(s) to migrate.\n`);
    // ── Step 2: Write in batches to Vishnu's Firestore ────────────────────
    const docs = snapshot.docs;
    let migratedCount = 0;
    let batchNumber = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        batchNumber++;
        const chunk = docs.slice(i, i + BATCH_SIZE);
        const batch = destDb.batch();
        for (const doc of chunk) {
            const sourceData = doc.data();
            // Safety check: warn if homeId already exists (shouldn't in old data)
            if (sourceData.homeId) {
                console.warn(`  ⚠️  Doc ${doc.id} already has homeId="${sourceData.homeId}" — overwriting with "${HOME_ID}"`);
            }
            const destRef = destDb.collection(COLLECTION).doc(doc.id);
            batch.set(destRef, Object.assign(Object.assign({}, sourceData), { homeId: HOME_ID }));
        }
        console.log(`  ✍️  Writing batch ${batchNumber} (${chunk.length} docs)…`);
        await batch.commit();
        migratedCount += chunk.length;
        console.log(`  ✅  Batch ${batchNumber} committed. Progress: ${migratedCount}/${docs.length}`);
    }
    console.log(`\n🎉  Migration complete! ${migratedCount} transaction(s) written to 'public-exp-tracker' with homeId="${HOME_ID}".`);
    // Clean up
    await (0, app_1.deleteApp)(praveenApp);
    await (0, app_1.deleteApp)(vishnuApp);
    process.exit(0);
}
main().catch((err) => {
    console.error("\n❌  Migration failed:", err);
    process.exit(1);
});
//# sourceMappingURL=migrate-praveen-transactions.js.map