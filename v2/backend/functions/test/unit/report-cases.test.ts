import { describe, expect, it } from "vitest";
import { allowedNumbers, checkNarrative, reportFacts, templateNarrative } from "../../src/core/report-narrative";
import { buildCaseReport, REPORT_CASES } from "../../eval/report-cases";

describe("narrative eval fixtures (no model)", () => {
  it("all ten reports build, and each template passes the number guard", () => {
    expect(REPORT_CASES).toHaveLength(10);
    for (const c of REPORT_CASES) {
      const body = buildCaseReport(c);
      const facts = reportFacts(body);
      expect(facts.length).toBeGreaterThan(100);
      expect(checkNarrative(templateNarrative(body), allowedNumbers(facts))).toMatchObject({ ok: true });
    }
  });

  it("the October report finds the planted anomaly, duplicate, price change and the budgets", () => {
    const body = buildCaseReport(REPORT_CASES[0]);
    expect(body.sections.notable!.anomalies.map((a) => a.entry.amountDisplay)).toContain("₹18,500");
    expect(body.sections.notable!.duplicates.map((d) => d.amountDisplay)).toContain("₹742");
    expect(body.sections.bills!.priceChanges.map((p) => p.currentAmountDisplay)).toContain("₹799");
    expect(body.sections.budgets!.rows.length).toBeGreaterThan(0);
    expect(body.sections.members!.rows.map((m) => m.name).sort()).toEqual(["Asha", "Vikram"]);
  });
});
