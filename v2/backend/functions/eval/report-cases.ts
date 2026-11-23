/**
 * Ten report cases on the fixture household for the narrative eval (D-033).
 * Pure: the figures come from `buildReport`; only the writer calls a model.
 */
import { ComparisonMode, resolveComparison } from "../src/core/compare";
import { buildReport, ReportBody } from "../src/core/report";
import { DayRange } from "../src/core/types";
import { FIXTURE_TODAY, fixtureHomeData } from "./fixture";

export interface ReportCase {
  id: string;
  period: DayRange;
  mode: ComparisonMode;
  custom?: DayRange;
}

export const REPORT_CASES: ReportCase[] = [
  { id: "oct_vs_sep", period: { from: "2026-10-01", to: "2026-10-31" }, mode: "previous" },
  { id: "oct_vs_avg", period: { from: "2026-10-01", to: "2026-10-31" }, mode: "average" },
  { id: "oct_alone", period: { from: "2026-10-01", to: "2026-10-31" }, mode: "none" },
  { id: "sep_vs_aug", period: { from: "2026-09-01", to: "2026-09-30" }, mode: "previous" },
  { id: "aug_vs_last_year", period: { from: "2026-08-01", to: "2026-08-31" }, mode: "last_year" },
  { id: "nov_mtd", period: { from: "2026-11-01", to: "2026-11-10" }, mode: "previous" },
  { id: "last_7_days", period: { from: "2026-11-04", to: "2026-11-10" }, mode: "previous" },
  { id: "last_30_days", period: { from: "2026-10-12", to: "2026-11-10" }, mode: "average" },
  { id: "oct_vs_custom", period: { from: "2026-10-01", to: "2026-10-31" }, mode: "custom", custom: { from: "2026-08-01", to: "2026-08-15" } },
  { id: "q3_alone", period: { from: "2026-07-01", to: "2026-09-30" }, mode: "none" },
];

export function buildCaseReport(c: ReportCase): ReportBody {
  return buildReport(fixtureHomeData(), c.period, resolveComparison(c.period, c.mode, c.custom ?? null), FIXTURE_TODAY);
}
