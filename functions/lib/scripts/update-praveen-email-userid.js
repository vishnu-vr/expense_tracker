"use strict";
/**
 * update-praveen-email-userid.ts
 *
 * Finds all documents in the `transactions` collection where
 *   userEmail = 'sankar_praveen@hotmail.com'
 *   userId    = 'pmxbksZT69Zi7uYfidXhxxe9UVz2'
 * and updates them to:
 *   userEmail = 'praveensankar.appu@gmail.com'
 *   userId    = 'kPBk3AcAkvQ7TNYjQEDQ5AugS9j1'
 *
 * HOW TO RUN:
 *   From the `functions/` directory, run:
 *     npx ts-node src/scripts/update-praveen-email-userid.ts
 *
 * PRE-REQUISITES:
 *   - service-account.json must have Firestore read/write access
 *     on the `public-exp-tracker` project.
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
const path = __importStar(require("path"));
// ─── Configuration ────────────────────────────────────────────────────────────
const SA_PATH = path.resolve(__dirname, "../../service-account.json");
const PROJECT_ID = "public-exp-tracker";
const COLLECTION = "transactions";
const MATCH_EMAIL = "shrutimnair243@gmail.com";
const MATCH_USER_ID = "JFXxEoz7H9fO6Psv4rf53sUJq4P2";
const NEW_EMAIL = "shrutimnair243@gmail.com";
const NEW_USER_ID = "YKdvNQKWeTe7zZgdkWcdCgDnQvL2";
/** Firestore batch write limit */
const BATCH_SIZE = 400;
// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n🔧  Project       : ${PROJECT_ID}`);
    console.log(`🔍  Match email   : ${MATCH_EMAIL}`);
    console.log(`🔍  Match userId  : ${MATCH_USER_ID}`);
    console.log(`📧  New email     : ${NEW_EMAIL}`);
    console.log(`🆔  New userId    : ${NEW_USER_ID}\n`);
    admin.initializeApp({
        credential: admin.credential.cert(SA_PATH),
        projectId: PROJECT_ID,
    });
    const db = admin.firestore();
    // ── Step 1: Query by userEmail first, then filter by userId in-memory ──
    // (Firestore requires a composite index for multi-field equality queries;
    //  filtering the smaller result set in-memory avoids that requirement.)
    console.log(`🔍  Querying '${COLLECTION}' where userEmail = '${MATCH_EMAIL}'…`);
    const snapshot = await db
        .collection(COLLECTION)
        .where("userEmail", "==", MATCH_EMAIL)
        .where("userId", "==", MATCH_USER_ID)
        .get();
    if (snapshot.empty) {
        console.log("✅  No matching documents found. Nothing to update.");
        process.exit(0);
    }
    console.log(`📄  Found ${snapshot.size} matching transaction(s).\n`);
    // ── Step 2: Update in batches ──────────────────────────────────────────
    const docs = snapshot.docs;
    let updatedCount = 0;
    let batchNumber = 0;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        batchNumber++;
        const chunk = docs.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        for (const doc of chunk) {
            batch.update(doc.ref, {
                userEmail: NEW_EMAIL,
                userId: NEW_USER_ID,
            });
        }
        console.log(`  ✍️  Writing batch ${batchNumber} (${chunk.length} docs)…`);
        await batch.commit();
        updatedCount += chunk.length;
        console.log(`  ✅  Batch ${batchNumber} committed. Progress: ${updatedCount}/${docs.length}`);
    }
    console.log(`\n🎉  Done! ${updatedCount} transaction(s) updated.`);
    console.log(`    userEmail → '${NEW_EMAIL}'`);
    console.log(`    userId    → '${NEW_USER_ID}'`);
    process.exit(0);
}
main().catch((err) => {
    console.error("\n❌  Update failed:", err);
    process.exit(1);
});
//# sourceMappingURL=update-praveen-email-userid.js.map