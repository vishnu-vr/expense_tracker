import { describe, expect, it } from "vitest";
import {
  aiUsageDocId, countOf, messagePreview, messageUsage, shapeAssistantUsage, usageIncrement, usageMonth,
} from "../../src/core/ai-usage";

describe("assistant usage helpers", () => {
  it("counts are non-negative whole numbers", () => {
    expect(countOf(12)).toBe(12);
    expect(countOf(12.6)).toBe(13);
    expect(countOf(-3)).toBe(0);
    expect(countOf(Number.NaN)).toBe(0);
    expect(countOf(undefined)).toBe(0);
    expect(countOf("7")).toBe(0);
  });

  it("builds the message usage and the per-answer increment", () => {
    expect(messageUsage({ inputTokens: 6600, outputTokens: 210, modelCalls: 2 }, "vertexai/gemini-3.8-flash", 9712.4)).toEqual({
      inputTokens: 6600, outputTokens: 210, modelCalls: 2, model: "vertexai/gemini-3.8-flash", latencyMs: 9712,
    });
    expect(messageUsage({ inputTokens: -1, outputTokens: Number.NaN, modelCalls: 0 }, "", 0)).toEqual({
      inputTokens: 0, outputTokens: 0, modelCalls: 0, model: "unknown", latencyMs: 0,
    });
    expect(usageIncrement({ inputTokens: 10, outputTokens: 5, modelCalls: 1 })).toEqual({ questions: 1, inputTokens: 10, outputTokens: 5, modelCalls: 1 });
  });

  it("months are India time", () => {
    expect(usageMonth(new Date("2026-10-31T18:29:00Z"), "Asia/Kolkata")).toBe("2026-10"); // 23:59 IST
    expect(usageMonth(new Date("2026-10-31T18:31:00Z"), "Asia/Kolkata")).toBe("2026-11"); // 00:01 IST
    expect(usageMonth(new Date("2026-12-31T20:00:00Z"), "Asia/Kolkata")).toBe("2027-01");
    expect(aiUsageDocId("2026-11", "h1")).toBe("2026-11_h1");
  });

  it("previews the first text block, collapsed and cut at 80 characters", () => {
    expect(messagePreview([{ type: "stat", label: "Spent", value: "₹5,000" }, { type: "text", text: "  Groceries\nwere   up. " }])).toBe("Groceries were up.");
    const long = "x".repeat(200);
    const p = messagePreview([{ type: "text", text: long }]);
    expect(p).toHaveLength(80);
    expect(p.endsWith("…")).toBe(true);
    expect(messagePreview([{ type: "text", text: "a".repeat(80) }])).toBe("a".repeat(80));
    expect(messagePreview([{ type: "stat", label: "Spent in October", value: "₹5,000.50" }])).toBe("Spent in October: ₹5,000.50");
    expect(messagePreview([{ type: "proposal", proposalId: "p", action: "set_budget", summary: "s" }])).toBe("");
    expect(messagePreview([{ type: "text", text: "Hello world" }], 6)).toBe("Hello…");
  });

  it("shapes the admin view: totals, active households, sorted by tokens", () => {
    const s = shapeAssistantUsage([
      { homeId: "h1", homeName: "Sharma", questions: 4, inputTokens: 20000, outputTokens: 800, modelCalls: 9 },
      { homeId: "h2", homeName: "", questions: 9, inputTokens: 60000, outputTokens: 2000, modelCalls: 20 },
      { homeId: "h3", homeName: "Idle", questions: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0 },
      { homeId: "h4", homeName: "Tie", questions: 5, inputTokens: 20000, outputTokens: 800, modelCalls: 9 },
    ]);
    expect(s).toEqual({
      available: true,
      questions: 18,
      inputTokens: 100000,
      outputTokens: 3600,
      modelCalls: 38,
      activeHouseholds: 3,
      byHousehold: [
        { homeId: "h2", homeName: "Household", questions: 9, inputTokens: 60000, outputTokens: 2000 },
        { homeId: "h4", homeName: "Tie", questions: 5, inputTokens: 20000, outputTokens: 800 },
        { homeId: "h1", homeName: "Sharma", questions: 4, inputTokens: 20000, outputTokens: 800 },
      ],
      sms: { suggestions: 0, inputTokens: 0, outputTokens: 0 },
      reports: { reports: 0, inputTokens: 0, outputTokens: 0 },
    });
    // SMS category suggestions (D-032) are summed apart; the assistant's counts do not change.
    const withSms = shapeAssistantUsage([
      { homeId: "h1", homeName: "Sharma", questions: 4, inputTokens: 20000, outputTokens: 800, modelCalls: 9, smsSuggestions: 3, smsInputTokens: 600, smsOutputTokens: 12 },
      { homeId: "h5", homeName: "Only SMS", questions: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, smsSuggestions: 2, smsInputTokens: 400, smsOutputTokens: -1 },
    ]);
    expect(withSms).toMatchObject({ questions: 4, inputTokens: 20000, outputTokens: 800, activeHouseholds: 1, sms: { suggestions: 5, inputTokens: 1000, outputTokens: 12 } });
    expect(withSms.byHousehold.map((h) => h.homeId)).toEqual(["h1"]);
    // Expense reports (D-033) are summed apart too.
    const withReports = shapeAssistantUsage([
      { homeId: "h1", homeName: "Sharma", questions: 1, inputTokens: 100, outputTokens: 10, modelCalls: 1, reports: 2, reportInputTokens: 6000, reportOutputTokens: 800 },
    ]);
    expect(withReports).toMatchObject({ inputTokens: 100, reports: { reports: 2, inputTokens: 6000, outputTokens: 800 } });
    expect(shapeAssistantUsage([])).toMatchObject({ available: true, questions: 0, activeHouseholds: 0, byHousehold: [] });
  });
});
