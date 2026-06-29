"use strict";
/**
 * Import function triggers from their respective submodules:
 *
 * import { onCall, HttpsError } from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
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
exports.joinHome = exports.analyzeTransactions = exports.analyzeTransactionsHandler = exports.onTransactionWritten = exports.onNotificationCreated = void 0;
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const genkit_1 = require("genkit");
const google_genai_1 = require("@genkit-ai/google-genai");
const firestore_1 = require("firebase-admin/firestore");
const app_1 = require("firebase-admin/app");
const messaging_1 = require("firebase-admin/messaging");
const auth_1 = require("firebase-admin/auth");
const firestore_2 = require("firebase-functions/v2/firestore");
const genkit_2 = require("./genkit");
(0, app_1.initializeApp)();
exports.onNotificationCreated = (0, firestore_2.onDocumentCreated)("notifications/{notificationId}", async (event) => {
    var _a;
    if (!event.data)
        return;
    const notificationId = event.params.notificationId;
    const data = event.data.data();
    const homeId = data["homeId"];
    const createdBy = data["createdBy"];
    const message = data["message"];
    const type = data["type"];
    const transactionId = data["transactionId"];
    if (!homeId || !createdBy) {
        logger.warn("Skipping push send: missing homeId or createdBy", { notificationId });
        return;
    }
    const firestore = (0, firestore_1.getFirestore)();
    const homeSnap = await firestore.collection("homes").doc(homeId).get();
    if (!homeSnap.exists) {
        logger.warn("Skipping push send: home not found", { notificationId, homeId });
        return;
    }
    const memberIds = (((_a = homeSnap.data()) === null || _a === void 0 ? void 0 : _a["memberIds"]) || []);
    const recipientIds = memberIds.filter((uid) => uid && uid !== createdBy);
    if (recipientIds.length === 0) {
        logger.info("No recipients for push notification", { notificationId, homeId });
        return;
    }
    const tokenTargets = [];
    await Promise.all(recipientIds.map(async (uid) => {
        const tokenSnap = await firestore.collection("users").doc(uid).collection("fcmTokens").get();
        tokenSnap.docs.forEach((docSnap) => {
            var _a;
            const token = (_a = docSnap.data()) === null || _a === void 0 ? void 0 : _a["token"];
            if (token) {
                tokenTargets.push({ token, tokenRef: docSnap.ref });
            }
        });
    }));
    if (tokenTargets.length === 0) {
        logger.info("No device tokens found for notification recipients", { notificationId, homeId });
        return;
    }
    const route = transactionId ? `/edit-transaction/${transactionId}` : "/dashboard";
    const response = await (0, messaging_1.getMessaging)().sendEach(tokenTargets.map((target) => ({
        token: target.token,
        notification: {
            title: "Track Expense",
            body: message || "New activity in your home",
        },
        data: {
            notificationId: notificationId,
            type: type || "notification",
            transactionId: transactionId || "",
            route,
            homeId,
        },
    })));
    const staleTokenDeletes = [];
    response.responses.forEach((result, index) => {
        var _a;
        if (result.success)
            return;
        const code = (_a = result.error) === null || _a === void 0 ? void 0 : _a.code;
        if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
            staleTokenDeletes.push(tokenTargets[index].tokenRef.delete());
        }
    });
    if (staleTokenDeletes.length > 0) {
        await Promise.all(staleTokenDeletes);
    }
    logger.info("Push send complete", {
        notificationId,
        recipientCount: recipientIds.length,
        tokenCount: tokenTargets.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        staleTokenDeleteCount: staleTokenDeletes.length,
    });
});
exports.onTransactionWritten = (0, firestore_2.onDocumentWritten)("transactions/{docId}", async (event) => {
    var _a;
    // If the document does not exist, it was deleted
    if (!((_a = event.data) === null || _a === void 0 ? void 0 : _a.after.exists)) {
        return;
    }
    const snapshot = event.data.after;
    const previousSnapshot = event.data.before;
    const data = snapshot.data();
    const previousData = previousSnapshot.data();
    // Skip if no data
    if (!data)
        return;
    // Check if this is an update to the embedding itself to prevent infinite loops
    // If only embedding changed, exit.
    if (previousData) {
        const embeddingChanged = JSON.stringify(data['embedding']) !== JSON.stringify(previousData['embedding']);
        const otherFieldsChanged = data['note'] !== previousData['note'] ||
            data['amount'] !== previousData['amount'] ||
            data['categoryId'] !== previousData['categoryId'];
        if (embeddingChanged && !otherFieldsChanged) {
            return;
        }
    }
    const { note, amount, categoryId } = data;
    // 1. Manage Embeddings
    // Logic: If note, amount, or categoryId changed (or it's a new doc with these), generate embedding.
    const shouldGenerateEmbedding = !previousData ||
        (data['note'] !== previousData['note'] ||
            data['amount'] !== previousData['amount'] ||
            data['categoryId'] !== previousData['categoryId']);
    if (shouldGenerateEmbedding && (note || amount)) {
        try {
            const textToEmbed = `${note || ''} ${categoryId || ''} ${amount || ''}`;
            const embedding = await genkit_2.ai.embed({
                embedder: google_genai_1.vertexAI.embedder('text-embedding-004'),
                content: textToEmbed,
            });
            await snapshot.ref.update({
                embedding: firestore_1.FieldValue.vector(embedding[0].embedding),
            });
            logger.info(`Processed transaction ${event.params.docId}: Updated embedding.`);
        }
        catch (error) {
            logger.error("Error generating embedding", error);
        }
    }
    // 2. Notifications on Update
    // MOVED TO CLIENT SIDE as per user request
    // The client (TransactionService) is responsible for creating notifications for updates.
});
// Define the schema for the flow input
const TransactionQuerySchema = genkit_1.z.object({
    question: genkit_1.z.string(),
    homeId: genkit_1.z.string(),
    timeZone: genkit_1.z.string().optional(),
});
const DateRangeExtractionSchema = genkit_1.z.object({
    hasDateRange: genkit_1.z.boolean(),
    start: genkit_1.z.string().nullable(),
    end: genkit_1.z.string().nullable(),
    reasoning: genkit_1.z.string().optional(),
});
function formatDateInTimeZone(date, timeZone) {
    var _a, _b, _c, _d, _e, _f;
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const year = (_b = (_a = parts.find((p) => p.type === "year")) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : "0000";
    const month = (_d = (_c = parts.find((p) => p.type === "month")) === null || _c === void 0 ? void 0 : _c.value) !== null && _d !== void 0 ? _d : "01";
    const day = (_f = (_e = parts.find((p) => p.type === "day")) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : "01";
    return `${year}-${month}-${day}`;
}
function toDate(value) {
    if (!value)
        return null;
    if (value.toDate) {
        const timestampDate = value.toDate();
        return Number.isNaN(timestampDate.getTime()) ? null : timestampDate;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
// Helper to format date for display
function formatDate(dateValue, timeZone) {
    if (!dateValue)
        return 'Unknown';
    const date = toDate(dateValue);
    if (!date)
        return String(dateValue);
    return formatDateInTimeZone(date, timeZone);
}
function getTimeZoneOffsetMs(date, timeZone) {
    const timeZoneDate = new Date(date.toLocaleString("en-US", { timeZone }));
    return timeZoneDate.getTime() - date.getTime();
}
// Fetch transactions for a specific time period, scoped by homeId
async function getTransactionsForPeriod(startDate, endDate, homeId) {
    const firestore = (0, firestore_1.getFirestore)();
    const snapshot = await firestore
        .collection("transactions")
        .where("homeId", "==", homeId)
        .where("date", ">=", startDate.toISOString())
        .where("date", "<=", endDate.toISOString())
        .orderBy("date", "desc")
        .get();
    return snapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
}
function formatCurrencyINR(value) {
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function summarizeTransactions(transactions) {
    if (!transactions || transactions.length === 0) {
        return "No transactions found for this period.";
    }
    let totalExpense = 0;
    let totalIncome = 0;
    let expenseCount = 0;
    let incomeCount = 0;
    const expenseByCategory = new Map();
    const incomeByCategory = new Map();
    for (const tx of transactions) {
        const amount = Number(tx.amount);
        if (!Number.isFinite(amount))
            continue;
        const category = tx.categoryId || "uncategorized";
        const bucket = tx.type === "income" ? incomeByCategory : expenseByCategory;
        const current = bucket.get(category) || { total: 0, count: 0 };
        current.total += amount;
        current.count += 1;
        bucket.set(category, current);
        if (tx.type === "income") {
            totalIncome += amount;
            incomeCount += 1;
        }
        else {
            totalExpense += amount;
            expenseCount += 1;
        }
    }
    const formatBreakdown = (bucket) => Array.from(bucket.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([category, info]) => `  - ${category}: ${formatCurrencyINR(info.total)} (${info.count} txn${info.count === 1 ? "" : "s"})`)
        .join("\n");
    const lines = [];
    lines.push(`Total expense: ${formatCurrencyINR(totalExpense)} across ${expenseCount} transactions`);
    lines.push(`Total income: ${formatCurrencyINR(totalIncome)} across ${incomeCount} transactions`);
    lines.push(`Net (income - expense): ${formatCurrencyINR(totalIncome - totalExpense)}`);
    if (expenseByCategory.size > 0) {
        lines.push("Expense by category (highest first):");
        lines.push(formatBreakdown(expenseByCategory));
    }
    if (incomeByCategory.size > 0) {
        lines.push("Income by category (highest first):");
        lines.push(formatBreakdown(incomeByCategory));
    }
    return lines.join("\n");
}
function parseDateOnlyToBoundaryInTimeZone(dateOnly, endOfDay, timeZone) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const naiveUtc = endOfDay
        ? new Date(Date.UTC(year, month, day, 23, 59, 59, 999))
        : new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const offsetMs = getTimeZoneOffsetMs(naiveUtc, timeZone);
    const zonedBoundary = new Date(naiveUtc.getTime() - offsetMs);
    if (Number.isNaN(zonedBoundary.getTime())) {
        return null;
    }
    return zonedBoundary;
}
async function extractDateRangeWithAI(question, now, timeZone) {
    const todayStr = formatDateInTimeZone(now, timeZone);
    const extraction = await genkit_2.ai.generate({
        model: google_genai_1.vertexAI.model("gemini-2.0-flash-lite"),
        output: { schema: DateRangeExtractionSchema },
        prompt: `You are a strict date-range extraction assistant for finance queries.
Today's date is ${todayStr}.

Given a user question, decide whether a concrete date range is explicitly or implicitly requested.

Return JSON with:
- hasDateRange: boolean
- start: YYYY-MM-DD or null
- end: YYYY-MM-DD or null
- reasoning: short explanation

Rules:
1) If no clear date range is present, return hasDateRange=false with start/end null.
2) For relative ranges like "last month", "this month", "last week", "this week", "yesterday", "today", "last 30 days", resolve against today's date.
3) For month names like "October", resolve to the most recent past matching month.
4) For year-only like "in 2024", use full year.
5) Always ensure start <= end and both are valid calendar dates.
6) Do not invent unsupported ranges from vague words like "recent" or "lately"; set hasDateRange=false for those.

User question: ${question}`,
    });
    const output = extraction.output;
    if (!(output === null || output === void 0 ? void 0 : output.hasDateRange))
        return null;
    if (!output.start || !output.end)
        return null;
    const start = parseDateOnlyToBoundaryInTimeZone(output.start, false, timeZone);
    const end = parseDateOnlyToBoundaryInTimeZone(output.end, true, timeZone);
    if (!start || !end)
        return null;
    if (start.getTime() > end.getTime())
        return null;
    const minDate = new Date(2015, 0, 1, 0, 0, 0, 0);
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + 1);
    maxDate.setHours(23, 59, 59, 999);
    if (start < minDate || end > maxDate)
        return null;
    logger.info("AI date range extraction succeeded", {
        question,
        start: output.start,
        end: output.end,
        reasoning: output.reasoning || "",
    });
    return { start, end };
}
// Define the retriever for semantic search
const transactionRetriever = genkit_2.ai.defineRetriever({
    name: "transactionRetriever",
    configSchema: genkit_1.z.object({
        homeId: genkit_1.z.string(),
        timeZone: genkit_1.z.string().optional(),
    }),
}, async (content, options) => {
    const embedding = await genkit_2.ai.embed({
        embedder: google_genai_1.vertexAI.embedder('text-embedding-004'),
        content: content.text,
    });
    const firestore = (0, firestore_1.getFirestore)();
    const collection = firestore.collection("transactions");
    // Vector Search - scoped by homeId
    // Note: This requires a composite index on (homeId ASC, embedding VECTOR)
    const displayTimeZone = (options === null || options === void 0 ? void 0 : options.timeZone) || "UTC";
    const vectorQuery = collection
        .where("homeId", "==", options === null || options === void 0 ? void 0 : options.homeId)
        .findNearest("embedding", firestore_1.FieldValue.vector(embedding[0].embedding), {
        limit: 20,
        distanceMeasure: "COSINE",
    });
    const querySnapshot = await vectorQuery.get();
    return {
        documents: querySnapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                content: [
                    { text: `Date: ${formatDate(data.date, displayTimeZone)}, Amount: ${data.amount}, Category: ${data.categoryId}, Note: ${data.note || 'N/A'}` },
                ],
                metadata: { id: doc.id },
            };
        }),
    };
});
// Define the Flow using Genkit 1.x API
const analyzeTransactionsFlow = genkit_2.ai.defineFlow({
    name: "analyzeTransactions",
    inputSchema: TransactionQuerySchema,
    outputSchema: genkit_1.z.string(),
}, async ({ question, homeId, timeZone }) => {
    var _a, _b, _c, _d;
    const effectiveTimeZone = timeZone || "UTC";
    // Get current date for context
    const now = new Date();
    const currentDate = formatDateInTimeZone(now, effectiveTimeZone);
    const currentMonth = now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: effectiveTimeZone });
    // Calculate last month
    const nowYearMonthInTz = new Intl.DateTimeFormat("en-CA", {
        timeZone: effectiveTimeZone,
        year: "numeric",
        month: "2-digit",
    }).formatToParts(now);
    const tzYear = Number((_b = (_a = nowYearMonthInTz.find((p) => p.type === "year")) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : "1970");
    const tzMonth = Number((_d = (_c = nowYearMonthInTz.find((p) => p.type === "month")) === null || _c === void 0 ? void 0 : _c.value) !== null && _d !== void 0 ? _d : "1");
    const lastMonth = new Date(Date.UTC(tzYear, tzMonth - 2, 1));
    const lastMonthName = lastMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const extractedDateRange = await extractDateRangeWithAI(question, now, effectiveTimeZone);
    let transactionsContext = '';
    let summaryContext = 'No precomputed summary available.';
    if (extractedDateRange) {
        // For specific time periods, query with date filter
        logger.info(`Querying transactions from ${extractedDateRange.start.toISOString()} to ${extractedDateRange.end.toISOString()} for home ${homeId}`);
        const periodTxns = await getTransactionsForPeriod(extractedDateRange.start, extractedDateRange.end, homeId);
        logger.info(`Found ${periodTxns.length} transactions in period`);
        transactionsContext = periodTxns
            .map(t => `Date: ${formatDate(t.date, effectiveTimeZone)}, Type: ${t.type}, Amount: ${t.amount}, Category: ${t.categoryId}, Note: ${t.note || 'N/A'}`)
            .join('\n');
        if (periodTxns.length === 0) {
            transactionsContext = 'No transactions found for this time period.';
        }
        summaryContext = summarizeTransactions(periodTxns);
    }
    else {
        // For semantic queries, use vector search with homeId context through options
        const docs = await genkit_2.ai.retrieve({
            retriever: transactionRetriever,
            query: question,
            options: { homeId: homeId, timeZone: effectiveTimeZone }
        });
        transactionsContext = docs
            .map((d) => d.content.map((p) => 'text' in p ? p.text : '').join(''))
            .join('\n');
        summaryContext = 'No precomputed summary available for semantic queries; rely on the transaction data above only for qualitative answers, not totals.';
    }
    const prompt = `You are a helpful and friendly financial assistant analyzing personal expense data.

CURRENT DATE: ${currentDate}
CURRENT MONTH: ${currentMonth}
LAST MONTH: ${lastMonthName}
TIME ZONE: ${effectiveTimeZone}

USER QUESTION: ${question}

SUMMARY (precomputed authoritative numbers, do NOT recompute):
${summaryContext}

TRANSACTION DATA (context only, for narrative details):
${transactionsContext}

INSTRUCTIONS:
1. Use the current date to correctly interpret relative time references (e.g., "last month" = ${lastMonthName}).
2. For any totals, sums, averages or category breakdowns, use the SUMMARY values verbatim. Never re-add the TRANSACTION DATA yourself.
3. Treat "spending" as expenses only (Type=expense). Treat income separately when asked.
4. Use TRANSACTION DATA only for qualitative context (examples, dates, notes), never for arithmetic.
5. Format currency amounts in Indian Rupees with grouping (e.g., ₹1,71,518.44).
6. If the SUMMARY says no transactions found, say so clearly.
7. Be concise but informative.
8. If the question is vague, provide a helpful summary using SUMMARY values.

Provide your answer:`;
    console.log("Generated prompt for AI:", prompt);
    // Generate answer with improved prompt
    const { text } = await genkit_2.ai.generate({
        model: google_genai_1.vertexAI.model('gemini-2.5-flash'),
        prompt: prompt,
    });
    return text;
});
// Logic handler exported for testing
const analyzeTransactionsHandler = async (request) => {
    var _a, _b, _c, _d, _e;
    // 1. Check if authenticated via standard Firebase SDK
    let uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    let email = (_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.email;
    // 2. If not, check for Authorization header manually (fallback)
    if (!uid) {
        const authHeader = (_d = request.rawRequest) === null || _d === void 0 ? void 0 : _d.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split('Bearer ')[1];
            try {
                const decodedToken = await (0, auth_1.getAuth)().verifyIdToken(token);
                uid = decodedToken.uid;
                email = decodedToken.email;
            }
            catch (e) {
                logger.warn("Failed to verify token from header", e);
            }
        }
    }
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    logger.info(`AnalyzeTransactions called by user: ${uid} (${email})`);
    // 3. Fetch user's homeId
    const firestore = (0, firestore_1.getFirestore)();
    const userDoc = await firestore.collection('users').doc(uid).get();
    const homeId = (_e = userDoc.data()) === null || _e === void 0 ? void 0 : _e.homeId;
    if (!homeId) {
        throw new https_1.HttpsError('failed-precondition', 'User does not belong to a home.');
    }
    // Verify user is actually a member of this home (double check, or rely on user doc trust? Better to check logic if needed, but 'users' write is protected to owner)
    // For now, relying on 'users' collection integrity which requires owner to write.
    const { question, timeZone } = request.data;
    if (!question || typeof question !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'The function must be called with a "question" argument.');
    }
    return await analyzeTransactionsFlow({ question, homeId, timeZone });
};
exports.analyzeTransactionsHandler = analyzeTransactionsHandler;
// Expose the flow as a Firebase callable function
exports.analyzeTransactions = (0, https_1.onCall)(exports.analyzeTransactionsHandler);
// Join Home Function
// Input: { displayId: string }
// Output: { homeId: string, name: string }
exports.joinHome = (0, https_1.onCall)(async (request) => {
    // 1. Authenticate
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const uid = request.auth.uid;
    const { displayId } = request.data;
    if (!displayId) {
        throw new https_1.HttpsError('invalid-argument', 'Missing displayId');
    }
    const firestore = (0, firestore_1.getFirestore)();
    // 2. Find Home by displayId
    const homesSnapshot = await firestore.collection('homes')
        .where('displayId', '==', displayId)
        .limit(1)
        .get();
    if (homesSnapshot.empty) {
        throw new https_1.HttpsError('not-found', 'Home not found with this invite code.');
    }
    const homeDoc = homesSnapshot.docs[0];
    const homeData = homeDoc.data();
    const homeId = homeDoc.id;
    // 3. Add user to home (arrayUnion uniqueness handled automatically)
    await homeDoc.ref.update({
        memberIds: firestore_1.FieldValue.arrayUnion(uid)
    });
    // 4. Update User Profile
    await firestore.collection('users').doc(uid).update({
        homeId: homeId
    });
    return {
        id: homeId,
        name: homeData.name,
        displayId: homeData.displayId,
        ownerId: homeData.ownerId,
        memberIds: [...(homeData.memberIds || []), uid]
    };
});
// // Backfill Embeddings for existing transactions
// // Call via: firebase functions:shell -> backfillEmbeddings({}) or via client SDK
// export const backfillEmbeddings = onCall(async () => {
//     return await backfillEmbeddingsHandler();
// });
//# sourceMappingURL=index.js.map