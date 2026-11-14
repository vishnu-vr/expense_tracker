import { describe, expect, it } from "vitest";
import { GoogleApiError, RestClient } from "../../src/data/billing";
import { AdminDashboardDeps, adminDashboardHandler } from "../../src/handlers/admin-dashboard";

const now = new Date("2026-11-10T15:30:00Z");
const admin = { uid: "u1", token: { admin: true } };

/** BigQuery `jobs.query` style response with scalar columns. */
function bq(fields: string[], rows: unknown[][]) {
  return {
    jobComplete: true,
    jobReference: { jobId: "j1", location: "US" },
    schema: { fields: fields.map((name) => ({ name })) },
    rows: rows.map((r) => ({ f: r.map((v) => ({ v: v === null ? null : String(v) })) })),
  };
}

function series(labels: Record<string, string>, value: number, metricLabels: Record<string, string> = {}) {
  return { metric: { labels: metricLabels }, resource: { labels }, points: [{ value: { int64Value: String(value) } }] };
}

type Mode = "ok" | "missing" | "error";

/** Fake Google APIs: answers BigQuery by query text and Monitoring by metric. */
function fakeApi(billing: Mode, usage: "ok" | "error" = "ok") {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const api: RestClient = {
    async request(method, url, body) {
      calls.push({ method, url, body });
      if (url.includes("bigquery.googleapis.com")) {
        if (billing === "missing") {
          throw new GoogleApiError(404, "Not found: Dataset expense-tracker-v2-5c9fa:billing_export", "notFound");
        }
        if (billing === "error") throw new GoogleApiError(403, "Access Denied", "accessDenied");
        const q = (body as { query: string }).query;
        if (q.includes("invoice.month IN")) {
          return bq(
            ["invoice_month", "currency", "cost", "credits", "export_time"],
            [
              ["202611", "INR", 150, -10, "2026-11-10T09:00:00Z"],
              ["202610", "INR", 200, 0, "2026-11-01T09:00:00Z"],
            ],
          );
        }
        if (q.includes("FORMAT_DATE")) return bq(["date", "cost", "credits"], [["2026-11-01", 15, -1]]);
        if (q.includes("sku.description")) {
          return bq(["service", "sku", "cost", "credits", "usage", "unit"], [["Vertex AI", "Gemini output", 90, -10, 1.5, "1M tokens"]]);
        }
        return bq(["service", "cost", "credits"], [["Vertex AI", 100, -10], ["Cloud Firestore", 50, 0]]);
      }
      if (url.includes("monitoring.googleapis.com")) {
        if (usage === "error") throw new GoogleApiError(503, "unavailable");
        const filter = new URL(url).searchParams.get("filter") ?? "";
        if (filter.includes("token_count")) {
          return { timeSeries: [series({ model_user_id: "gemini-3.8-flash" }, 900, { type: "input" }), series({ model_user_id: "gemini-3.8-flash" }, 100, { type: "output" })] };
        }
        if (filter.includes("request_count")) return { timeSeries: [series({ service_name: "askagent" }, 7)] };
        if (filter.includes("read_ops")) return { timeSeries: [series({}, 1234)] };
        return {};
      }
      throw new Error(`unexpected ${url}`);
    },
  };
  return { api, calls };
}

function deps(api: RestClient, extra: Partial<AdminDashboardDeps> = {}): AdminDashboardDeps {
  return { api, projectId: "expense-tracker-v2-5c9fa", dataset: "billing_export", location: "US", now: () => now, cache: new Map(), ...extra };
}

describe("getAdminDashboard", () => {
  it("rejects signed-out and non-admin callers", async () => {
    const { api, calls } = fakeApi("ok");
    await expect(adminDashboardHandler(deps(api), undefined, { month: "2026-11" })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(adminDashboardHandler(deps(api), { uid: "u2", token: {} }, { month: "2026-11" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(adminDashboardHandler(deps(api), { uid: "u2", token: { admin: "true" } }, { month: "2026-11" })).rejects.toMatchObject({ code: "permission-denied" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a bad or future month", async () => {
    const { api } = fakeApi("ok");
    await expect(adminDashboardHandler(deps(api), admin, { month: "2026-12" })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(adminDashboardHandler(deps(api), admin, {})).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("returns billing and usage for the month", async () => {
    const { api, calls } = fakeApi("ok");
    const r = await adminDashboardHandler(deps(api), admin, { month: "2026-11" });
    expect(r.month).toBe("2026-11");
    expect(r.billing).toMatchObject({ configured: true, currency: "INR", gross: 150, credits: -10, net: 140, previousMonthNet: 200, forecastNet: 420 });
    if (!r.billing.configured) throw new Error("expected configured");
    expect(r.billing.byService).toEqual([{ service: "Vertex AI", amount: 90 }, { service: "Cloud Firestore", amount: 50 }]);
    expect(r.billing.daily).toEqual([{ date: "2026-11-01", amount: 14 }]);
    expect(r.usage).toMatchObject({ available: true, assistantQuestions: 7, firestore: { reads: 1234, writes: 0, deletes: 0 } });
    expect(r.usage.tokens).toEqual([{ model: "gemini-3.8-flash", input: 900, output: 100 }]);

    // Queries are parameterised and run in the export's location.
    const q = calls.find((c) => c.url.includes("bigquery"))!.body as { location: string; queryParameters: { name: string; parameterValue: { value: string } }[] };
    expect(q.location).toBe("US");
    expect(q.queryParameters).toContainEqual({ name: "month", parameterType: { type: "STRING" }, parameterValue: { value: "202611" } });
  });

  it("says not set up when the export is missing, and still returns usage", async () => {
    const { api } = fakeApi("missing");
    const r = await adminDashboardHandler(deps(api), admin, { month: "2026-11" });
    expect(r.billing).toEqual({ configured: false, reason: "not_set_up" });
    expect(r.usage.available).toBe(true);
    expect(r.usage.assistantQuestions).toBe(7);
  });

  it("returns usage when billing fails, and billing when usage fails", async () => {
    const errors: string[] = [];
    const a = await adminDashboardHandler(deps(fakeApi("error").api, { onError: (p) => errors.push(p) }), admin, { month: "2026-11" });
    expect(a.billing).toEqual({ configured: false, reason: "unavailable" });
    expect(a.usage.available).toBe(true);
    const b = await adminDashboardHandler(deps(fakeApi("ok", "error").api, { onError: (p) => errors.push(p) }), admin, { month: "2026-11" });
    expect(b.billing.configured).toBe(true);
    expect(b.usage.available).toBe(false);
    expect(errors).toEqual(["billing", "usage"]);
  });

  it("adds the assistant section from the aiUsage rollup, sorted by tokens", async () => {
    const { api } = fakeApi("ok");
    const months: string[] = [];
    const r = await adminDashboardHandler(
      deps(api, {
        readAssistantUsage: async (month) => {
          months.push(month);
          return [
            { homeId: "h1", homeName: "Sharma", questions: 3, inputTokens: 1000, outputTokens: 100, modelCalls: 6 },
            { homeId: "h2", homeName: "Iyer", questions: 1, inputTokens: 5000, outputTokens: 50, modelCalls: 2 },
          ];
        },
      }),
      admin,
      { month: "2026-11" },
    );
    expect(months).toEqual(["2026-11"]);
    expect(r.assistant).toEqual({
      available: true, questions: 4, inputTokens: 6000, outputTokens: 150, modelCalls: 8, activeHouseholds: 2,
      byHousehold: [
        { homeId: "h2", homeName: "Iyer", questions: 1, inputTokens: 5000, outputTokens: 50 },
        { homeId: "h1", homeName: "Sharma", questions: 3, inputTokens: 1000, outputTokens: 100 },
      ],
    });
  });

  it("an assistant read failure leaves billing and usage, and is not cached", async () => {
    const { api } = fakeApi("ok");
    const errors: string[] = [];
    let fail = true;
    const d = deps(api, {
      onError: (p) => errors.push(p),
      readAssistantUsage: async () => {
        if (fail) throw new Error("boom");
        return [];
      },
    });
    const a = await adminDashboardHandler(d, admin, { month: "2026-11" });
    expect(a.assistant.available).toBe(false);
    expect(a.billing.configured).toBe(true);
    expect(errors).toEqual(["assistant"]);
    fail = false;
    const b = await adminDashboardHandler(d, admin, { month: "2026-11" });
    expect(b.assistant).toMatchObject({ available: true, questions: 0, byHousehold: [] });
  });

  it("adds per-household entry counts for the month window, busiest first", async () => {
    const { api } = fakeApi("ok");
    const windows: string[] = [];
    const r = await adminDashboardHandler(
      deps(api, {
        readHouseholdActivity: async (start, end) => {
          windows.push(`${start.toISOString()}..${end.toISOString()}`);
          return [
            { homeId: "h1", homeName: "Sharma", members: 2, entries: 2424, entriesInMonth: 40, lastEntryAt: "2026-11-09T10:00:00.000Z" },
            { homeId: "h2", homeName: "Iyer", members: 1, entries: 97, entriesInMonth: 0, lastEntryAt: "2026-09-01T10:00:00.000Z" },
            { homeId: "h3", homeName: "New", members: 1, entries: 0, entriesInMonth: 0, lastEntryAt: null },
          ];
        },
      }),
      admin,
      { month: "2026-11" },
    );
    // November in India time: 31 Oct 18:30 UTC to 30 Nov 18:30 UTC.
    expect(windows).toEqual(["2026-10-31T18:30:00.000Z..2026-11-30T18:30:00.000Z"]);
    expect(r.households).toMatchObject({ available: true, households: 3, entries: 2521, entriesInMonth: 40, activeInMonth: 1 });
    expect(r.households.byHousehold.map((h) => h.homeId)).toEqual(["h1", "h2", "h3"]);
  });

  it("a household read failure leaves the rest, and is not cached", async () => {
    const { api } = fakeApi("ok");
    const errors: string[] = [];
    let fail = true;
    const d = deps(api, {
      onError: (p) => errors.push(p),
      readHouseholdActivity: async () => {
        if (fail) throw new Error("boom");
        return [];
      },
    });
    const a = await adminDashboardHandler(d, admin, { month: "2026-11" });
    expect(a.households.available).toBe(false);
    expect(a.billing.configured).toBe(true);
    expect(errors).toEqual(["households"]);
    fail = false;
    const b = await adminDashboardHandler(d, admin, { month: "2026-11" });
    expect(b.households).toMatchObject({ available: true, households: 0, byHousehold: [] });
  });

  it("without a rollup reader the assistant section is unavailable", async () => {
    const r = await adminDashboardHandler(deps(fakeApi("ok").api), admin, { month: "2026-11" });
    expect(r.assistant).toMatchObject({ available: false, questions: 0, byHousehold: [] });
  });

  it("fails when both reads fail", async () => {
    await expect(adminDashboardHandler(deps(fakeApi("error", "error").api), admin, { month: "2026-11" })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("skips Monitoring for months older than its retention", async () => {
    const { api, calls } = fakeApi("ok");
    const r = await adminDashboardHandler(deps(api), admin, { month: "2026-08" });
    expect(r.usage.available).toBe(false);
    expect(calls.some((c) => c.url.includes("monitoring"))).toBe(false);
  });

  it("caches a month for 15 minutes", async () => {
    const { api, calls } = fakeApi("ok");
    let t = now.getTime();
    const d = deps(api, { now: () => new Date(t) });
    await adminDashboardHandler(d, admin, { month: "2026-11" });
    const first = calls.length;
    t += 10 * 60_000;
    await adminDashboardHandler(d, admin, { month: "2026-11" });
    expect(calls.length).toBe(first);
    t += 6 * 60_000;
    await adminDashboardHandler(d, admin, { month: "2026-11" });
    expect(calls.length).toBe(first * 2);
  });
});
