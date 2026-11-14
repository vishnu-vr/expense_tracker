import { HttpsError } from "firebase-functions/v2/https";
import { BILLING_LIMITS } from "../config";
import { AssistantUsageSummary, EMPTY_ASSISTANT_USAGE, HouseholdUsageRow, shapeAssistantUsage } from "../core/ai-usage";
import {
  BillingSummary,
  EMPTY_USAGE,
  parseMonth,
  shapeBilling,
  shapeUsage,
  UsageSummary,
  usageAvailable,
} from "../core/billing";
import { readBillingRows, readUsageSeries, RestClient } from "../data/billing";

export interface AdminDashboard {
  month: string;
  billing: BillingSummary;
  usage: UsageSummary;
  /** From the server-only `aiUsage` rollup (D-025). */
  assistant: AssistantUsageSummary;
}

export interface AdminDashboardDeps {
  api: RestClient;
  projectId: string;
  dataset: string;
  location: string;
  now: () => Date;
  /** Per-month results, kept for BILLING_LIMITS.cacheMs. Shared across calls in one instance. */
  cache: Map<string, { at: number; value: AdminDashboard }>;
  /** The month's `aiUsage` rows with household names (data/ai-usage.ts). Omitted: assistant.available is false. */
  readAssistantUsage?: (month: string) => Promise<HouseholdUsageRow[]>;
  onError?: (part: "billing" | "usage" | "assistant", error: unknown) => void;
}

export interface CallerAuth {
  uid: string;
  token: Record<string, unknown>;
}

/** getAdminDashboard({month: "YYYY-MM"}): Google Cloud costs, usage and assistant usage for one month. Admins only. */
export async function adminDashboardHandler(
  deps: AdminDashboardDeps,
  auth: CallerAuth | undefined,
  data: unknown,
): Promise<AdminDashboard> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  if (auth.token?.admin !== true) throw new HttpsError("permission-denied", "Admins only.");

  const now = deps.now();
  const window = parseMonth((data as { month?: unknown } | null)?.month, now, BILLING_LIMITS.utcOffsetMinutes);
  if (!window) throw new HttpsError("invalid-argument", "month must be YYYY-MM and not in the future.");
  if (!deps.projectId) throw new HttpsError("failed-precondition", "Billing project is not configured.");

  const cached = deps.cache.get(window.month);
  if (cached && now.getTime() - cached.at < BILLING_LIMITS.cacheMs) return cached.value;

  const withUsage = usageAvailable(window, now, BILLING_LIMITS.usageRetentionDays);
  const usageEnd = now < window.end ? now : window.end;
  const [billingResult, usageResult, assistantResult] = await Promise.allSettled([
    readBillingRows(deps.api, window, {
      projectId: deps.projectId,
      dataset: deps.dataset,
      location: deps.location,
      topSkus: BILLING_LIMITS.topSkus,
      timeZone: BILLING_LIMITS.timeZone,
    }),
    withUsage ? readUsageSeries(deps.api, deps.projectId, window.start, usageEnd) : Promise.resolve(null),
    deps.readAssistantUsage ? deps.readAssistantUsage(window.month) : Promise.resolve(null),
  ]);

  if (billingResult.status === "rejected") deps.onError?.("billing", billingResult.reason);
  if (usageResult.status === "rejected") deps.onError?.("usage", usageResult.reason);
  if (assistantResult.status === "rejected") deps.onError?.("assistant", assistantResult.reason);
  if (billingResult.status === "rejected" && usageResult.status === "rejected") {
    throw new HttpsError("unavailable", "Could not read billing or usage. Try again.");
  }

  let billing: BillingSummary;
  if (billingResult.status === "rejected") billing = { configured: false, reason: "unavailable" };
  else if (billingResult.value === null) billing = { configured: false, reason: "not_set_up" };
  else {
    billing = shapeBilling(billingResult.value, window, now, {
      topServices: BILLING_LIMITS.topServices,
      offsetMinutes: BILLING_LIMITS.utcOffsetMinutes,
    });
  }

  const usage: UsageSummary =
    usageResult.status === "fulfilled" && usageResult.value ? shapeUsage(usageResult.value) : EMPTY_USAGE;

  const assistant: AssistantUsageSummary =
    assistantResult.status === "fulfilled" && assistantResult.value ? shapeAssistantUsage(assistantResult.value) : EMPTY_ASSISTANT_USAGE;

  const value: AdminDashboard = { month: window.month, billing, usage, assistant };
  // Partial failures are not cached, so a retry tries again.
  if (billingResult.status === "fulfilled" && usageResult.status === "fulfilled" && assistantResult.status === "fulfilled") {
    deps.cache.set(window.month, { at: now.getTime(), value });
  }
  return value;
}
