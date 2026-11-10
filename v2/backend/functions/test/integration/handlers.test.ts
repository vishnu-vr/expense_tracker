import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import { genkit } from "genkit";
import type { GenerateRequest, GenerateResponseData, Part } from "genkit";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../../src/config";
import { searchEmbeddings } from "../../src/data/firestore-backend";
import { loadHomeData, resolveHome } from "../../src/data/home";
import { askAgentHandler, AskAgentChunk } from "../../src/handlers/ask-agent";
import { confirmProposalHandler } from "../../src/handlers/confirm-proposal";
import { exportTransactionsCsvHandler } from "../../src/handlers/export-csv";
import { generateAllInsights, generateInsightsForHome } from "../../src/handlers/insights";
import { joinHomeHandler } from "../../src/handlers/join-home";
import { leaveHomeHandler } from "../../src/handlers/leave-home";
import { sendNotificationPush } from "../../src/handlers/notifications";
import { syncTransactionEmbedding, writeTransactionNotification } from "../../src/handlers/transactions";

/**
 * Handler integration tests: the real handlers against the Firestore emulator
 * through the Admin SDK. Models, embeddings and FCM are faked — nothing here
 * talks to a real Google service.
 */
const PROJECT = "demo-track-expense";
let db: Firestore;

const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const txDoc = (userId: string, homeId: string, extra: Record<string, unknown> = {}) => ({
  amount: 250, categoryId: "food", date: at("2026-10-05T06:30:00Z"), note: "Lunch", type: "expense",
  userId, userEmail: `${userId}@example.com`, homeId, tagIds: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  ...extra,
});
/** Deterministic fake embedding: a unit vector whose direction depends on the first word. */
const fakeEmbed = async (text: string): Promise<number[]> => {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  const word = text.toLowerCase().split(/[^a-z]+/).filter(Boolean)[0] ?? "";
  v[[...word].reduce((s, c) => s + c.charCodeAt(0), 0) % EMBEDDING_DIMENSIONS] = 1;
  return v;
};
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as { code?: string }).code ?? String(e));

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run through `npm run test:rules:emulator` (needs the Firestore emulator).");
  if (!getApps().length) initializeApp({ projectId: PROJECT });
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("homes/h1").set({ name: "Alice & Bob", displayId: "ABC123", ownerId: "alice", memberIds: ["alice", "bob"], createdAt: at("2026-01-01T00:00:00Z") });
  await db.doc("homes/h2").set({ name: "Carol", displayId: "XYZ789", ownerId: "carol", memberIds: ["carol"], createdAt: at("2026-01-01T00:00:00Z") });
  await db.doc("users/alice").set({ email: "alice@example.com", name: "Alice", homeId: "h1" });
  await db.doc("users/bob").set({ email: "bob@example.com", name: "Bob", homeId: "h1" });
  await db.doc("users/carol").set({ email: "carol@example.com", name: "Carol", homeId: "h2" });
  await db.doc("users/dave").set({ email: "dave@example.com", name: "Dave" });
  await db.doc("homes/h1/tags/trip").set({ name: "Goa trip" });
  await db.doc("homes/h1/categories/pets").set({ name: "Pets", icon: "pets", color: "#000", type: "expense" });
});

describe("resolveHome", () => {
  it("resolves the caller's home from their uid", async () => {
    expect(await resolveHome(db, "alice")).toEqual({ homeId: "h1", name: "Alice & Bob", memberIds: ["alice", "bob"] });
  });
  it("rejects a user with no home, and one who pointed their profile at someone else's home", async () => {
    expect(await code(resolveHome(db, "dave"))).toBe("failed-precondition");
    await db.doc("users/carol").update({ homeId: "h1" }); // spoofed pointer
    expect(await code(resolveHome(db, "carol"))).toBe("permission-denied");
  });
});

describe("joinHome", () => {
  it("adds the caller to the home and points their profile at it", async () => {
    const res = await joinHomeHandler(db, "dave", { displayId: " abc123 " });
    expect(res).toEqual({ id: "h1", name: "Alice & Bob", displayId: "ABC123", ownerId: "alice", memberIds: ["alice", "bob", "dave"] });
    expect((await db.doc("homes/h1").get()).get("memberIds")).toEqual(["alice", "bob", "dave"]);
    expect((await db.doc("users/dave").get()).get("homeId")).toBe("h1");
    // joining again does not duplicate
    expect((await joinHomeHandler(db, "dave", { displayId: "ABC123" })).memberIds).toEqual(["alice", "bob", "dave"]);
  });
  it("rejects bad input and unknown codes", async () => {
    expect(await code(joinHomeHandler(db, "dave", {}))).toBe("invalid-argument");
    expect(await code(joinHomeHandler(db, "dave", { displayId: "NOPE00" }))).toBe("not-found");
  });
});

describe("leaveHome", () => {
  const home = async (id: string) => (await db.doc(`homes/${id}`).get()).data()!;
  const user = async (id: string) => (await db.doc(`users/${id}`).get()).data()!;

  it("a non-owner leaves: removed from memberIds, homeId cleared, rest of the profile and their entries kept", async () => {
    await db.doc("transactions/tb").set(txDoc("bob", "h1"));
    expect(await leaveHomeHandler(db, "bob")).toEqual({ homeId: "h1", ownershipTransferredTo: null });
    expect(await home("h1")).toMatchObject({ ownerId: "alice", memberIds: ["alice"], displayId: "ABC123" });
    expect(await user("bob")).toEqual({ email: "bob@example.com", name: "Bob" });
    expect((await db.doc("transactions/tb").get()).data()).toMatchObject({ userId: "bob", homeId: "h1", amount: 250 });
    expect(await code(resolveHome(db, "bob"))).toBe("failed-precondition");
  });

  it("the owner leaves with others remaining: ownership goes to the first remaining member", async () => {
    await db.doc("homes/h1").update({ memberIds: ["alice", "bob", "erin"] });
    expect(await leaveHomeHandler(db, "alice")).toEqual({ homeId: "h1", ownershipTransferredTo: "bob" });
    expect(await home("h1")).toMatchObject({ ownerId: "bob", memberIds: ["bob", "erin"] });
    expect(await user("alice")).not.toHaveProperty("homeId");
  });

  it("the last member leaves: the home and its data stay in place", async () => {
    await db.doc("transactions/tc").set(txDoc("carol", "h2"));
    expect(await leaveHomeHandler(db, "carol")).toEqual({ homeId: "h2", ownershipTransferredTo: null });
    expect(await home("h2")).toMatchObject({ name: "Carol", ownerId: "carol", memberIds: [], displayId: "XYZ789" });
    expect((await db.doc("transactions/tc").get()).exists).toBe(true);
    expect(await user("carol")).toEqual({ email: "carol@example.com", name: "Carol" });
  });

  it("a user with no home gets failed-precondition (also on a second call)", async () => {
    expect(await code(leaveHomeHandler(db, "dave"))).toBe("failed-precondition");
    expect(await code(leaveHomeHandler(db, "nobody"))).toBe("failed-precondition");
    await leaveHomeHandler(db, "bob");
    expect(await code(leaveHomeHandler(db, "bob"))).toBe("failed-precondition");
  });

  it("a stale homeId is just cleared, without touching the home", async () => {
    await db.doc("users/dave").update({ homeId: "h1" }); // h1 does not list dave
    expect(await leaveHomeHandler(db, "dave")).toEqual({ homeId: "h1", ownershipTransferredTo: null });
    expect(await home("h1")).toMatchObject({ ownerId: "alice", memberIds: ["alice", "bob"] });
    expect(await user("dave")).toEqual({ email: "dave@example.com", name: "Dave" });

    await db.doc("users/dave").update({ homeId: "gone" }); // home does not exist
    expect(await leaveHomeHandler(db, "dave")).toEqual({ homeId: "gone", ownershipTransferredTo: null });
    expect((await db.doc("homes/gone").get()).exists).toBe(false);
    expect(await user("dave")).not.toHaveProperty("homeId");
  });
});

describe("exportTransactionsCsv", () => {
  it("exports only the caller's household, within the local-day range", async () => {
    await db.doc("transactions/a").set(txDoc("alice", "h1", { date: at("2026-09-30T18:29:00Z"), note: "late Sep (IST)" })); // 30 Sep 23:59 IST
    await db.doc("transactions/b").set(txDoc("alice", "h1", { date: at("2026-09-30T18:31:00Z"), note: "tea, biscuits", tagIds: ["trip"], categoryId: "pets", amount: 99.5 })); // 1 Oct 00:01 IST
    await db.doc("transactions/c").set(txDoc("bob", "h1", { date: at("2026-10-31T18:00:00Z"), type: "income", categoryId: "salary", amount: 50000, note: "Salary" }));
    await db.doc("transactions/d").set(txDoc("carol", "h2", { note: "other household" }));
    const res = await exportTransactionsCsvHandler(db, "alice", { from: "2026-10-01", to: "2026-10-31", timeZone: "Asia/Kolkata" });
    expect(res.count).toBe(2);
    expect(res.filename).toBe("transactions_2026-10-01_to_2026-10-31.csv");
    expect(res.csv).toBe(
      "Date,Type,Amount,Category,Note,Tags,User,Email\n" +
        '2026-10-01 00:01,expense,99.5,Pets,"tea, biscuits",Goa trip,Alice,alice@example.com\n' +
        "2026-10-31 23:30,income,50000,Salary,Salary,,Bob,bob@example.com\n",
    );
  });
  it("validates arguments", async () => {
    expect(await code(exportTransactionsCsvHandler(db, "alice", { from: "2026-10-01" }))).toBe("invalid-argument");
    expect(await code(exportTransactionsCsvHandler(db, "alice", { from: "2026-10-31", to: "2026-10-01" }))).toBe("invalid-argument");
    expect(await code(exportTransactionsCsvHandler(db, "dave", { from: "2026-10-01", to: "2026-10-31" }))).toBe("failed-precondition");
  });
});

describe("onTransactionWritten: household notification", () => {
  const after = { ...txDoc("alice", "h1"), amount: 1200, note: "Dinner", createdAt: Timestamp.now() };
  it("writes a notification for create, update and delete, in the v1 shape", async () => {
    const id = await writeTransactionNotification(db, { eventId: "e1", transactionId: "t1", before: null, after });
    const created = (await db.doc(`notifications/${id}`).get()).data()!;
    expect(created).toMatchObject({
      type: "transaction_added", message: "Alice added a new expense of ₹1,200", transactionId: "t1",
      homeId: "h1", createdBy: "alice", createdByName: "Alice", readBy: [],
    });
    expect(created.createdAt).toBeInstanceOf(Timestamp);

    const upd = await writeTransactionNotification(db, { eventId: "e2", transactionId: "t1", before: after, after: { ...after, amount: 1500 } });
    expect((await db.doc(`notifications/${upd}`).get()).get("message")).toBe("Alice updated a transaction: Dinner - ₹1,500");

    const del = await writeTransactionNotification(db, { eventId: "e3", transactionId: "t1", before: after, after: null });
    expect((await db.doc(`notifications/${del}`).get()).data()).toMatchObject({ type: "transaction_deleted", message: "Alice deleted a transaction: Dinner - ₹1,200" });
  });
  it("is idempotent per event and silent for no-op updates and imports", async () => {
    await writeTransactionNotification(db, { eventId: "same", transactionId: "t1", before: null, after });
    await writeTransactionNotification(db, { eventId: "same", transactionId: "t1", before: null, after });
    expect((await db.collection("notifications").get()).size).toBe(1);
    expect(await writeTransactionNotification(db, { eventId: "e4", transactionId: "t1", before: after, after: { ...after, updatedAt: Timestamp.now() } })).toBeNull();
    const imported = { ...after, createdAt: at("2025-01-01T00:00:00Z") };
    expect(await writeTransactionNotification(db, { eventId: "e5", transactionId: "t9", before: null, after: imported })).toBeNull();
    expect((await db.collection("notifications").get()).size).toBe(1);
  });
});

describe("onTransactionWritten: transactionEmbeddings upkeep", () => {
  const base = txDoc("alice", "h1", { note: "Swiggy dinner", tagIds: ["trip"], amount: 432 });
  const calls: string[] = [];
  const embed = async (t: string) => (calls.push(t), fakeEmbed(t));
  beforeEach(() => void (calls.length = 0));

  it("creates, skips, refreshes and deletes the embedding doc", async () => {
    expect(await syncTransactionEmbedding(db, { eventId: "1", transactionId: "t1", before: null, after: base }, embed)).toBe("written");
    const snap = await db.doc("transactionEmbeddings/t1").get();
    expect(snap.get("homeId")).toBe("h1");
    expect(snap.get("text")).toBe("Swiggy dinner | Food | Swiggy | Goa trip");
    expect(snap.get("model")).toBe(EMBEDDING_MODEL);
    expect(snap.get("vector").toArray()).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Object.keys(snap.data()!).sort()).toEqual(["homeId", "model", "text", "updatedAt", "vector"]);
    // amounts, dates and type are not embedded
    expect(calls).toEqual(["Swiggy dinner | Food | Swiggy | Goa trip"]);
    expect(calls[0]).not.toMatch(/432|2026|expense/);

    // amount-only change: nothing to do, no model call
    expect(await syncTransactionEmbedding(db, { eventId: "2", transactionId: "t1", before: base, after: { ...base, amount: 999 } }, embed)).toBe("unchanged");
    // same text arriving again (e.g. retry / backfill): no model call
    expect(await syncTransactionEmbedding(db, { eventId: "3", transactionId: "t1", before: null, after: base }, embed)).toBe("unchanged");
    expect(calls).toHaveLength(1);

    // category changed (custom home category name is used)
    expect(await syncTransactionEmbedding(db, { eventId: "4", transactionId: "t1", before: base, after: { ...base, categoryId: "pets" } }, embed)).toBe("written");
    expect((await db.doc("transactionEmbeddings/t1").get()).get("text")).toBe("Swiggy dinner | Pets | Swiggy | Goa trip");

    // note cleared -> nothing to search for
    expect(await syncTransactionEmbedding(db, { eventId: "5", transactionId: "t1", before: base, after: { ...base, note: "" } }, embed)).toBe("deleted");
    expect((await db.doc("transactionEmbeddings/t1").get()).exists).toBe(false);

    await syncTransactionEmbedding(db, { eventId: "6", transactionId: "t1", before: null, after: base }, embed);
    expect(await syncTransactionEmbedding(db, { eventId: "7", transactionId: "t1", before: base, after: null }, embed)).toBe("deleted");
    expect((await db.doc("transactionEmbeddings/t1").get()).exists).toBe(false);
  });
});

describe("vector search over transactionEmbeddings", () => {
  it("returns nearest notes from the caller's home only", async () => {
    const put = async (id: string, homeId: string, note: string) =>
      syncTransactionEmbedding(db, { eventId: id, transactionId: id, before: null, after: txDoc("x", homeId, { note }) }, fakeEmbed);
    await put("p1", "h1", "plumber fixed the kitchen sink");
    await put("p2", "h1", "birthday cake");
    await put("p3", "h2", "plumber visit for the other household");
    const hits = await searchEmbeddings(db, "h1", await fakeEmbed("plumber"), 5);
    expect(hits.map((h) => h.transactionId)).not.toContain("p3"); // never another household's
    expect(hits[0].transactionId).toBe("p1");
    expect(hits[0].score).toBeCloseTo(1, 5);
    expect((await searchEmbeddings(db, "h2", await fakeEmbed("plumber"), 5)).map((h) => h.transactionId)).toEqual(["p3"]);
  });
});

describe("onNotificationCreated: FCM push", () => {
  it("pushes to the other members' devices and removes dead tokens", async () => {
    await db.doc("users/bob/fcmTokens/good").set({ token: "good" });
    await db.doc("users/bob/fcmTokens/dead").set({ token: "dead" });
    await db.doc("users/alice/fcmTokens/own").set({ token: "own" });
    await db.doc("users/carol/fcmTokens/other").set({ token: "other" });
    const sent: any[] = [];
    const messaging = {
      sendEach: async (messages: any[]) => {
        sent.push(...messages);
        const responses = messages.map((m) =>
          m.token === "dead"
            ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
            : { success: true, messageId: "id" },
        );
        return { responses, successCount: responses.filter((r) => r.success).length, failureCount: responses.filter((r) => !r.success).length };
      },
    };
    const result = await sendNotificationPush(db, messaging as any, "n1", {
      homeId: "h1", createdBy: "alice", message: "Alice added a new expense of ₹1,200", type: "transaction_added", transactionId: "t1",
    });
    expect(result).toEqual({ recipientCount: 1, tokenCount: 2, successCount: 1, failureCount: 1, staleTokenDeleteCount: 1 });
    expect(sent.map((m) => m.token).sort()).toEqual(["dead", "good"]); // not the creator, not another home
    expect(sent[0]).toMatchObject({
      notification: { title: "Track Expense", body: "Alice added a new expense of ₹1,200" },
      data: { notificationId: "n1", type: "transaction_added", transactionId: "t1", route: "/edit-transaction/t1", homeId: "h1" },
    });
    expect((await db.doc("users/bob/fcmTokens/dead").get()).exists).toBe(false);
    expect((await db.doc("users/bob/fcmTokens/good").get()).exists).toBe(true);
  });
  it("does nothing without recipients or required fields", async () => {
    const messaging = { sendEach: async () => { throw new Error("must not send"); } };
    expect(await sendNotificationPush(db, messaging as any, "n", { homeId: "h2", createdBy: "carol" })).toMatchObject({ recipientCount: 0 });
    expect(await sendNotificationPush(db, messaging as any, "n", { createdBy: "carol" })).toBeNull();
  });
});

// ---- agent ------------------------------------------------------------------

type Step = (req: GenerateRequest) => Part[];
function scripted(steps: Step[]) {
  const ai = genkit({});
  const requests: GenerateRequest[] = [];
  const name = `test/scripted-${Math.random().toString(36).slice(2)}`;
  ai.defineModel({ name, supports: { tools: true, multiturn: true, systemRole: true } }, async (req): Promise<GenerateResponseData> => {
    const step = steps[requests.length];
    requests.push(req);
    if (!step) throw new Error("script exhausted");
    return { message: { role: "model", content: step(req) }, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5 } };
  });
  return { ai, model: name, requests };
}
const call = (name: string, input: unknown): Part => ({ toolRequest: { name, input, ref: name } });
const lastToolOutput = (req: GenerateRequest): any =>
  [...req.messages].reverse().flatMap((m) => m.content).find((p) => p.toolResponse)?.toolResponse?.output;
const NOW = new Date("2026-11-10T04:30:00Z");

async function seedSpending() {
  await db.doc("transactions/a1").set(txDoc("alice", "h1", { amount: 1200, note: "Swiggy", date: at("2026-10-05T06:30:00Z") }));
  await db.doc("transactions/a2").set(txDoc("alice", "h1", { amount: 800.5, note: "Zomato", date: at("2026-10-09T06:30:00Z") }));
  await db.doc("transactions/b1").set(txDoc("bob", "h1", { amount: 3000, note: "Groceries", categoryId: "grocery", date: at("2026-10-12T06:30:00Z") }));
  await db.doc("transactions/c1").set(txDoc("carol", "h2", { amount: 99999, note: "Carol's secret", date: at("2026-10-12T06:30:00Z") }));
}

function deps(s: ReturnType<typeof scripted>) {
  return { db, runtime: async () => ({ ai: s.ai, model: s.model }), embedQuery: fakeEmbed, now: () => NOW };
}

describe("askAgent", () => {
  beforeEach(seedSpending);

  it("answers from the caller's household only, streams chunks, and persists both messages", async () => {
    const s = scripted([
      () => [call("query_transactions", { from: "2026-10-01", to: "2026-10-31", groupBy: "category" })],
      (req) => {
        const out = lastToolOutput(req);
        return [call("respond", {
          blocks: [
            { type: "stat", label: "Spent in October", value: out.summary.expenseTotalDisplay },
            { type: "bars", title: "By category", items: out.groups.map((g: any) => ({ label: g.label, value: g.total, display: g.totalDisplay })) },
            { type: "text", text: "Groceries were the biggest part of October spending." },
          ],
        })];
      },
    ]);
    const chunks: AskAgentChunk[] = [];
    const res = await askAgentHandler(deps(s), "alice", { message: "How much did we spend in October?", timeZone: "Asia/Kolkata" }, (c) => void chunks.push(c));

    // Carol's ₹99,999 is in another household and must not be counted.
    expect(res.blocks).toEqual([
      { type: "stat", label: "Spent in October", value: "₹5,000.50" },
      { type: "bars", title: "By category", items: [{ label: "Grocery", value: 3000, display: "₹3,000" }, { label: "Food", value: 2000.5, display: "₹2,000.50" }] },
      { type: "text", text: "Groceries were the biggest part of October spending." },
    ]);
    expect(JSON.stringify(s.requests)).not.toContain("Carol's secret");

    expect(chunks.filter((c) => c.type === "status").map((c) => (c as any).text)).toEqual(["Thinking…", "Looking through transactions…"]);
    expect(chunks.filter((c) => c.type === "text").map((c) => (c as any).delta).join("")).toBe("Groceries were the biggest part of October spending.\n");

    const thread = await db.doc(`homes/h1/aiThreads/${res.threadId}`).get();
    expect(thread.data()).toMatchObject({ title: "How much did we spend in October?", createdBy: "alice" });
    expect(Object.keys(thread.data()!).sort()).toEqual(["createdAt", "createdBy", "title", "updatedAt"]);
    const messages = (await thread.ref.collection("messages").orderBy("createdAt").get()).docs;
    expect(messages.map((m) => m.get("role"))).toEqual(["user", "assistant"]);
    expect(messages[0].get("blocks")).toEqual([{ type: "text", text: "How much did we spend in October?" }]);
    expect(messages[1].id).toBe(res.messageId);
    expect(messages[1].get("blocks")).toEqual(res.blocks);
    expect(Object.keys(messages[1].data()).sort()).toEqual(["blocks", "createdAt", "role"]);
  });

  it("continues a thread with its earlier messages as history", async () => {
    const first = scripted([() => [call("respond", { blocks: [{ type: "stat", label: "Spent in October", value: "₹5,000.50" }] })]]);
    const { threadId } = await askAgentHandler(deps(first), "alice", { message: "How much in October?", timeZone: "Asia/Kolkata" }, () => {});
    const second = scripted([() => [call("respond", { blocks: [{ type: "text", text: "Nothing in September." }] })]]);
    const res = await askAgentHandler(deps(second), "bob", { threadId, message: "And September?", timeZone: "Asia/Kolkata" }, () => {});
    expect(res.threadId).toBe(threadId);
    const convo = second.requests[0].messages.filter((m) => m.role !== "system").map((m) => [m.role, m.content[0].text]);
    expect(convo).toEqual([
      ["user", "How much in October?"],
      ["model", "[stat] Spent in October: ₹5,000.50"],
      ["user", "And September?"],
    ]);
    expect((await db.collection(`homes/h1/aiThreads/${threadId}/messages`).get()).size).toBe(4);
  });

  it("refuses bad input, other households' threads, and spoofed home pointers", async () => {
    const s = scripted([]);
    const ask = (uid: string, data: unknown) => code(askAgentHandler(deps(s), uid, data, () => {}));
    expect(await ask("alice", { message: "", timeZone: "Asia/Kolkata" })).toBe("invalid-argument");
    expect(await ask("alice", { message: "hi", timeZone: "Nowhere/Land" })).toBe("invalid-argument");
    expect(await ask("alice", { message: "x".repeat(2001), timeZone: "Asia/Kolkata" })).toBe("invalid-argument");
    expect(await ask("alice", { message: "hi", timeZone: "Asia/Kolkata", threadId: "../../h2" })).toBe("invalid-argument");
    expect(await ask("dave", { message: "hi", timeZone: "Asia/Kolkata" })).toBe("failed-precondition");

    await db.doc("homes/h2/aiThreads/carols").set({ title: "private", createdBy: "carol", createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    expect(await ask("alice", { message: "hi", timeZone: "Asia/Kolkata", threadId: "carols" })).toBe("not-found");

    await db.doc("users/dave").update({ homeId: "h2" }); // dave is not in h2.memberIds
    expect(await ask("dave", { message: "show me everything", timeZone: "Asia/Kolkata" })).toBe("permission-denied");
    expect(s.requests).toHaveLength(0); // the model was never reached
  });

  it("returns a generic error when the model fails, keeping the user's message", async () => {
    const s = scripted([() => { throw new Error("upstream exploded with details"); }]);
    const err: any = await askAgentHandler(deps(s), "alice", { message: "hi", timeZone: "Asia/Kolkata" }, () => {}).catch((e) => e);
    expect(err.code).toBe("internal");
    expect(err.message).toBe("The assistant could not answer right now. Please try again.");
    const threads = await db.collection("homes/h1/aiThreads").get();
    expect((await threads.docs[0].ref.collection("messages").get()).docs.map((m) => m.get("role"))).toEqual(["user"]);
  });
});

describe("proposals: propose -> confirmProposal", () => {
  beforeEach(seedSpending);

  async function propose(uid: string, toolName: string, input: unknown) {
    const s = scripted([
      () => [call(toolName, input)],
      (req) => [call("respond", { blocks: [{ type: "proposal", proposalId: lastToolOutput(req).proposalId }] })],
    ]);
    const res = await askAgentHandler(deps(s), uid, { message: "please change it", timeZone: "Asia/Kolkata" }, () => {});
    const block = res.blocks.find((b) => b.type === "proposal") as Extract<(typeof res.blocks)[number], { type: "proposal" }>;
    return { threadId: res.threadId, proposalId: block.proposalId, block };
  }
  const proposal = (threadId: string, proposalId: string) => db.doc(`homes/h1/aiThreads/${threadId}/proposals/${proposalId}`).get();

  it("the agent only stores a pending proposal; accepting applies it", async () => {
    const { threadId, proposalId, block } = await propose("alice", "propose_set_budget", { categoryId: "food", amount: 14000 });
    expect(block).toEqual({ type: "proposal", proposalId, action: "set_budget", summary: "Set a monthly Food budget of ₹14,000" });
    expect((await proposal(threadId, proposalId)).data()).toMatchObject({
      action: "set_budget", status: "pending", createdBy: "alice", params: { action: "set_budget", categoryId: "food", amount: 14000 },
    });
    expect((await db.doc("homes/h1/categoryBudgets/food").get()).exists).toBe(false); // nothing written yet

    const res = await confirmProposalHandler(db, "alice", { threadId, proposalId, accept: true });
    expect(res).toEqual({ proposalId, status: "applied", appliedCount: 1, skippedTransactionIds: [] });
    expect((await db.doc("homes/h1/categoryBudgets/food").get()).data()).toMatchObject({ categoryId: "food", amount: 14000 });
    expect((await proposal(threadId, proposalId)).data()).toMatchObject({ status: "applied", resolvedBy: "alice" });
    // cannot be applied twice
    expect(await code(confirmProposalHandler(db, "alice", { threadId, proposalId, accept: true }))).toBe("failed-precondition");
  });

  it("rejecting changes nothing", async () => {
    const { threadId, proposalId } = await propose("alice", "propose_set_budget", { categoryId: "food", amount: 14000 });
    expect(await confirmProposalHandler(db, "alice", { threadId, proposalId, accept: false })).toMatchObject({ status: "rejected", appliedCount: 0 });
    expect((await db.doc("homes/h1/categoryBudgets/food").get()).exists).toBe(false);
    expect((await proposal(threadId, proposalId)).get("status")).toBe("rejected");
  });

  it("recategorise / tag only ever touch the confirming member's own entries", async () => {
    // Alice asks to move her two entries and Bob's: Bob's is left out when the proposal is built.
    const r = await propose("alice", "propose_recategorise", { transactionIds: ["a1", "a2", "b1"], categoryId: "pets" });
    expect((await proposal(r.threadId, r.proposalId)).get("params.transactionIds")).toEqual(["a1", "a2"]);

    // Bob (a member, but not the owner of those entries) cannot apply it…
    expect(await code(confirmProposalHandler(db, "bob", { threadId: r.threadId, proposalId: r.proposalId, accept: true }))).toBe("permission-denied");
    expect((await db.doc("transactions/a1").get()).get("categoryId")).toBe("food");
    expect((await proposal(r.threadId, r.proposalId)).get("status")).toBe("pending");

    // …Alice can.
    expect(await confirmProposalHandler(db, "alice", { threadId: r.threadId, proposalId: r.proposalId, accept: true })).toMatchObject({ status: "applied", appliedCount: 2 });
    expect((await db.doc("transactions/a1").get()).get("categoryId")).toBe("pets");
    expect((await db.doc("transactions/a2").get()).get("categoryId")).toBe("pets");
    expect((await db.doc("transactions/b1").get()).get("categoryId")).toBe("grocery");

    const t = await propose("alice", "propose_tag_transactions", { transactionIds: ["a1"], tagId: "trip" });
    await confirmProposalHandler(db, "alice", { threadId: t.threadId, proposalId: t.proposalId, accept: true });
    expect((await db.doc("transactions/a1").get()).get("tagIds")).toEqual(["trip"]);
  });

  it("a tampered proposal cannot reach another household's data", async () => {
    const { threadId, proposalId } = await propose("alice", "propose_recategorise", { transactionIds: ["a1"], categoryId: "pets" });
    await db.doc(`homes/h1/aiThreads/${threadId}/proposals/${proposalId}`).update({ "params.transactionIds": ["a1", "c1", "b1"] });
    const res = await confirmProposalHandler(db, "alice", { threadId, proposalId, accept: true });
    expect(res).toMatchObject({ appliedCount: 1, skippedTransactionIds: ["c1", "b1"] });
    expect((await db.doc("transactions/c1").get()).get("categoryId")).toBe("food");
  });

  it("members of another household cannot see or confirm it, and input is validated", async () => {
    const { threadId, proposalId } = await propose("alice", "propose_set_budget", { categoryId: "food", amount: 14000 });
    expect(await code(confirmProposalHandler(db, "carol", { threadId, proposalId, accept: true }))).toBe("not-found");
    expect(await code(confirmProposalHandler(db, "dave", { threadId, proposalId, accept: true }))).toBe("failed-precondition");
    expect(await code(confirmProposalHandler(db, "alice", { threadId, proposalId }))).toBe("invalid-argument");
    expect(await code(confirmProposalHandler(db, "alice", { threadId, proposalId: "a/b", accept: true }))).toBe("invalid-argument");
    expect(await code(confirmProposalHandler(db, "alice", { threadId, proposalId: "missing", accept: true }))).toBe("not-found");
  });
});

describe("proactive insights", () => {
  async function seedHistory() {
    const batch = db.batch();
    let n = 0;
    const add = (iso: string, amount: number, categoryId: string, note: string, userId = "alice") =>
      batch.set(db.doc(`transactions/s${++n}`), txDoc(userId, "h1", { amount, categoryId, note, date: at(iso) }));
    for (const m of ["06", "07", "08", "09", "10"]) {
      add(`2026-${m}-03T06:30:00Z`, 25000, "home", "House rent");
      add(`2026-${m}-05T06:30:00Z`, m === "10" ? 799 : 649, "entertainment", "Netflix");
      add(`2026-${m}-12T06:30:00Z`, 4000 + Number(m) * 100, "grocery", "DMart", "bob");
    }
    add("2026-11-03T06:30:00Z", 25000, "home", "House rent");
    add("2026-11-04T06:30:00Z", 9000, "food", "Team dinner");
    batch.set(db.doc("homes/h1/categoryBudgets/food"), { categoryId: "food", amount: 8000, updatedAt: Timestamp.now() });
    await batch.commit();
  }

  it("writes cards with stable ids and the contract's fields, idempotently", async () => {
    await seedHistory();
    const home = { homeId: "h1", memberIds: ["alice", "bob"] };
    const first = await generateInsightsForHome(db, home, "Asia/Kolkata", NOW);
    expect(first.created).toBeGreaterThan(0);
    expect(first).toMatchObject({ updated: 0, unchanged: 0, detected: first.created });

    const cards = await db.collection("homes/h1/insights").get();
    const ids = cards.docs.map((d) => d.id).sort();
    expect(ids).toContain("month_review_2026-10");
    expect(ids).toContain("budget_forecast_2026-11_food");
    expect(ids).toContain("subscription_price_change_2026-10_entertainment-netflix");
    for (const d of cards.docs) {
      expect(Object.keys(d.data()).sort()).toEqual(["body", "createdAt", "data", "dismissedBy", "kind", "periodKey", "title"]);
      expect(d.get("dismissedBy")).toEqual([]);
    }
    const food = await db.doc("homes/h1/insights/budget_forecast_2026-11_food").get();
    expect(food.data()).toMatchObject({ kind: "budget_forecast", periodKey: "2026-11", title: "Food is over budget" });
    expect(food.get("data")).toMatchObject({ state: "over", budget: 8000, spent: 9000, crossingDay: 4 });

    // A member dismisses a card; the next run neither duplicates nor resets it.
    await food.ref.update({ dismissedBy: ["alice"] });
    const second = await generateInsightsForHome(db, home, "Asia/Kolkata", NOW);
    expect(second).toEqual({ detected: first.detected, created: 0, updated: 0, unchanged: first.detected });
    expect((await db.collection("homes/h1/insights").get()).size).toBe(cards.size);
    expect((await food.ref.get()).get("dismissedBy")).toEqual(["alice"]);
    expect((await food.ref.get()).get("createdAt").isEqual(food.get("createdAt"))).toBe(true);

    // New data changes the card's content in place.
    await db.doc("transactions/extra").set(txDoc("alice", "h1", { amount: 500, note: "Snacks", date: at("2026-11-06T06:30:00Z") }));
    const third = await generateInsightsForHome(db, home, "Asia/Kolkata", NOW);
    expect(third.updated).toBeGreaterThan(0);
    expect((await food.ref.get()).get("data.spent")).toBe(9500);
    expect((await food.ref.get()).get("dismissedBy")).toEqual(["alice"]);
  });

  it("the daily job covers every home, keeps households apart, and survives a model-less run", async () => {
    await seedHistory();
    await db.doc("transactions/c1").set(txDoc("carol", "h2", { amount: 700, note: "Books", categoryId: "education", date: at("2026-10-10T06:30:00Z") }));
    const summary = await generateAllInsights(db, "Asia/Kolkata", NOW, null);
    expect(summary.homes).toBe(2);
    expect(summary.failed).toBe(0);
    const h2 = await db.collection("homes/h2/insights").get();
    expect(h2.docs.map((d) => d.id)).toEqual(["month_review_2026-10"]);
    expect(h2.docs[0].get("data.expenseTotal")).toBe(700);
    expect(h2.docs[0].get("body")).toBe("You spent ₹700 in October 2026. Top categories: Education ₹700. Biggest rise: Education (+₹700).");
  });

  it("loadHomeData reads Timestamp dates and merges default + home categories", async () => {
    await seedHistory();
    const data = await loadHomeData(db, { homeId: "h1", memberIds: ["alice", "bob"] }, "Asia/Kolkata");
    expect(data.transactions).toHaveLength(17);
    expect(data.transactions.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.day))).toBe(true);
    expect(data.categories.find((c) => c.id === "pets")?.name).toBe("Pets");
    expect(data.categories.find((c) => c.id === "food")?.name).toBe("Food");
    expect(data.members).toEqual([{ id: "alice", name: "Alice", email: "alice@example.com" }, { id: "bob", name: "Bob", email: "bob@example.com" }]);
    expect(data.budgets).toEqual([{ categoryId: "food", amount: 8000 }]);
  });
});
