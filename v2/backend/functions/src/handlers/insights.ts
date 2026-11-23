import { FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { toLocalDay } from "../core/dates";
import { InsightCard, runDetectors } from "../core/insights/detectors";
import { phraseCards, Phraser } from "../core/insights/phrasing";
import { monthlyReportId } from "../core/report";
import { loadHomeData } from "../data/home";

export interface InsightsRunResult {
  detected: number;
  created: number;
  updated: number;
  unchanged: number;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );

/**
 * Write detector output to homes/{homeId}/insights idempotently: the doc id
 * is the card's stable id, so re-running never duplicates. An existing card
 * only has its content refreshed (createdAt and dismissedBy are preserved).
 */
export async function writeInsightCards(db: Firestore, homeId: string, cards: InsightCard[]): Promise<InsightsRunResult> {
  const col = db.collection("homes").doc(homeId).collection("insights");
  const result: InsightsRunResult = { detected: cards.length, created: 0, updated: 0, unchanged: 0 };
  if (cards.length === 0) return result;

  const existing = await db.getAll(...cards.map((c) => col.doc(c.id)));
  const batch = db.batch();
  cards.forEach((c, i) => {
    const snap = existing[i];
    if (!snap.exists) {
      batch.set(col.doc(c.id), {
        kind: c.kind,
        title: c.title,
        body: c.body,
        data: c.data,
        periodKey: c.periodKey,
        createdAt: FieldValue.serverTimestamp(),
        dismissedBy: [],
      });
      result.created++;
    } else if (
      snap.get("title") !== c.title ||
      snap.get("body") !== c.body ||
      stable(snap.get("data")) !== stable(c.data)
    ) {
      batch.update(col.doc(c.id), { title: c.title, body: c.body, data: c.data });
      result.updated++;
    } else {
      result.unchanged++;
    }
  });
  if (result.created + result.updated > 0) await batch.commit();
  return result;
}

export async function generateInsightsForHome(
  db: Firestore,
  home: { homeId: string; memberIds: string[] },
  timeZone: string,
  now: Date,
  phraser?: Phraser | null,
): Promise<InsightsRunResult> {
  const data = await loadHomeData(db, home, timeZone);
  const cards = await phraseCards(runDetectors(data, toLocalDay(now, timeZone)), phraser);
  // A month's review card links to that month's report when there is one (D-033).
  const linked = await Promise.all(
    cards.map(async (c) => {
      if (c.kind !== "month_review") return c;
      const reportId = monthlyReportId(c.periodKey);
      const report = await db.collection("homes").doc(home.homeId).collection("reports").doc(reportId).get();
      return report.exists ? { ...c, data: { ...c.data, reportId } } : c;
    }),
  );
  return writeInsightCards(db, home.homeId, linked);
}

const RETENTION_DAYS = 180;

/** Daily job: every home, one after another; a failing home does not stop the rest. */
export async function generateAllInsights(
  db: Firestore,
  timeZone: string,
  now: Date,
  phraser?: Phraser | null,
  onHomeError?: (homeId: string, error: unknown) => void,
): Promise<{ homes: number; failed: number } & InsightsRunResult> {
  const total = { homes: 0, failed: 0, detected: 0, created: 0, updated: 0, unchanged: 0 };
  const cutoff = Timestamp.fromMillis(now.getTime() - RETENTION_DAYS * 86400000);
  const homes = await db.collection("homes").select("memberIds").get();
  for (const doc of homes.docs) {
    total.homes++;
    try {
      const memberIds = ((doc.get("memberIds") ?? []) as unknown[]).map(String);
      const r = await generateInsightsForHome(db, { homeId: doc.id, memberIds }, timeZone, now, phraser);
      total.detected += r.detected;
      total.created += r.created;
      total.updated += r.updated;
      total.unchanged += r.unchanged;
      const old = await doc.ref.collection("insights").where("createdAt", "<", cutoff).limit(200).get();
      if (!old.empty) {
        const batch = db.batch();
        old.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (e) {
      total.failed++;
      onHomeError?.(doc.id, e);
    }
  }
  return total;
}
