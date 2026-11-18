import { Firestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { categoryNameLookup } from "../core/categories";
import { buildTransactionsCsv } from "../core/csv";
import { dayBoundary, isValidDay, isValidTimeZone } from "../core/dates";
import { loadCategories, loadMembers, loadTags, resolveHome, toDate } from "../data/home";

export interface ExportCsvResult {
  csv: string;
  filename: string;
  count: number;
}

function dateArg(value: unknown, label: string): string {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", `Missing ${label}. Use YYYY-MM-DD.`);
  if (!isValidDay(value)) throw new HttpsError("invalid-argument", `Invalid ${label}. Use YYYY-MM-DD.`);
  return value;
}

/** Export the caller's household transactions in [from, to] (calendar days in `timeZone`) as CSV. */
export async function exportTransactionsCsvHandler(db: Firestore, uid: string, data: unknown): Promise<ExportCsvResult> {
  const input = (data ?? {}) as { from?: unknown; to?: unknown; timeZone?: unknown };
  const from = dateArg(input.from, "from");
  const to = dateArg(input.to, "to");
  if (from > to) throw new HttpsError("invalid-argument", "from cannot be after to.");
  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : "UTC";

  const home = await resolveHome(db, uid);
  const snap = await db
    .collection("transactions")
    .where("homeId", "==", home.homeId)
    .where("date", ">=", Timestamp.fromDate(dayBoundary(from, false, timeZone)))
    .where("date", "<=", Timestamp.fromDate(dayBoundary(to, true, timeZone)))
    .orderBy("date", "asc")
    .get();

  const userIds = [...new Set([...home.memberIds, ...snap.docs.map((d) => String(d.get("userId") ?? "")).filter(Boolean)])];
  const [categories, tags, users] = await Promise.all([
    loadCategories(db, home.homeId),
    loadTags(db, home.homeId),
    loadMembers(db, userIds),
  ]);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const csv = buildTransactionsCsv(
    snap.docs.map((doc) => {
      const d = doc.data();
      return {
        amount: typeof d.amount === "number" ? d.amount : undefined,
        categoryId: d.categoryId,
        date: toDate(d.date) ?? undefined,
        note: d.note,
        type: d.type,
        userId: d.userId,
        userEmail: d.userEmail,
        tagIds: Array.isArray(d.tagIds) ? d.tagIds : [],
      };
    }),
    {
      categoryName: categoryNameLookup(categories),
      userName: (id) => userName.get(id) ?? id,
      tagName: (id) => tagName.get(id) ?? id,
    },
    timeZone,
  );
  return { csv, filename: `transactions_${from}_to_${to}.csv`, count: snap.size };
}
