import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export interface JoinHomeResult {
  id: string;
  name: string;
  displayId: string;
  ownerId: string;
  memberIds: string[];
}

/** Join a household by its 6-character invite code. */
export async function joinHomeHandler(db: Firestore, uid: string, data: unknown): Promise<JoinHomeResult> {
  const raw = (data as { displayId?: unknown } | null)?.displayId;
  if (typeof raw !== "string" || !raw.trim() || raw.length > 32) {
    throw new HttpsError("invalid-argument", "Missing displayId");
  }
  const code = raw.trim();

  const homes = db.collection("homes");
  let snap = await homes.where("displayId", "==", code).limit(1).get();
  if (snap.empty && code !== code.toUpperCase()) {
    snap = await homes.where("displayId", "==", code.toUpperCase()).limit(1).get();
  }
  if (snap.empty) throw new HttpsError("not-found", "Home not found with this invite code.");

  const homeRef = snap.docs[0].ref;
  return db.runTransaction(async (tx) => {
    const home = await tx.get(homeRef);
    if (!home.exists) throw new HttpsError("not-found", "Home not found with this invite code.");
    const d = home.data() ?? {};
    const memberIds: string[] = Array.isArray(d.memberIds) ? d.memberIds.map(String) : [];
    if (!memberIds.includes(uid)) memberIds.push(uid);
    tx.update(homeRef, { memberIds: FieldValue.arrayUnion(uid) });
    tx.set(db.collection("users").doc(uid), { homeId: homeRef.id }, { merge: true });
    return {
      id: homeRef.id,
      name: String(d.name ?? ""),
      displayId: String(d.displayId ?? ""),
      ownerId: String(d.ownerId ?? ""),
      memberIds,
    };
  });
}
