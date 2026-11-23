import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, orderBy, query, setDoc,
  Timestamp, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

/**
 * Security rules for schema v2, run against the Firestore emulator.
 *   alice (owner) + bob  -> home h1
 *   carol (owner)        -> home h2
 *   dave                 -> no home
 */
let env: RulesTestEnvironment;
const db = (uid?: string) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const when = Timestamp.fromDate(new Date("2026-10-05T06:30:00Z"));

const txDoc = (userId: string, homeId: string, extra: Record<string, unknown> = {}) => ({
  amount: 250, categoryId: "food", date: when, note: "Lunch", type: "expense",
  userId, userEmail: `${userId}@example.com`, homeId, tagIds: [], createdAt: when, updatedAt: when, ...extra,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-track-expense",
    firestore: { rules: readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8") },
  });
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore();
    await setDoc(doc(f, "homes/h1"), { name: "Alice & Bob", displayId: "ABC123", ownerId: "alice", memberIds: ["alice", "bob"], createdAt: when });
    await setDoc(doc(f, "homes/h2"), { name: "Carol", displayId: "XYZ789", ownerId: "carol", memberIds: ["carol"], createdAt: when });
    await setDoc(doc(f, "users/alice"), { email: "alice@example.com", name: "Alice", homeId: "h1" });
    await setDoc(doc(f, "users/bob"), { email: "bob@example.com", name: "Bob", homeId: "h1" });
    await setDoc(doc(f, "users/carol"), { email: "carol@example.com", name: "Carol", homeId: "h2" });
    await setDoc(doc(f, "users/dave"), { email: "dave@example.com", name: "Dave" });
    await setDoc(doc(f, "users/alice/fcmTokens/tok"), { token: "tok" });
    for (const h of ["h1", "h2"]) {
      await setDoc(doc(f, `homes/${h}/categories/pets`), { name: "Pets", icon: "pets", color: "#000", type: "expense" });
      await setDoc(doc(f, `homes/${h}/categoryBudgets/food`), { categoryId: "food", amount: 10000, updatedAt: when });
      await setDoc(doc(f, `homes/${h}/tags/trip`), { name: "Trip" });
      const owner = h === "h1" ? "alice" : "carol";
      await setDoc(doc(f, `homes/${h}/aiThreads/th1`), { title: "Spending", createdBy: owner, createdAt: when, updatedAt: when, usage: { questions: 1, inputTokens: 10, outputTokens: 5, modelCalls: 1 } });
      await setDoc(doc(f, `homes/${h}/aiThreads/th1/messages/m1`), { role: "user", blocks: [{ type: "text", text: "hi" }], createdAt: when });
      await setDoc(doc(f, `homes/${h}/aiThreads/th1/proposals/p1`), { action: "set_budget", status: "pending", params: {}, summary: "s", createdBy: owner, createdAt: when });
      await setDoc(doc(f, `aiUsage/2026-10_${h}`), { month: "2026-10", homeId: h, questions: 1, inputTokens: 10, outputTokens: 5, modelCalls: 1, updatedAt: when });
      await setDoc(doc(f, `homes/${h}/insights/i1`), { kind: "month_review", title: "t", body: "b", data: {}, periodKey: "2026-10", createdAt: when, dismissedBy: [] });
      await setDoc(doc(f, `homes/${h}/reports/monthly_2026-10`), { kind: "monthly", period: { from: "2026-10-01", to: "2026-10-31", label: "October 2026" }, compare: null, sections: {}, narrative: { headline: "h", summary: "s", changes: [], suggestions: [] }, narrativeSource: "template", model: null, createdBy: "system", createdAt: when, generatedAt: when, schemaVersion: 1 });
    }
    await setDoc(doc(f, "homes/h1/aiThreads/thBob"), { title: "Bob's", createdBy: "bob", createdAt: when, updatedAt: when });
    await setDoc(doc(f, "homes/h1/aiThreads/thBob/messages/m1"), { role: "user", blocks: [{ type: "text", text: "private" }], createdAt: when });
    await setDoc(doc(f, "transactions/tA"), txDoc("alice", "h1"));
    await setDoc(doc(f, "transactions/tB"), txDoc("bob", "h1"));
    await setDoc(doc(f, "transactions/tC"), txDoc("carol", "h2"));
    await setDoc(doc(f, "transactionEmbeddings/tA"), { homeId: "h1", text: "Lunch | Food |  | ", model: "m", updatedAt: when });
    await setDoc(doc(f, "notifications/n1"), { type: "transaction_added", message: "Alice added", transactionId: "tA", homeId: "h1", createdBy: "alice", createdByName: "Alice", createdAt: when, readBy: [] });
    await setDoc(doc(f, "notifications/n2"), { type: "transaction_added", message: "Carol added", transactionId: "tC", homeId: "h2", createdBy: "carol", createdByName: "Carol", createdAt: when, readBy: [] });
  });
});

describe("unauthenticated", () => {
  it("can read or write nothing", async () => {
    const f = db();
    await assertFails(getDoc(doc(f, "homes/h1")));
    await assertFails(getDoc(doc(f, "users/alice")));
    await assertFails(getDoc(doc(f, "transactions/tA")));
    await assertFails(getDocs(query(collection(f, "transactions"), where("homeId", "==", "h1"))));
    await assertFails(getDoc(doc(f, "notifications/n1")));
    await assertFails(getDoc(doc(f, "homes/h1/insights/i1")));
    await assertFails(setDoc(doc(f, "transactions/new"), txDoc("alice", "h1")));
    await assertFails(setDoc(doc(f, "homes/h9"), { name: "x", ownerId: "x", memberIds: ["x"] }));
  });
});

describe("users", () => {
  it("a user reads their own profile and those of household members only", async () => {
    await assertSucceeds(getDoc(doc(db("alice"), "users/alice")));
    await assertSucceeds(getDoc(doc(db("alice"), "users/bob")));
    await assertFails(getDoc(doc(db("alice"), "users/carol")));
    await assertFails(getDoc(doc(db("carol"), "users/alice")));
    await assertSucceeds(getDoc(doc(db("dave"), "users/dave")));
    await assertFails(getDoc(doc(db("alice"), "users/dave")));
  });
  it("members can list their household's profiles; outsiders cannot", async () => {
    await assertSucceeds(getDocs(query(collection(db("bob"), "users"), where("homeId", "==", "h1"))));
    await assertFails(getDocs(query(collection(db("carol"), "users"), where("homeId", "==", "h1"))));
    await assertFails(getDocs(collection(db("alice"), "users")));
  });
  it("only the owner writes a profile", async () => {
    await assertSucceeds(updateDoc(doc(db("alice"), "users/alice"), { name: "Alice R" }));
    await assertFails(updateDoc(doc(db("bob"), "users/alice"), { name: "Hacked" }));
    await assertFails(deleteDoc(doc(db("alice"), "users/alice")));
  });
  it("a user cannot point their profile at a home they are not a member of", async () => {
    await assertFails(updateDoc(doc(db("carol"), "users/carol"), { homeId: "h1" }));
    await assertFails(setDoc(doc(db("dave"), "users/dave"), { email: "dave@example.com", name: "Dave", homeId: "h1" }));
    await assertFails(setDoc(doc(db("erin"), "users/erin"), { email: "e@example.com", name: "Erin", homeId: "h2" }));
    await assertSucceeds(setDoc(doc(db("erin"), "users/erin"), { email: "e@example.com", name: "Erin" }));
  });
  it("creating a home and pointing the profile at it works in one batch", async () => {
    const f = db("dave");
    const batch = writeBatch(f);
    batch.set(doc(f, "homes/h3"), { name: "Dave's", displayId: "DAVE01", ownerId: "dave", memberIds: ["dave"], createdAt: when });
    batch.update(doc(f, "users/dave"), { homeId: "h3" });
    await assertSucceeds(batch.commit());
  });
  it("FCM tokens are private to their user", async () => {
    await assertSucceeds(getDoc(doc(db("alice"), "users/alice/fcmTokens/tok")));
    await assertSucceeds(setDoc(doc(db("alice"), "users/alice/fcmTokens/tok2"), { token: "tok2" }));
    await assertFails(getDoc(doc(db("bob"), "users/alice/fcmTokens/tok")));
    await assertFails(setDoc(doc(db("bob"), "users/alice/fcmTokens/evil"), { token: "evil" }));
  });
});

describe("homes", () => {
  it("only members read a home", async () => {
    await assertSucceeds(getDoc(doc(db("alice"), "homes/h1")));
    await assertSucceeds(getDoc(doc(db("bob"), "homes/h1")));
    await assertFails(getDoc(doc(db("carol"), "homes/h1")));
    await assertFails(getDoc(doc(db("dave"), "homes/h1")));
    await assertFails(getDocs(query(collection(db("carol"), "homes"), where("displayId", "==", "ABC123"))));
  });
  it("a user can create a home only as its owner and sole member", async () => {
    await assertSucceeds(setDoc(doc(db("dave"), "homes/h4"), { name: "D", displayId: "DDDDDD", ownerId: "dave", memberIds: ["dave"], createdAt: when }));
    await assertFails(setDoc(doc(db("dave"), "homes/h5"), { name: "D", displayId: "DDDDD2", ownerId: "alice", memberIds: ["dave"], createdAt: when }));
    await assertFails(setDoc(doc(db("dave"), "homes/h6"), { name: "D", displayId: "DDDDD3", ownerId: "dave", memberIds: ["dave", "alice"], createdAt: when }));
  });
  it("only the owner updates a home, and cannot reassign ownership or the invite code", async () => {
    await assertSucceeds(updateDoc(doc(db("alice"), "homes/h1"), { name: "Renamed" }));
    await assertFails(updateDoc(doc(db("bob"), "homes/h1"), { name: "Bob's now" }));
    await assertFails(updateDoc(doc(db("alice"), "homes/h1"), { ownerId: "bob" }));
    await assertFails(updateDoc(doc(db("alice"), "homes/h1"), { displayId: "NEW123" }));
    await assertFails(deleteDoc(doc(db("alice"), "homes/h1")));
  });
  it("an outsider cannot add themselves to a home (joining goes through the joinHome callable)", async () => {
    await assertFails(updateDoc(doc(db("carol"), "homes/h1"), { memberIds: arrayUnion("carol") }));
    await assertFails(updateDoc(doc(db("dave"), "homes/h1"), { memberIds: ["dave"] }));
  });
  it("members read and write categories, budgets and tags; outsiders cannot", async () => {
    for (const path of ["categories/pets", "categoryBudgets/food", "tags/trip"]) {
      await assertSucceeds(getDoc(doc(db("bob"), `homes/h1/${path}`)));
      await assertFails(getDoc(doc(db("carol"), `homes/h1/${path}`)));
    }
    await assertSucceeds(setDoc(doc(db("bob"), "homes/h1/categories/garden"), { name: "Garden", icon: "yard", color: "#0f0", type: "expense" }));
    await assertSucceeds(setDoc(doc(db("bob"), "homes/h1/categoryBudgets/grocery"), { categoryId: "grocery", amount: 5000, updatedAt: when }));
    await assertSucceeds(deleteDoc(doc(db("alice"), "homes/h1/tags/trip")));
    await assertFails(setDoc(doc(db("carol"), "homes/h1/categoryBudgets/food"), { categoryId: "food", amount: 1, updatedAt: when }));
    await assertFails(setDoc(doc(db("carol"), "homes/h1/tags/x"), { name: "x" }));
    await assertFails(getDocs(collection(db("carol"), "homes/h1/categories")));
  });
});

describe("AI threads", () => {
  it("only the creator reads a thread, its messages and proposals", async () => {
    for (const path of ["aiThreads/th1", "aiThreads/th1/messages/m1", "aiThreads/th1/proposals/p1"]) {
      await assertSucceeds(getDoc(doc(db("alice"), `homes/h1/${path}`))); // creator
      await assertFails(getDoc(doc(db("bob"), `homes/h1/${path}`))); // same home, not the creator
      await assertFails(getDoc(doc(db("carol"), `homes/h1/${path}`))); // another home
      await assertFails(getDoc(doc(db("dave"), `homes/h1/${path}`))); // no home
      await assertFails(getDoc(doc(db(), `homes/h1/${path}`))); // signed out
    }
    await assertSucceeds(getDocs(query(collection(db("alice"), "homes/h1/aiThreads/th1/messages"), orderBy("createdAt"))));
    await assertFails(getDocs(query(collection(db("bob"), "homes/h1/aiThreads/th1/messages"), orderBy("createdAt"))));
    await assertSucceeds(getDocs(collection(db("alice"), "homes/h1/aiThreads/th1/proposals")));
    await assertFails(getDocs(collection(db("bob"), "homes/h1/aiThreads/th1/proposals")));
    await assertSucceeds(getDoc(doc(db("bob"), "homes/h1/aiThreads/thBob/messages/m1")));
    await assertFails(getDoc(doc(db("alice"), "homes/h1/aiThreads/thBob/messages/m1")));
  });
  it("a member lists only their own threads, newest first", async () => {
    const mine = (uid: string, home = "h1") =>
      query(collection(db(uid), `homes/${home}/aiThreads`), where("createdBy", "==", uid), orderBy("updatedAt", "desc"));
    await assertSucceeds(getDocs(mine("alice")));
    await assertSucceeds(getDocs(mine("bob")));
    await assertFails(getDocs(collection(db("alice"), "homes/h1/aiThreads"))); // unfiltered
    await assertFails(getDocs(query(collection(db("alice"), "homes/h1/aiThreads"), where("createdBy", "==", "bob"))));
    await assertFails(getDocs(mine("carol", "h1"))); // not a member
    await assertFails(getDocs(mine("dave", "h1")));
  });
  it("a former member loses access to their own threads", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "homes/h1"), { memberIds: ["alice"] });
    });
    await assertFails(getDoc(doc(db("bob"), "homes/h1/aiThreads/thBob")));
    await assertFails(getDoc(doc(db("bob"), "homes/h1/aiThreads/thBob/messages/m1")));
  });
  it("nothing under a thread is client-writable — only the server writes", async () => {
    const f = db("alice");
    await assertFails(setDoc(doc(f, "homes/h1/aiThreads/new"), { title: "x", createdBy: "alice", createdAt: when, updatedAt: when }));
    await assertFails(updateDoc(doc(f, "homes/h1/aiThreads/th1"), { title: "renamed" }));
    await assertFails(updateDoc(doc(f, "homes/h1/aiThreads/th1"), { "usage.questions": 0 }));
    await assertFails(deleteDoc(doc(f, "homes/h1/aiThreads/th1")));
    await assertFails(addDoc(collection(f, "homes/h1/aiThreads/th1/messages"), { role: "assistant", blocks: [{ type: "text", text: "forged" }], createdAt: when }));
    await assertFails(updateDoc(doc(f, "homes/h1/aiThreads/th1/messages/m1"), { blocks: [] }));
    await assertFails(deleteDoc(doc(f, "homes/h1/aiThreads/th1/messages/m1")));
    await assertFails(updateDoc(doc(f, "homes/h1/aiThreads/th1/proposals/p1"), { status: "applied" }));
    await assertFails(setDoc(doc(f, "homes/h1/aiThreads/th1/proposals/p2"), { action: "set_budget", status: "pending" }));
  });
});

describe("insights", () => {
  it("members read; nobody creates or deletes from the client", async () => {
    await assertSucceeds(getDoc(doc(db("bob"), "homes/h1/insights/i1")));
    await assertFails(getDoc(doc(db("carol"), "homes/h1/insights/i1")));
    await assertFails(setDoc(doc(db("alice"), "homes/h1/insights/i2"), { kind: "x", title: "t", body: "b", data: {}, periodKey: "p", createdAt: when, dismissedBy: [] }));
    await assertFails(deleteDoc(doc(db("alice"), "homes/h1/insights/i1")));
  });
  it("a member may only add or remove their own uid in dismissedBy", async () => {
    const ref = (uid: string) => doc(db(uid), "homes/h1/insights/i1");
    await assertSucceeds(updateDoc(ref("alice"), { dismissedBy: arrayUnion("alice") }));
    await assertSucceeds(updateDoc(ref("bob"), { dismissedBy: arrayUnion("bob") }));
    await assertSucceeds(updateDoc(ref("alice"), { dismissedBy: arrayRemove("alice") }));
    await assertFails(updateDoc(ref("alice"), { dismissedBy: arrayUnion("bob2") }));
    await assertFails(updateDoc(ref("alice"), { dismissedBy: arrayRemove("bob") }));
    await assertFails(updateDoc(ref("alice"), { dismissedBy: ["alice", "x"] }));
    await assertFails(updateDoc(ref("alice"), { title: "edited" }));
    await assertFails(updateDoc(ref("alice"), { dismissedBy: arrayUnion("alice"), body: "edited" }));
    await assertFails(updateDoc(doc(db("carol"), "homes/h1/insights/i1"), { dismissedBy: arrayUnion("carol") }));
  });
});

describe("reports (D-033)", () => {
  it("every member of the home reads its reports; other households and signed-out users do not", async () => {
    await assertSucceeds(getDoc(doc(db("alice"), "homes/h1/reports/monthly_2026-10")));
    await assertSucceeds(getDoc(doc(db("bob"), "homes/h1/reports/monthly_2026-10")));
    await assertSucceeds(getDocs(query(collection(db("bob"), "homes/h1/reports"), orderBy("createdAt", "desc"))));
    await assertFails(getDoc(doc(db("carol"), "homes/h1/reports/monthly_2026-10")));
    await assertFails(getDocs(collection(db("carol"), "homes/h1/reports")));
    await assertFails(getDoc(doc(db("dave"), "homes/h1/reports/monthly_2026-10")));
    await assertFails(getDoc(doc(db(), "homes/h1/reports/monthly_2026-10")));
  });
  it("clients cannot create, edit or delete reports", async () => {
    const report = { kind: "custom", period: { from: "2026-10-01", to: "2026-10-31" }, sections: {}, narrative: {}, createdBy: "alice", createdAt: when };
    await assertFails(setDoc(doc(db("alice"), "homes/h1/reports/r2"), report));
    await assertFails(addDoc(collection(db("alice"), "homes/h1/reports"), report));
    await assertFails(updateDoc(doc(db("alice"), "homes/h1/reports/monthly_2026-10"), { narrative: { headline: "forged" } }));
    await assertFails(deleteDoc(doc(db("alice"), "homes/h1/reports/monthly_2026-10")));
  });
});

describe("transactions", () => {
  it("household isolation on reads", async () => {
    await assertSucceeds(getDoc(doc(db("alice"), "transactions/tA")));
    await assertSucceeds(getDoc(doc(db("alice"), "transactions/tB"))); // a housemate's entry
    await assertFails(getDoc(doc(db("alice"), "transactions/tC")));
    await assertFails(getDoc(doc(db("carol"), "transactions/tA")));
    await assertFails(getDoc(doc(db("dave"), "transactions/tA")));
    await assertSucceeds(getDocs(query(collection(db("bob"), "transactions"), where("homeId", "==", "h1"), orderBy("date", "desc"))));
    await assertFails(getDocs(query(collection(db("carol"), "transactions"), where("homeId", "==", "h1"))));
    await assertFails(getDocs(collection(db("alice"), "transactions"))); // must be scoped to a home
    await assertFails(getDocs(query(collection(db("alice"), "transactions"), where("userId", "==", "alice"))));
  });
  it("a member creates entries only for themselves, in their own home, in the v2 shape", async () => {
    await assertSucceeds(setDoc(doc(db("alice"), "transactions/n1"), txDoc("alice", "h1")));
    await assertSucceeds(setDoc(doc(db("alice"), "transactions/n2"), txDoc("alice", "h1", { tagIds: ["trip"], type: "income" })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n3"), txDoc("bob", "h1"))); // someone else's name
    await assertFails(setDoc(doc(db("alice"), "transactions/n4"), txDoc("alice", "h2"))); // someone else's home
    await assertFails(setDoc(doc(db("dave"), "transactions/n5"), txDoc("dave", "h1")));
    await assertFails(setDoc(doc(db("alice"), "transactions/n6"), txDoc("alice", "h1", { date: "2026-10-05T06:30:00.000Z" }))); // v1 ISO string
    await assertFails(setDoc(doc(db("alice"), "transactions/n7"), txDoc("alice", "h1", { accountId: "cash" })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n8"), txDoc("alice", "h1", { embedding: [0.1] })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n9"), txDoc("alice", "h1", { amount: "250" })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n10"), txDoc("alice", "h1", { amount: -5 })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n11"), txDoc("alice", "h1", { type: "transfer" })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n12"), txDoc("alice", "h1", { tagIds: "trip" })));
    // Added from a bank message (D-029): only the value "sms" is allowed.
    await assertSucceeds(setDoc(doc(db("alice"), "transactions/n13"), txDoc("alice", "h1", { source: "sms" })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n14"), txDoc("alice", "h1", { source: "import" })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n15"), txDoc("alice", "h1", { source: null })));
    // Saved without asking (D-031): optional bool, only with source "sms".
    await assertSucceeds(setDoc(doc(db("alice"), "transactions/n16"), txDoc("alice", "h1", { source: "sms", autoAdded: true })));
    await assertSucceeds(setDoc(doc(db("alice"), "transactions/n17"), txDoc("alice", "h1", { source: "sms", autoAdded: false })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n18"), txDoc("alice", "h1", { source: "sms", autoAdded: "yes" })));
    await assertFails(setDoc(doc(db("alice"), "transactions/n19"), txDoc("alice", "h1", { autoAdded: true }))); // typed in
  });
  it("only the owner of an entry updates it", async () => {
    await assertSucceeds(updateDoc(doc(db("alice"), "transactions/tA"), { amount: 300, note: "Lunch + tea" }));
    await assertFails(updateDoc(doc(db("bob"), "transactions/tA"), { amount: 1 })); // housemate, not owner
    await assertFails(updateDoc(doc(db("carol"), "transactions/tA"), { amount: 1 }));
    await assertFails(updateDoc(doc(db("alice"), "transactions/tA"), { homeId: "h2" }));
    await assertFails(updateDoc(doc(db("alice"), "transactions/tA"), { userId: "bob" }));
    await assertFails(updateDoc(doc(db("alice"), "transactions/tA"), { date: "2026-10-05" }));
    await assertFails(updateDoc(doc(db("alice"), "transactions/tA"), { embedding: [1, 2] }));
    await assertSucceeds(updateDoc(doc(db("alice"), "transactions/tA"), { source: "sms" }));
    await assertSucceeds(updateDoc(doc(db("alice"), "transactions/tA"), { note: "Swiggy · HDFC XX1234" })); // keeps source
    await assertFails(updateDoc(doc(db("alice"), "transactions/tA"), { source: "manual" }));
  });
  it("only the owner clears the auto-added marker, and nobody sets it on an edit", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "transactions/tAuto"), txDoc("alice", "h1", { source: "sms", autoAdded: true }));
    });
    await assertFails(updateDoc(doc(db("bob"), "transactions/tAuto"), { autoAdded: deleteField() })); // housemate
    await assertFails(updateDoc(doc(db("alice"), "transactions/tAuto"), { autoAdded: "no" }));
    await assertSucceeds(updateDoc(doc(db("alice"), "transactions/tAuto"), { note: "Swiggy · HDFC XX1234" })); // keeps it
    await assertSucceeds(updateDoc(doc(db("alice"), "transactions/tAuto"), { autoAdded: false }));
    await assertFails(updateDoc(doc(db("alice"), "transactions/tAuto"), { autoAdded: true })); // cannot set it again
    await assertSucceeds(updateDoc(doc(db("alice"), "transactions/tAuto"), { autoAdded: deleteField() }));
    await assertFails(updateDoc(doc(db("alice"), "transactions/tA"), { source: "sms", autoAdded: true }));
  });
  it("only the owner of an entry deletes it", async () => {
    await assertFails(deleteDoc(doc(db("bob"), "transactions/tA")));
    await assertFails(deleteDoc(doc(db("carol"), "transactions/tA")));
    await assertSucceeds(deleteDoc(doc(db("alice"), "transactions/tA")));
  });
  it("a former member loses access", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "homes/h1"), { memberIds: ["alice"] });
    });
    await assertFails(getDoc(doc(db("bob"), "transactions/tB")));
    await assertFails(updateDoc(doc(db("bob"), "transactions/tB"), { amount: 1 }));
  });
});

describe("transactionEmbeddings", () => {
  it("is completely closed to clients, including members of the home", async () => {
    await assertFails(getDoc(doc(db("alice"), "transactionEmbeddings/tA")));
    await assertFails(getDocs(query(collection(db("alice"), "transactionEmbeddings"), where("homeId", "==", "h1"))));
    await assertFails(setDoc(doc(db("alice"), "transactionEmbeddings/tA"), { homeId: "h1", text: "x" }));
    await assertFails(setDoc(doc(db("alice"), "transactionEmbeddings/new"), { homeId: "h1", text: "x" }));
    await assertFails(updateDoc(doc(db("alice"), "transactionEmbeddings/tA"), { text: "x" }));
    await assertFails(deleteDoc(doc(db("alice"), "transactionEmbeddings/tA")));
  });
});

describe("aiUsage", () => {
  it("is server-only: no client reads or writes, not even the household's own row", async () => {
    await assertFails(getDoc(doc(db("alice"), "aiUsage/2026-10_h1")));
    await assertFails(getDoc(doc(db("carol"), "aiUsage/2026-10_h1")));
    await assertFails(getDocs(query(collection(db("alice"), "aiUsage"), where("homeId", "==", "h1"))));
    await assertFails(getDocs(collection(db("alice"), "aiUsage")));
    await assertFails(setDoc(doc(db("alice"), "aiUsage/2026-11_h1"), { month: "2026-11", homeId: "h1", questions: 0 }));
    await assertFails(updateDoc(doc(db("alice"), "aiUsage/2026-10_h1"), { questions: 0 }));
    await assertFails(deleteDoc(doc(db("alice"), "aiUsage/2026-10_h1")));
    await assertFails(getDoc(doc(db(), "aiUsage/2026-10_h1")));
  });
});

describe("aiRateLimits", () => {
  it("is server-only: a user cannot read or reset their own daily counter (D-032)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "aiRateLimits/2026-11-17_alice"), { day: "2026-11-17", uid: "alice", smsSuggestCalls: 100 });
    });
    await assertFails(getDoc(doc(db("alice"), "aiRateLimits/2026-11-17_alice")));
    await assertFails(setDoc(doc(db("alice"), "aiRateLimits/2026-11-17_alice"), { day: "2026-11-17", uid: "alice", smsSuggestCalls: 0 }));
    await assertFails(deleteDoc(doc(db("alice"), "aiRateLimits/2026-11-17_alice")));
    await assertFails(getDocs(collection(db("alice"), "aiRateLimits")));
  });
});

describe("notifications", () => {
  it("members read their household's notifications only", async () => {
    await assertSucceeds(getDoc(doc(db("bob"), "notifications/n1")));
    await assertFails(getDoc(doc(db("carol"), "notifications/n1")));
    await assertSucceeds(getDocs(query(collection(db("bob"), "notifications"), where("homeId", "==", "h1"), orderBy("createdAt", "desc"))));
    await assertFails(getDocs(query(collection(db("bob"), "notifications"), where("homeId", "==", "h2"))));
    await assertFails(getDocs(collection(db("bob"), "notifications")));
  });
  it("clients cannot create or delete notifications (the server trigger writes them)", async () => {
    await assertFails(addDoc(collection(db("alice"), "notifications"), { type: "transaction_added", message: "spam", homeId: "h1", createdBy: "alice", createdByName: "Alice", createdAt: when, readBy: [] }));
    await assertFails(deleteDoc(doc(db("alice"), "notifications/n1")));
  });
  it("the only client update is adding your own uid to readBy", async () => {
    await assertSucceeds(updateDoc(doc(db("bob"), "notifications/n1"), { readBy: arrayUnion("bob") }));
    await assertSucceeds(updateDoc(doc(db("alice"), "notifications/n1"), { readBy: arrayUnion("alice") }));
    await assertFails(updateDoc(doc(db("bob"), "notifications/n1"), { readBy: arrayUnion("alice2") }));
    await assertFails(updateDoc(doc(db("bob"), "notifications/n1"), { readBy: [] }));
    await assertFails(updateDoc(doc(db("bob"), "notifications/n1"), { message: "edited" }));
    await assertFails(updateDoc(doc(db("bob"), "notifications/n1"), { readBy: arrayUnion("bob"), homeId: "h2" }));
    await assertFails(updateDoc(doc(db("carol"), "notifications/n1"), { readBy: arrayUnion("carol") }));
  });
});
