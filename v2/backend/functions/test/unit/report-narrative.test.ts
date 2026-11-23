import { describe, expect, it } from "vitest";
import { writeNarrative } from "../../src/agent/report-writer";
import { resolveComparison } from "../../src/core/compare";
import { numbersAllowed, numbersIn } from "../../src/core/insights/phrasing";
import { buildReport } from "../../src/core/report";
import { allowedNumbers, buildNarrativePrompt, checkNarrative, reportFacts, templateNarrative } from "../../src/core/report-narrative";
import { home, tx } from "./helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const data = home(
  [
    tx("2026-09-05", 1000, "food", "Swiggy dinner with Ravi", { id: "s1" }),
    tx("2026-09-01", 50000, "salary", "Salary", { id: "s2", type: "income" }),
    tx("2026-10-03", 400, "food", "Swiggy", { id: "o1" }),
    tx("2026-10-04", 800, "food", "Zomato", { id: "o2" }),
    tx("2026-10-10", 171518.44, "shopping", "secret gift for Meera", { id: "o3" }),
    tx("2026-10-01", 60000, "salary", "Salary", { id: "o5", type: "income" }),
  ],
  [{ categoryId: "food", amount: 1000 }],
);
const body = buildReport(data, OCT, resolveComparison(OCT, "previous"), "2026-11-23");
const facts = reportFacts(body);
const allowed = allowedNumbers(facts);

describe("number guard", () => {
  it("normalises Indian amounts, percentages and counts", () => {
    expect(numbersIn("₹1,71,518.44, 12% and 3 orders")).toEqual(["171518.44", "12", "3"]);
    expect(numbersIn("₹20.50 and 12.0%")).toEqual(["20.5", "12"]);
    const set = new Set(numbersIn("Spent ₹1,71,518.44 (+12.3%) over 3 orders"));
    expect(numbersAllowed("₹1,71,518.44 went up 12.3% across 3 orders", set)).toBe(true);
    expect(numbersAllowed("about ₹1.7 lakh", set)).toBe(false);
    expect(numbersAllowed("up 12%", set)).toBe(false);
  });

  it("the facts carry display strings and merchant names, never note text", () => {
    expect(facts).toContain("Spent: ₹1,72,718.44 (September 2026: ₹1,000; change +₹1,71,718.44, +17171.8%)");
    expect(facts).toContain("Food: ₹1,200");
    expect(facts).toContain("Swiggy");
    expect(facts).not.toContain("secret gift");
    expect(facts).not.toContain("Meera");
    expect(facts).not.toContain("Ravi");
  });

  it("accepts a narrative that quotes the facts, and rejects invented numbers, bad shapes and long text", () => {
    const good = {
      headline: "Spent ₹1,72,718.44 in October 2026",
      summary: "Shopping drove the month. Food was ₹1,200.",
      changes: ["Food went from ₹1,000 to ₹1,200 (+₹200)."],
      suggestions: [],
    };
    expect(checkNarrative(good, allowed)).toEqual({ ok: true, narrative: good });
    const invented = checkNarrative({ ...good, summary: "Food rose about 20 percent, roughly ₹7 a day." }, allowed);
    expect(invented).toMatchObject({ ok: false });
    expect((invented as { error: string }).error).toContain("7");
    expect(checkNarrative({ headline: "x" }, allowed)).toMatchObject({ ok: false });
    expect(checkNarrative({ ...good, headline: "x".repeat(121) }, allowed)).toMatchObject({ ok: false });
    expect(checkNarrative({ ...good, changes: ["a", "b", "c", "d", "e"] }, allowed)).toMatchObject({ ok: false });
  });

  it("the template passes its own guard, with and without a comparison, and for an empty month", () => {
    for (const b of [body, buildReport(data, OCT, null, "2026-11-23"), buildReport(home([]), OCT, resolveComparison(OCT, "average"), "2026-11-23")]) {
      const t = templateNarrative(b);
      expect(checkNarrative(t, allowedNumbers(reportFacts(b)))).toMatchObject({ ok: true });
    }
    expect(templateNarrative(body).headline).toBe("Spent ₹1,72,718.44 in October 2026, +17171.8% on September 2026");
    expect(templateNarrative(body).suggestions[0]).toContain("Food used 120% of its ₹1,000 budget");
  });

  it("the retry prompt carries the rejection", () => {
    expect(buildNarrativePrompt(facts, "These numbers are not in the facts: 7.")).toContain("previous answer was rejected: These numbers are not in the facts: 7.");
    expect(buildNarrativePrompt(facts)).not.toContain("rejected");
  });
});

describe("writeNarrative", () => {
  const good = { headline: "Shopping took over October 2026", summary: "Spent ₹1,72,718.44.", changes: [], suggestions: [] };
  const fake = (answers: unknown[]) => {
    const prompts: string[] = [];
    return {
      prompts,
      generate: async (prompt: string) => {
        prompts.push(prompt);
        const a = answers.shift();
        if (a instanceof Error) throw a;
        return { output: a, inputTokens: 3000, outputTokens: 400 };
      },
    };
  };

  it("uses the model's answer when it passes", async () => {
    const f = fake([good]);
    const r = await writeNarrative(body, f.generate);
    expect(r).toMatchObject({ source: "model", narrative: good, usage: { modelCalls: 1, inputTokens: 3000, outputTokens: 400 } });
  });

  it("retries once with the error, then uses the retry", async () => {
    const f = fake([{ ...good, summary: "Spent ₹1.7 lakh." }, good]);
    const r = await writeNarrative(body, f.generate);
    expect(r.source).toBe("model");
    expect(r.usage.modelCalls).toBe(2);
    expect(f.prompts[1]).toContain("not in the facts: 1.7");
  });

  it("falls back to the template after a failed retry, when the model throws, and with no model", async () => {
    const bad = { ...good, summary: "Spent ₹99." };
    const twice = await writeNarrative(body, fake([bad, bad]).generate);
    expect(twice).toMatchObject({ source: "template", fallbackReason: "guard_failed", usage: { modelCalls: 2 } });
    expect(twice.narrative).toEqual(templateNarrative(body));
    expect(await writeNarrative(body, fake([new Error("down")]).generate)).toMatchObject({ source: "template", fallbackReason: "model_failed" });
    expect(await writeNarrative(body, null)).toMatchObject({ source: "template", fallbackReason: "no_model", usage: { modelCalls: 0 } });
  });
});
