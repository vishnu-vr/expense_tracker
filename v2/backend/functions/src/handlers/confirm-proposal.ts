import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { DEFAULT_CATEGORIES } from "../core/categories";
import { MAX_PROPOSAL_TRANSACTIONS } from "../core/proposals";
import { resolveHome } from "../data/home";

export interface ConfirmProposalResult {
  proposalId: string;
  status: "applied" | "rejected";
  /** Documents changed (1 for set_budget). */
  appliedCount: number;
  /** Transactions left untouched: missing, in another home, or not owned by the caller. */
  skippedTransactionIds: string[];
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Apply or reject a pending proposal created by the agent. This is the ONLY
 * place agent-suggested changes reach user data, and it enforces the same
 * rules as firestore.rules: caller must be a home member, and may only change
 * transactions they own.
 */
export async function confirmProposalHandler(db: Firestore, uid: string, data: unknown): Promise<ConfirmProposalResult> {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.threadId !== "string" || !ID_RE.test(d.threadId)) throw new HttpsError("invalid-argument", "Invalid threadId.");
  if (typeof d.proposalId !== "string" || !ID_RE.test(d.proposalId)) throw new HttpsError("invalid-argument", "Invalid proposalId.");
  if (typeof d.accept !== "boolean") throw new HttpsError("invalid-argument", "accept must be true or false.");
  const { threadId, proposalId, accept } = d as { threadId: string; proposalId: string; accept: boolean };

  const home = await resolveHome(db, uid);
  const homeRef = db.collection("homes").doc(home.homeId);
  const proposalRef = homeRef.collection("aiThreads").doc(threadId).collection("proposals").doc(proposalId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(proposalRef);
    if (!snap.exists) throw new HttpsError("not-found", "Proposal not found.");
    const p = snap.data() ?? {};
    if (p.status !== "pending") {
      throw new HttpsError("failed-precondition", `This suggestion was already ${String(p.status)}.`);
    }
    const resolved = { resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp() };

    if (!accept) {
      tx.update(proposalRef, { status: "rejected", ...resolved });
      return { proposalId, status: "rejected" as const, appliedCount: 0, skippedTransactionIds: [] };
    }

    const params = (p.params ?? {}) as Record<string, unknown>;
    const categoryType = async (categoryId: string): Promise<"income" | "expense" | null> => {
      const custom = await tx.get(homeRef.collection("categories").doc(categoryId));
      if (custom.exists) return custom.get("type") === "income" ? "income" : "expense";
      return DEFAULT_CATEGORIES.find((c) => c.id === categoryId)?.type ?? null;
    };

    if (p.action === "set_budget") {
      const categoryId = String(params.categoryId ?? "");
      const amount = Number(params.amount);
      if (!ID_RE.test(categoryId) || !Number.isFinite(amount) || amount <= 0) {
        throw new HttpsError("failed-precondition", "This suggestion is no longer valid.");
      }
      if ((await categoryType(categoryId)) !== "expense") {
        throw new HttpsError("failed-precondition", "That category no longer exists.");
      }
      tx.set(homeRef.collection("categoryBudgets").doc(categoryId), {
        categoryId,
        amount,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(proposalRef, { status: "applied", ...resolved, result: { appliedCount: 1, skippedTransactionIds: [] } });
      return { proposalId, status: "applied" as const, appliedCount: 1, skippedTransactionIds: [] };
    }

    if (p.action !== "tag_transactions" && p.action !== "recategorise") {
      throw new HttpsError("failed-precondition", "Unknown suggestion type.");
    }
    const ids = (Array.isArray(params.transactionIds) ? params.transactionIds.map(String) : [])
      .filter((id) => ID_RE.test(id))
      .slice(0, MAX_PROPOSAL_TRANSACTIONS);
    if (ids.length === 0) throw new HttpsError("failed-precondition", "This suggestion is no longer valid.");

    let targetType: "income" | "expense" | null = null;
    let update: Record<string, unknown>;
    if (p.action === "tag_transactions") {
      const tagId = String(params.tagId ?? "");
      const tag = ID_RE.test(tagId) ? await tx.get(homeRef.collection("tags").doc(tagId)) : null;
      if (!tag?.exists) throw new HttpsError("failed-precondition", "That tag no longer exists.");
      update = { tagIds: FieldValue.arrayUnion(tagId) };
    } else {
      const categoryId = String(params.categoryId ?? "");
      targetType = ID_RE.test(categoryId) ? await categoryType(categoryId) : null;
      if (!targetType) throw new HttpsError("failed-precondition", "That category no longer exists.");
      update = { categoryId };
    }

    const refs = ids.map((id) => db.collection("transactions").doc(id));
    const docs = await tx.getAll(...refs);
    const skipped: string[] = [];
    let applied = 0;
    for (const doc of docs) {
      const t = doc.data();
      const allowed =
        doc.exists &&
        t?.homeId === home.homeId && // household isolation
        t?.userId === uid && // only the owner may change an entry
        (targetType === null || t?.type === targetType);
      if (!allowed) {
        skipped.push(doc.id);
        continue;
      }
      tx.update(doc.ref, { ...update, updatedAt: FieldValue.serverTimestamp() });
      applied++;
    }
    if (applied === 0) {
      throw new HttpsError(
        "permission-denied",
        "None of these entries can be changed by you. Only the member who added an entry can change it.",
      );
    }
    tx.update(proposalRef, {
      status: "applied",
      ...resolved,
      result: { appliedCount: applied, skippedTransactionIds: skipped },
    });
    return { proposalId, status: "applied" as const, appliedCount: applied, skippedTransactionIds: skipped };
  });
}
