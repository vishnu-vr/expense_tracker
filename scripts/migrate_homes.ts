import * as admin from 'firebase-admin';

// Initialize Firebase Admin
// Make sure to set GOOGLE_APPLICATION_CREDENTIALS or run with `firebase functions:shell` context if possible, 
// or use `ts-node` with proper admin credentials.
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Utils to generate a random 6-char display ID
function generateDisplayId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export async function migrateToMultiTenant() {
    console.log('Starting migration to multi-tenant architecture...');

    const usersSnapshot = await db.collection('users').get();

    if (usersSnapshot.empty) {
        console.log('No users found to migrate.');
        return;
    }

    console.log(`Found ${usersSnapshot.size} users. Processing...`);

    let migratedUsers = 0;
    let migratedTransactions = 0;

    for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id; // Using docId as userId (assuming they match, or userData.id)
        const uid = userData['id'] || userId; // Fallback to doc ID if 'id' field missing
        const userName = userData['name'] || 'User';

        let homeId = userData['homeId'];

        // 1. Create Home if not exists
        if (!homeId) {
            console.log(`Creating home for user ${userName} (${uid})...`);

            const newHomeRef = db.collection('homes').doc();
            homeId = newHomeRef.id;
            const displayId = generateDisplayId();

            await newHomeRef.set({
                name: `${userName}'s Home`,
                ownerId: uid,
                memberIds: [uid],
                displayId: displayId,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Update User with homeId
            await userDoc.ref.update({ homeId: homeId });
            console.log(`Created Home ${displayId} for user ${uid}`);
        } else {
            console.log(`User ${userName} already has home ${homeId}. Skipping home creation.`);
        }

        // 2. Migrate Transactions
        // Find all transactions created by this user that don't have a homeId
        const transactionsSnapshot = await db.collection('transactions')
            .where('userId', '==', uid)
            .get();

        const batch = db.batch();
        let batchCount = 0;

        for (const txnDoc of transactionsSnapshot.docs) {
            const txnData = txnDoc.data();
            if (!txnData['homeId']) {
                batch.update(txnDoc.ref, { homeId: homeId });
                batchCount++;
                migratedTransactions++;
            }
        }

        if (batchCount > 0) {
            await batch.commit();
            console.log(`Migrated ${batchCount} transactions for user ${uid}`);
        } else {
            console.log(`No transactions need migration for user ${uid}`);
        }

        migratedUsers++;
    }

    console.log('Migration complete!');
    console.log(`Users processed: ${migratedUsers}`);
    console.log(`Transactions migrated: ${migratedTransactions}`);
}

// Allow running directly if file is executed
if (require.main === module) {
    migrateToMultiTenant()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Migration failed:', err);
            process.exit(1);
        });
}
