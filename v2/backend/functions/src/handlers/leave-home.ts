import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

export interface LeaveHomeResult {
  homeId: string;
  /** New owner's uid when the caller owned the home and other members remain; otherwise null. */
  ownershipTransferredTo: string | null;
}

/**
 * Leave the caller's current home (clients cannot do this themselves: only
 * the owner may update a home doc). One transaction:
 *  - remove the caller from `memberIds` and clear `users/{uid}.homeId`;
 *  - if the caller was the owner and members remain, the first remaining
 *    member (in `memberIds` order) becomes the owner;
 *  - if nobody remains, the home and its data are left in place;
 *  - a stale pointer (home missing, or not listing the caller) is just cleared.
 * The caller's transactions stay with the household, unchanged.
 */
export async function leaveHomeHandler(db: Firestore, uid: string): Promise<LeaveHomeResult> {
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    const homeId = user.data()?.homeId;
    if (typeof homeId !== "string" || !homeId) {
      throw new HttpsError("failed-precondition", "User does not belong to a home.");
    }
    const homeRef = db.collection("homes").doc(homeId);
    const home = await tx.get(homeRef);
    const memberIds: string[] = Array.isArray(home.data()?.memberIds) ? home.data()!.memberIds.map(String) : [];

    tx.update(userRef, { homeId: FieldValue.delete() });
    if (!home.exists || !memberIds.includes(uid)) {
      return { homeId, ownershipTransferredTo: null };
    }

    const remaining = memberIds.filter((id) => id !== uid);
    const newOwner = home.data()?.ownerId === uid && remaining.length > 0 ? remaining[0] : null;
    tx.update(homeRef, { memberIds: remaining, ...(newOwner ? { ownerId: newOwner } : {}) });
    return { homeId, ownershipTransferredTo: newOwner };
  });
}
