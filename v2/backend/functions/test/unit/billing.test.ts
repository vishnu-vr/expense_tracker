import { describe, expect, it } from "vitest";
import {
  BillingRows,
  forecastMonthEnd,
  groupOther,
  parseMonth,
  shapeBilling,
  shapeUsage,
  usageAvailable,
} from "../../src/core/billing";
import { nextClaims, parseSetAdminArgs } from "../../src/scripts/set-admin";

const IST = 330;
// 10 Nov 2026, 21:00 IST.
const now = new Date("2026-11-10T15:30:00Z");
const opts = { topServices: 3, offsetMinutes: IST };

function rows(partial: Partial<BillingRows> = {}): BillingRows {
  return {
    services: [
      { service: "Vertex AI", cost: 120.5, credits: -20.5 },
      { service: "Cloud Firestore", cost: 40, credits: 0 },
      { service: "Cloud Run Functions", cost: 12.25, credits: 0 },
      { service: "Cloud Build", cost: 3, credits: 0 },
      { service: "Artifact Registry", cost: 1.5, credits: 0 },
    ],
    skus: [
      { service: "Cloud Firestore", sku: "Read ops", cost: 30, credits: 0, usage: 300000, unit: "count" },
      { service: "Vertex AI", sku: "Gemini input tokens", cost: 100, credits: -20, usage: 4.2, unit: "1M tokens" },
    ],
    daily: [
      { date: "2026-11-02", cost: 20, credits: -2 },
      { date: "2026-11-01", cost: 10, credits: 0 },
    ],
    totals: [
      { invoiceMonth: "202611", currency: "INR", cost: 177.25, credits: -20.5, exportTime: "2026-11-10T09:00:00Z" },
      { invoiceMonth: "202610", currency: "INR", cost: 300, credits: -50, exportTime: "2026-11-01T09:00:00Z" },
    ],
    ...partial,
  };
}

describe("parseMonth", () => {
  it("returns the IST bounds of the month", () => {
    const w = parseMonth("2026-11", now, IST)!;
    expect(w.invoiceMonth).toBe("202611");
    expect(w.previousInvoiceMonth).toBe("202610");
    expect(w.start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(w.daysInMonth).toBe(30);
  });

  it("wraps January to the previous December", () => {
    expect(parseMonth("2026-01", now, IST)!.previousInvoiceMonth).toBe("202512");
  });

  it("rejects malformed and future months", () => {
    for (const bad of ["2026-13", "2026-1", "26-11", "", null, 202611, "2026-12", "2019-05"]) {
      expect(parseMonth(bad, now, IST)).toBeNull();
    }
  });

  it("uses India time for the current month", () => {
    // 30 Nov 19:00 UTC is already 1 Dec in India.
    expect(parseMonth("2026-12", new Date("2026-11-30T19:00:00Z"), IST)).not.toBeNull();
  });
});

describe("shapeBilling", () => {
  const w = parseMonth("2026-11", now, IST)!;

  it("computes gross, credits and net from the month totals", () => {
    const b = shapeBilling(rows(), w, now, opts);
    if (!b.configured) throw new Error("expected configured");
    expect(b.gross).toBe(177.25);
    expect(b.credits).toBe(-20.5);
    expect(b.net).toBe(156.75);
    expect(b.currency).toBe("INR");
    expect(b.dataAsOf).toBe("2026-11-10T09:00:00Z");
    expect(b.previousMonthNet).toBe(250);
  });

  it("forecasts the current month from the daily average", () => {
    const b = shapeBilling(rows(), w, now, opts);
    if (!b.configured) throw new Error("expected configured");
    // 156.75 over 10 days × 30 days.
    expect(b.forecastNet).toBe(470.25);
    expect(b.changeVsPreviousMonth).toBe(220.25);
  });

  it("has no forecast for a past month and compares actuals", () => {
    const later = new Date("2026-12-05T10:00:00Z");
    const b = shapeBilling(rows(), parseMonth("2026-11", later, IST)!, later, opts);
    if (!b.configured) throw new Error("expected configured");
    expect(b.forecastNet).toBeNull();
    expect(b.changeVsPreviousMonth).toBe(-93.25);
  });

  it("groups small services into Other and sorts by net", () => {
    const b = shapeBilling(rows(), w, now, opts);
    if (!b.configured) throw new Error("expected configured");
    expect(b.byService).toEqual([
      { service: "Vertex AI", amount: 100 },
      { service: "Cloud Firestore", amount: 40 },
      { service: "Cloud Run Functions", amount: 12.25 },
      { service: "Other", amount: 4.5 },
    ]);
  });

  it("orders SKUs by gross cost and daily by date", () => {
    const b = shapeBilling(rows(), w, now, opts);
    if (!b.configured) throw new Error("expected configured");
    expect(b.topSkus[0]).toEqual({ service: "Vertex AI", sku: "Gemini input tokens", amount: 80, usage: 4.2, unit: "1M tokens" });
    expect(b.daily).toEqual([
      { date: "2026-11-01", amount: 10 },
      { date: "2026-11-02", amount: 18 },
    ]);
  });

  it("reports no_data for an empty month", () => {
    expect(shapeBilling({ services: [], skus: [], daily: [], totals: [] }, w, now, opts)).toEqual({
      configured: false,
      reason: "no_data",
    });
  });

  it("has no previous month when it was not exported", () => {
    const b = shapeBilling(rows({ totals: [rows().totals[0]] }), w, now, opts);
    if (!b.configured) throw new Error("expected configured");
    expect(b.previousMonthNet).toBeNull();
    expect(b.changeVsPreviousMonth).toBeNull();
  });
});

describe("helpers", () => {
  it("groupOther keeps a single leftover by name", () => {
    const r = [{ amount: 3 }, { amount: 1 }, { amount: 2 }];
    expect(groupOther(r, 2, (amount) => ({ amount }))).toEqual([{ amount: 3 }, { amount: 2 }, { amount: 1 }]);
    expect(groupOther([...r, { amount: 0.5 }], 2, (amount) => ({ amount }))).toEqual([{ amount: 3 }, { amount: 2 }, { amount: 1.5 }]);
  });

  it("forecast is null outside the month", () => {
    const w = parseMonth("2026-10", now, IST)!;
    expect(forecastMonthEnd(100, w, now, IST)).toBeNull();
  });

  it("usage is available only within Monitoring retention", () => {
    expect(usageAvailable(parseMonth("2026-10", now, IST)!, now, 42)).toBe(true);
    expect(usageAvailable(parseMonth("2026-09", now, IST)!, now, 42)).toBe(false);
  });
});

describe("shapeUsage", () => {
  it("sums tokens per model and requests per function", () => {
    const u = shapeUsage({
      tokens: [
        { model: "gemini-3.8-flash", type: "input", count: 1000 },
        { model: "gemini-3.8-flash", type: "output", count: 200 },
        { model: "gemini-embedding-001", type: "input", count: 5000 },
        { model: "unused", type: "input", count: 0 },
      ],
      requests: [
        { service: "joinhome", count: 2 },
        { service: "askagent", count: 10 },
        { service: "askagent", count: 1 },
      ],
      firestore: { reads: 30492, writes: 120, deletes: 3 },
    });
    expect(u.available).toBe(true);
    expect(u.assistantQuestions).toBe(11);
    expect(u.functionCalls).toEqual([
      { name: "askagent", count: 11 },
      { name: "joinhome", count: 2 },
    ]);
    expect(u.tokens).toEqual([
      { model: "gemini-embedding-001", input: 5000, output: 0 },
      { model: "gemini-3.8-flash", input: 1000, output: 200 },
    ]);
    expect(u.firestore).toEqual({ reads: 30492, writes: 120, deletes: 3 });
  });
});

describe("set-admin CLI", () => {
  it("previews by default and needs project and email", () => {
    expect(parseSetAdminArgs(["--project", "p", "--email", "a@b.c"])).toEqual({ project: "p", email: "a@b.c", revoke: false, execute: false });
    expect(() => parseSetAdminArgs(["--email", "a@b.c"])).toThrow(/Usage/);
    expect(() => parseSetAdminArgs(["--project", "public-exp-tracker", "--email", "a@b.c"])).toThrow(/v1/);
  });

  it("keeps other claims", () => {
    expect(nextClaims('{"beta":true}', false)).toEqual({ beta: true, admin: true });
    expect(nextClaims('{"beta":true,"admin":true}', true)).toEqual({ beta: true });
    expect(nextClaims(undefined, false)).toEqual({ admin: true });
  });
});
