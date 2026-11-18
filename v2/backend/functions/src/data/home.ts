import type { DocumentSnapshot, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { mergeCategories } from "../core/categories";
import { prepareTransactions } from "../core/prepare";
import { Budget, Category, HomeData, Member, Tag, Tx } from "../core/types";

export interface ResolvedHome {
  homeId: string;
  name: string;
  memberIds: string[];
}

/**
 * The caller's household, resolved server-side. `users/{uid}.homeId` is
 * client-writable, so it is only a pointer: the home's own `memberIds` is the
 * authority. A user who points their profile at someone else's home gets nothing.
 */
export async function resolveHome(db: Firestore, uid: string): Promise<ResolvedHome> {
  const userSnap = await db.collection("users").doc(uid).get();
  const homeId = userSnap.data()?.homeId;
  if (typeof homeId !== "string" || !homeId) {
    throw new HttpsError("failed-precondition", "User does not belong to a home.");
  }
  const homeSnap = await db.collection("homes").doc(homeId).get();
  const memberIds = (homeSnap.data()?.memberIds ?? []) as unknown;
  if (!homeSnap.exists || !Array.isArray(memberIds) || !memberIds.includes(uid)) {
    throw new HttpsError("permission-denied", "User is not a member of this home.");
  }
  return { homeId, name: String(homeSnap.data()?.name ?? ""), memberIds: memberIds.map(String) };
}

/** Firestore Timestamp (v2) or ISO string / Date (tolerated) -> Date. */
export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function txFromDoc(doc: DocumentSnapshot | QueryDocumentSnapshot): Tx | null {
  const d = doc.data();
  if (!d) return null;
  const date = toDate(d.date);
  const amount = Number(d.amount);
  if (!date || !Number.isFinite(amount)) return null;
  return {
    id: doc.id,
    amount,
    categoryId: typeof d.categoryId === "string" ? d.categoryId : "",
    date,
    note: typeof d.note === "string" ? d.note : undefined,
    type: d.type === "income" ? "income" : "expense",
    userId: typeof d.userId === "string" ? d.userId : "",
    userEmail: typeof d.userEmail === "string" ? d.userEmail : undefined,
    tagIds: Array.isArray(d.tagIds) ? d.tagIds.map(String) : [],
  };
}

export async function loadCategories(db: Firestore, homeId: string): Promise<Category[]> {
  const snap = await db.collection("homes").doc(homeId).collection("categories").get();
  return mergeCategories(
    snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        name: typeof d.name === "string" && d.name ? d.name : doc.id,
        type: d.type === "income" ? ("income" as const) : ("expense" as const),
        icon: typeof d.icon === "string" ? d.icon : undefined,
        color: typeof d.color === "string" ? d.color : undefined,
      };
    }),
  );
}

export async function loadTags(db: Firestore, homeId: string): Promise<Tag[]> {
  const snap = await db.collection("homes").doc(homeId).collection("tags").get();
  return snap.docs.map((doc) => ({ id: doc.id, name: String(doc.data().name ?? doc.id) }));
}

export async function loadMembers(db: Firestore, memberIds: string[]): Promise<Member[]> {
  if (memberIds.length === 0) return [];
  const snaps = await db.getAll(...memberIds.map((id) => db.collection("users").doc(id)));
  return snaps.map((s) => {
    const d = s.data() ?? {};
    const email = typeof d.email === "string" ? d.email : undefined;
    return { id: s.id, name: (typeof d.name === "string" && d.name) || email || "Member", email };
  });
}

/** Load everything the tools / detectors need for one household. */
export async function loadHomeData(
  db: Firestore,
  home: Pick<ResolvedHome, "homeId" | "memberIds">,
  timeZone: string,
): Promise<HomeData> {
  const homeRef = db.collection("homes").doc(home.homeId);
  const [txSnap, categories, budgetSnap, tags, members] = await Promise.all([
    db.collection("transactions").where("homeId", "==", home.homeId).get(),
    loadCategories(db, home.homeId),
    homeRef.collection("categoryBudgets").get(),
    loadTags(db, home.homeId),
    loadMembers(db, home.memberIds),
  ]);
  const budgets: Budget[] = budgetSnap.docs
    .map((doc) => ({ categoryId: String(doc.data().categoryId ?? doc.id), amount: Number(doc.data().amount) }))
    .filter((b) => Number.isFinite(b.amount));
  const transactions = prepareTransactions(
    txSnap.docs.map(txFromDoc).filter((t): t is Tx => t !== null),
    timeZone,
  );
  return { transactions, categories, budgets, tags, members };
}
