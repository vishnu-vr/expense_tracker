/**
 * update-home-transactions-userid-email.ts
 *
 * For all documents in `transactions` where homeId == HOME_ID:
 *   - If userId == OLD_USER_ID_SHRUTI → set userId = NEW_USER_ID_SHRUTI
 *   - If userId == OLD_USER_ID_VISHNU → set userId = NEW_USER_ID_VISHNU
 *   - If userEmail is missing (undefined / null / empty string) and userId is
 *     one of the two new IDs above, set userEmail to the mapped address.
 *
 * HOW TO RUN:
 *   From the `functions/` directory, run:
 *     npx ts-node src/scripts/update-home-transactions-userid-email.ts
 *
 * PRE-REQUISITES:
 *   - service-account.json must have Firestore read/write access
 *     on the target project.
 */

import * as admin from "firebase-admin";
import { Firestore, DocumentData, DocumentReference } from "firebase-admin/firestore";
import * as path from "path";

// ─── Configuration ────────────────────────────────────────────────────────────

const SA_PATH = path.resolve(__dirname, "../../service-account.json");
const PROJECT_ID = "public-exp-tracker";
const COLLECTION = "transactions";

const HOME_ID = "tNb6OFW20pjIK7AbNLxj";

const OLD_USER_ID_SHRUTI = "JFXxEoz7H9fO6Psv4rf53sUJq4P2";
const NEW_USER_ID_SHRUTI = "YKdvNQKWeTe7zZgdkWcdCgDnQvL2";
const EMAIL_SHRUTI = "shrutimnair243@gmail.com";

const OLD_USER_ID_VISHNU = "7rboCmiX6JREUIha6A3DWKm9gN42";
const NEW_USER_ID_VISHNU = "ijky4NovT9Q6rQTGxnCVLgXtXtO2";
const EMAIL_VISHNU = "vishnuramesh19@gmail.com";

const EMAIL_BY_USER_ID: Record<string, string> = {
    [NEW_USER_ID_SHRUTI]: EMAIL_SHRUTI,
    [NEW_USER_ID_VISHNU]: EMAIL_VISHNU,
};

/** Firestore batch write limit */
const BATCH_SIZE = 400;

function isUserEmailMissing(data: DocumentData): boolean {
    const v = data["userEmail"];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function buildUpdates(data: DocumentData): Record<string, string> | null {
    const updates: Record<string, string> = {};

    let effectiveUserId = data["userId"] as string | undefined;

    if (effectiveUserId === OLD_USER_ID_SHRUTI) {
        updates.userId = NEW_USER_ID_SHRUTI;
        effectiveUserId = NEW_USER_ID_SHRUTI;
    } else if (effectiveUserId === OLD_USER_ID_VISHNU) {
        updates.userId = NEW_USER_ID_VISHNU;
        effectiveUserId = NEW_USER_ID_VISHNU;
    }

    const emailForUser = effectiveUserId ? EMAIL_BY_USER_ID[effectiveUserId] : undefined;
    if (emailForUser && isUserEmailMissing(data)) {
        updates.userEmail = emailForUser;
    }

    return Object.keys(updates).length > 0 ? updates : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n🔧  Project   : ${PROJECT_ID}`);
    console.log(`🏠  homeId    : ${HOME_ID}`);
    console.log(`🔄  ${OLD_USER_ID_SHRUTI} → ${NEW_USER_ID_SHRUTI} (+ email if missing: ${EMAIL_SHRUTI})`);
    console.log(`🔄  ${OLD_USER_ID_VISHNU} → ${NEW_USER_ID_VISHNU} (+ email if missing: ${EMAIL_VISHNU})\n`);

    admin.initializeApp({
        credential: admin.credential.cert(SA_PATH),
        projectId: PROJECT_ID,
    });

    const db: Firestore = admin.firestore();

    console.log(`🔍  Querying '${COLLECTION}' where homeId == '${HOME_ID}'…`);
    const snapshot = await db.collection(COLLECTION).where("homeId", "==", HOME_ID).get();

    if (snapshot.empty) {
        console.log("✅  No documents for this home. Nothing to do.");
        process.exit(0);
    }

    const toUpdate: { ref: DocumentReference; updates: Record<string, string> }[] = [];

    for (const docSnap of snapshot.docs) {
        const updates = buildUpdates(docSnap.data());
        if (updates) {
            toUpdate.push({ ref: docSnap.ref, updates });
        }
    }

    if (toUpdate.length === 0) {
        console.log(`📄  Scanned ${snapshot.size} document(s); none needed updates.`);
        process.exit(0);
    }

    console.log(`📄  Scanned ${snapshot.size} document(s); ${toUpdate.length} to update.\n`);

    let updatedCount = 0;
    let batchNumber = 0;

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        batchNumber++;
        const chunk = toUpdate.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const { ref, updates } of chunk) {
            batch.update(ref, updates);
        }

        console.log(`  ✍️  Writing batch ${batchNumber} (${chunk.length} docs)…`);
        await batch.commit();
        updatedCount += chunk.length;
        console.log(`  ✅  Batch ${batchNumber} committed. Progress: ${updatedCount}/${toUpdate.length}`);
    }

    console.log(`\n🎉  Done! ${updatedCount} transaction(s) updated.`);
    process.exit(0);
}

main().catch((err) => {
    console.error("\n❌  Update failed:", err);
    process.exit(1);
});
