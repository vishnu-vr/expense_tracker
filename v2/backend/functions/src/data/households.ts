import { Firestore, Timestamp } from "firebase-admin/firestore";
import { HouseholdActivityRow } from "../core/households";

/** Upper bound on households read for the dashboard (a household-scale app). */
const MAX_HOMES = 500;

function toIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

/**
 * For every household: name, member count, total entries, entries dated in
 * [start, end), and the latest entry date up to `now` (entries dated in the
 * future, such as EMIs entered ahead, are counted but are not the "last
 * entry"). Uses count() aggregations and one single-document read per
 * household (index homeId + date desc). No amounts, notes or other entry
 * content are read.
 */
export async function readHouseholdActivity(
  db: Firestore,
  start: Date,
  end: Date,
  now: Date = new Date(),
): Promise<HouseholdActivityRow[]> {
  const homes = await db.collection("homes").select("name", "memberIds").limit(MAX_HOMES).get();
  const tx = db.collection("transactions");
  return Promise.all(
    homes.docs.map(async (home) => {
      const mine = tx.where("homeId", "==", home.id);
      const [all, inMonth, last] = await Promise.all([
        mine.count().get(),
        mine.where("date", ">=", Timestamp.fromDate(start)).where("date", "<", Timestamp.fromDate(end)).count().get(),
        mine.where("date", "<=", Timestamp.fromDate(now)).orderBy("date", "desc").limit(1).select("date").get(),
      ]);
      const members = home.get("memberIds");
      return {
        homeId: home.id,
        homeName: typeof home.get("name") === "string" && home.get("name") ? (home.get("name") as string) : "Unnamed household",
        members: Array.isArray(members) ? members.length : 0,
        entries: all.data().count,
        entriesInMonth: inMonth.data().count,
        lastEntryAt: last.empty ? null : toIso(last.docs[0].get("date")),
      };
    }),
  );
}
