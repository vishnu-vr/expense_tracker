import { FieldValue, Firestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { NarrativeGenerate, NarrativeResult, writeNarrative } from "../agent/report-writer";
import { AGENT_MODEL_KEY_PATTERN, agentModelLabel, AI_USAGE, REPORTS } from "../config";
import { aiUsageDocId, countOf, usageMonth } from "../core/ai-usage";
import { ComparisonMode, resolveComparison } from "../core/compare";
import { addMonths, isValidTimeZone, monthKey, monthLabel, monthRange, toLocalDay } from "../core/dates";
import { buildReport, hasEntries, monthlyReportId, parseReportPeriod, ReportBody, ReportRequestError } from "../core/report";
import { HomeData } from "../core/types";
import { loadHomeData, resolveHome } from "../data/home";

export interface ReportDeps {
  db: Firestore;
  /** The model id for a D-027 key (missing or unknown → the default). */
  resolveModel: (key?: string) => string;
  /** A narrative generator for a model id. Lazy: no credentials until a report is written. */
  narrator: (modelId: string) => Promise<NarrativeGenerate>;
  now?: () => Date;
  /** Counts, ids and outcomes only: never the prompt, the facts or the narrative. */
  onMetrics?: (m: ReportMetrics) => void;
}

export interface ReportMetrics {
  reportId: string;
  kind: "monthly" | "custom";
  model: string;
  narrativeSource: "model" | "template";
  fallbackReason: NarrativeResult["fallbackReason"];
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  latencyMs: number;
}

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function invalid(message: string): never {
  throw new HttpsError("invalid-argument", message);
}

function parseCommon(data: unknown): { timeZone: string; model?: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!isValidTimeZone(d.timeZone)) invalid("timeZone must be an IANA time zone, e.g. Asia/Kolkata.");
  if (d.model !== undefined && d.model !== null && (typeof d.model !== "string" || !AGENT_MODEL_KEY_PATTERN.test(d.model))) {
    invalid("Invalid model.");
  }
  return { timeZone: d.timeZone as string, model: (d.model as string | undefined) || undefined };
}

/** Count one on-demand report against the caller's daily allowance, before any model runs. */
async function countReportCall(db: Firestore, uid: string, now: Date): Promise<void> {
  const day = toLocalDay(now, AI_USAGE.timeZone);
  const ref = db.collection("aiRateLimits").doc(`${day}_${uid}`);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const calls = countOf(snap.get("reportCalls"));
    if (calls >= REPORTS.dailyCallsPerUser) {
      throw new HttpsError("resource-exhausted", `You can make ${REPORTS.dailyCallsPerUser} reports a day. Try again tomorrow.`);
    }
    t.set(ref, { day, uid, reportCalls: calls + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

/** Firestore rejects `undefined`; the report is plain JSON data anyway. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Written {
  body: ReportBody;
  narrative: NarrativeResult;
  modelId: string;
  latencyMs: number;
}

/** Build the figures and the narrative for a period. */
async function compose(
  deps: ReportDeps,
  data: HomeData,
  period: { from: string; to: string },
  compare: { mode: ComparisonMode; from?: string; to?: string },
  today: string,
  modelId: string,
): Promise<Written> {
  const started = Date.now();
  const resolved = resolveComparison(
    period,
    compare.mode,
    compare.mode === "custom" && compare.from && compare.to ? { from: compare.from, to: compare.to } : null,
    REPORTS.averagePeriods,
  );
  const body = buildReport(data, period, resolved, today);
  let generate: NarrativeGenerate;
  try {
    generate = await deps.narrator(modelId);
  } catch {
    generate = async () => {
      throw new Error("model unavailable");
    };
  }
  const narrative = await writeNarrative(body, generate);
  return { body, narrative, modelId, latencyMs: Date.now() - started };
}

function reportFields(w: Written, timeZone: string) {
  const usedModel = w.narrative.source === "model";
  return plain({
    period: { from: w.body.period.from, to: w.body.period.to, label: w.body.period.label, days: w.body.period.days, shape: w.body.period.shape },
    compare: w.body.compare,
    sections: w.body.sections,
    narrative: w.narrative.narrative,
    narrativeSource: w.narrative.source,
    model: usedModel ? w.modelId : null,
    modelLabel: usedModel ? agentModelLabel(w.modelId) : null,
    timeZone,
    schemaVersion: 1,
  });
}

async function countUsage(db: Firestore, homeId: string, now: Date, w: Written): Promise<void> {
  const month = usageMonth(now, AI_USAGE.timeZone);
  await db.collection("aiUsage").doc(aiUsageDocId(month, homeId)).set(
    {
      month,
      homeId,
      reports: FieldValue.increment(1),
      reportInputTokens: FieldValue.increment(w.narrative.usage.inputTokens),
      reportOutputTokens: FieldValue.increment(w.narrative.usage.outputTokens),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function metrics(reportId: string, kind: "monthly" | "custom", w: Written): ReportMetrics {
  return {
    reportId,
    kind,
    model: w.modelId,
    narrativeSource: w.narrative.source,
    fallbackReason: w.narrative.fallbackReason,
    ...w.narrative.usage,
    latencyMs: w.latencyMs,
  };
}

/**
 * generateReport({from, to, compare: {mode, from?, to?}, timeZone, model?}) -> {reportId}
 * An on-demand report for the caller's household, written with the caller's
 * assistant model (D-027 key). At most `REPORTS.dailyCallsPerUser` per user
 * per India-time day, shared with refreshReport.
 */
export async function generateReportHandler(deps: ReportDeps, uid: string, data: unknown): Promise<{ reportId: string }> {
  const { timeZone, model } = parseCommon(data);
  const now = deps.now?.() ?? new Date();
  const today = toLocalDay(now, timeZone);
  let req;
  try {
    req = parseReportPeriod(data, today, REPORTS.maxDays);
  } catch (e) {
    if (e instanceof ReportRequestError) invalid(e.message);
    throw e;
  }
  const { db } = deps;
  const home = await resolveHome(db, uid);
  await countReportCall(db, uid, now);

  const homeData = await loadHomeData(db, home, timeZone);
  const w = await compose(deps, homeData, req, req.compare, today, deps.resolveModel(model));
  const ref = db.collection("homes").doc(home.homeId).collection("reports").doc();
  await ref.set({
    kind: "custom",
    ...reportFields(w, timeZone),
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    generatedAt: FieldValue.serverTimestamp(),
    generatedBy: uid,
  });
  await countUsage(db, home.homeId, now, w);
  deps.onMetrics?.(metrics(ref.id, "custom", w));
  return { reportId: ref.id };
}

/**
 * refreshReport({reportId, timeZone, model?}) -> {reportId}
 * Rebuilds a report of the caller's household in place, for the same period
 * and comparison, so entries added since are included. Same daily allowance.
 */
export async function refreshReportHandler(deps: ReportDeps, uid: string, data: unknown): Promise<{ reportId: string }> {
  const { timeZone, model } = parseCommon(data);
  const reportId = (data as Record<string, unknown> | null)?.reportId;
  if (typeof reportId !== "string" || !REPORT_ID.test(reportId)) invalid("Invalid reportId.");
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const home = await resolveHome(db, uid);
  const ref = db.collection("homes").doc(home.homeId).collection("reports").doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
  const period = snap.get("period") as { from?: unknown; to?: unknown } | undefined;
  const stored = snap.get("compare") as { mode?: unknown; from?: unknown; to?: unknown } | null | undefined;
  if (typeof period?.from !== "string" || typeof period?.to !== "string") throw new HttpsError("failed-precondition", "This report cannot be refreshed.");
  const compare = stored && typeof stored.mode === "string"
    ? { mode: stored.mode as ComparisonMode, from: stored.from as string | undefined, to: stored.to as string | undefined }
    : { mode: "none" as ComparisonMode };
  await countReportCall(db, uid, now);

  const homeData = await loadHomeData(db, home, timeZone);
  const w = await compose(deps, homeData, { from: period.from, to: period.to }, compare, toLocalDay(now, timeZone), deps.resolveModel(model));
  const kind = snap.get("kind") === "monthly" ? "monthly" : "custom";
  await ref.update({ ...reportFields(w, timeZone), generatedAt: FieldValue.serverTimestamp(), generatedBy: uid });
  await countUsage(db, home.homeId, now, w);
  deps.onMetrics?.(metrics(reportId, kind, w));
  return { reportId };
}

export interface MonthlyRunResult {
  homes: number;
  written: number;
  skipped: number;
  failed: number;
  notifications: number;
  deleted: number;
}

/** "Your October report is ready" notifications, one per member, created once. */
async function notifyMembers(db: Firestore, homeId: string, memberIds: string[], month: string, reportId: string): Promise<number> {
  const name = monthLabel(month).split(" ")[0];
  let created = 0;
  for (const uid of memberIds) {
    try {
      await db.collection("notifications").doc(`report_${homeId}_${month}_${uid}`).create({
        type: "report_ready",
        title: `Your ${name} report is ready`,
        message: `Your ${monthLabel(month)} report is ready. See what changed.`,
        reportId,
        recipientId: uid,
        homeId,
        createdBy: "system",
        createdByName: "Track Expense",
        createdAt: FieldValue.serverTimestamp(),
        readBy: [],
      });
      created++;
    } catch (e) {
      // ALREADY_EXISTS (6): a rerun does not notify again.
      if ((e as { code?: unknown }).code !== 6) throw e;
    }
  }
  return created;
}

/**
 * Monthly job (07:00 on the 1st, India time): last month's report for every
 * home that has entries in it, compared with the month before, written with
 * the default model. Stable id `monthly_YYYY-MM`, so a rerun updates the
 * same report and sends no second notification. One home failing does not
 * stop the rest. Also deletes custom reports older than the retention.
 */
export async function generateMonthlyReports(
  deps: ReportDeps,
  timeZone: string,
  now: Date,
  onHomeError?: (homeId: string, error: unknown) => void,
  /** Only these homes (running the job by hand for one household). */
  homeIds?: string[],
): Promise<MonthlyRunResult> {
  const { db } = deps;
  const today = toLocalDay(now, timeZone);
  const month = addMonths(monthKey(today), -1);
  const range = monthRange(month);
  const reportId = monthlyReportId(month);
  const cutoff = Timestamp.fromMillis(now.getTime() - REPORTS.customRetentionDays * 86400000);
  const total: MonthlyRunResult = { homes: 0, written: 0, skipped: 0, failed: 0, notifications: 0, deleted: 0 };
  const homes = await db.collection("homes").select("memberIds").get();
  for (const doc of homes.docs) {
    if (homeIds && !homeIds.includes(doc.id)) continue;
    total.homes++;
    try {
      const reports = doc.ref.collection("reports");
      const old = await reports.where("createdAt", "<", cutoff).limit(200).get();
      const stale = old.docs.filter((d) => d.get("kind") !== "monthly");
      if (stale.length) {
        const batch = db.batch();
        stale.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        total.deleted += stale.length;
      }

      const memberIds = ((doc.get("memberIds") ?? []) as unknown[]).map(String);
      const data = await loadHomeData(db, { homeId: doc.id, memberIds }, timeZone);
      if (!hasEntries(data, range)) {
        total.skipped++;
        continue;
      }
      const w = await compose(deps, data, range, { mode: "previous" }, today, deps.resolveModel());
      const ref = reports.doc(reportId);
      const existing = await ref.get();
      const fields = { kind: "monthly", ...reportFields(w, timeZone), generatedAt: FieldValue.serverTimestamp(), generatedBy: "system" };
      if (existing.exists) await ref.update(fields);
      else await ref.set({ ...fields, createdBy: "system", createdAt: FieldValue.serverTimestamp() });
      await countUsage(db, doc.id, now, w);
      total.written++;

      // The month's review card links to the report (insights run at 06:00).
      const card = doc.ref.collection("insights").doc(`month_review_${month}`);
      if ((await card.get()).exists) await card.update({ "data.reportId": reportId });

      total.notifications += await notifyMembers(db, doc.id, memberIds, month, reportId);
      deps.onMetrics?.(metrics(`${doc.id}/${reportId}`, "monthly", w));
    } catch (e) {
      total.failed++;
      onHomeError?.(doc.id, e);
    }
  }
  return total;
}
