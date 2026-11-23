/**
 * Run the monthly report job (D-033) by hand for one household, for example
 * after a failed run or to try it before the 1st. Same code as the scheduled
 * `generateMonthlyReports`: last month's report (`monthly_YYYY-MM`) compared
 * with the month before, written with the default model; a rerun updates the
 * same report and never notifies a member twice.
 *
 *   EVAL_ACCESS_TOKEN=<token> npm run monthly-report -- --project expense-tracker-v2-5c9fa --home <homeId>                    # preview
 *   EVAL_ACCESS_TOKEN=<token> npm run monthly-report -- --project expense-tracker-v2-5c9fa --home <homeId> --month 2026-10 --execute
 *
 * Preview reads the household and prints which sections the report would
 * have (no model call, no writes). `--execute` calls the model (billed, about
 * ₹1) and writes the report and the members' notifications. The token is a
 * short-lived OAuth token for the owner (see operations.md); it is never
 * printed. The narrative is never printed or logged.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAgentRuntime, useAccessTokenForVertex } from "../agent/models";
import { genkitNarrativeGenerate } from "../agent/report-writer";
import { agentModelId, defaultTimeZone, resolveAgentModel } from "../config";
import { resolveComparison } from "../core/compare";
import { addMonths, monthKey, monthRange, toLocalDay } from "../core/dates";
import { buildReport, hasEntries } from "../core/report";
import { loadHomeData } from "../data/home";
import { generateMonthlyReports } from "../handlers/reports";

const V1_PROJECTS = new Set(["expense-tracker-e7ff7", "public-exp-tracker"]);

async function main() {
  const argv = process.argv.slice(2);
  let project = "";
  let home = "";
  let month = "";
  let execute = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") project = argv[++i] ?? "";
    else if (argv[i] === "--home") home = argv[++i] ?? "";
    else if (argv[i] === "--month") month = argv[++i] ?? "";
    else if (argv[i] === "--execute") execute = true;
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  if (!project || !home) throw new Error("Usage: npm run monthly-report -- --project <id> --home <homeId> [--month YYYY-MM] [--execute]");
  if (V1_PROJECTS.has(project)) throw new Error("Refusing to touch a v1 project.");
  if (month && !/^\d{4}-\d{2}$/.test(month)) throw new Error("--month must be YYYY-MM.");
  const token = process.env.EVAL_ACCESS_TOKEN;
  if (!token) throw new Error("Set EVAL_ACCESS_TOKEN (see operations.md › Run the model eval).");

  initializeApp({
    projectId: project,
    credential: { getAccessToken: async () => ({ access_token: token, expires_in: 3000 }) },
  });
  useAccessTokenForVertex(token, project);
  const db = getFirestore();
  const tz = defaultTimeZone();
  // The job reports on the month before "now": 07:00 IST on the 1st of the next month.
  const target = month || addMonths(monthKey(toLocalDay(new Date(), tz)), -1);
  const next = addMonths(target, 1);
  const now = new Date(`${next}-01T01:30:00Z`);

  const homeSnap = await db.collection("homes").doc(home).get();
  if (!homeSnap.exists) throw new Error(`No home ${home}.`);
  const memberIds = ((homeSnap.get("memberIds") ?? []) as unknown[]).map(String);
  const data = await loadHomeData(db, { homeId: home, memberIds }, tz);
  const range = monthRange(target);
  if (!hasEntries(data, range)) {
    console.log(`No entries in ${target}; the job would skip this home.`);
    return;
  }
  const body = buildReport(data, range, resolveComparison(range, "previous"), toLocalDay(now, tz));
  console.log(`monthly_${target} for ${home}: sections ${Object.keys(body.sections).join(", ")}; ${memberIds.length} members to notify (once).`);
  if (!execute) {
    console.log("Preview only. Add --execute to write it (one billed model call).");
    return;
  }
  const result = await generateMonthlyReports(
    {
      db,
      resolveModel: (key) => resolveAgentModel(key),
      narrator: async (id) => {
        const { ai, model } = await getAgentRuntime(id);
        return genkitNarrativeGenerate(ai, model);
      },
      onMetrics: (m) => console.log(`Written: ${m.reportId}, narrative ${m.narrativeSource}, ${m.inputTokens} in / ${m.outputTokens} out tokens`),
    },
    tz,
    now,
    (_homeId, error) => console.error(`Failed: ${(error as Error)?.name ?? "error"}`),
    [home],
  );
  console.log(`Done with ${agentModelId()}:`, result);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
