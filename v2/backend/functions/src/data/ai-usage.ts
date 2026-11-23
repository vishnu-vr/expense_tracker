import { Firestore } from "firebase-admin/firestore";
import { AI_USAGE } from "../config";
import { countOf, HouseholdUsageRow } from "../core/ai-usage";

/**
 * The monthly assistant rollup (`aiUsage/{YYYY-MM}_{homeId}`) for one month,
 * with each household's name from `homes/{homeId}`. Counts and names only:
 * thread titles and message text are never read here.
 */
export async function readAssistantUsage(db: Firestore, month: string): Promise<HouseholdUsageRow[]> {
  const snap = await db.collection("aiUsage").where("month", "==", month).limit(AI_USAGE.maxRollupDocs).get();
  if (snap.empty) return [];
  const homeIds = [...new Set(snap.docs.map((d) => d.get("homeId")).filter((id): id is string => typeof id === "string" && !!id))];
  const homes = homeIds.length ? await db.getAll(...homeIds.map((id) => db.collection("homes").doc(id)), { fieldMask: ["name"] }) : [];
  const names = new Map(homes.map((h) => [h.id, typeof h.get("name") === "string" ? (h.get("name") as string) : ""]));
  return snap.docs
    .filter((d) => typeof d.get("homeId") === "string")
    .map((d) => ({
      homeId: d.get("homeId") as string,
      homeName: names.get(d.get("homeId") as string) || "Deleted household",
      questions: countOf(d.get("questions")),
      inputTokens: countOf(d.get("inputTokens")),
      outputTokens: countOf(d.get("outputTokens")),
      modelCalls: countOf(d.get("modelCalls")),
      smsSuggestions: countOf(d.get("smsSuggestions")),
      smsInputTokens: countOf(d.get("smsInputTokens")),
      smsOutputTokens: countOf(d.get("smsOutputTokens")),
      reports: countOf(d.get("reports")),
      reportInputTokens: countOf(d.get("reportInputTokens")),
      reportOutputTokens: countOf(d.get("reportOutputTokens")),
    }));
}
