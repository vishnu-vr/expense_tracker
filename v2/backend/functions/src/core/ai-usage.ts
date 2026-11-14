/**
 * Assistant usage accounting (D-025): per-answer usage on the message, running
 * totals on the thread, and a monthly per-household rollup in `aiUsage`.
 * Pure helpers only; the handler turns the increments into FieldValue.increment.
 */
import { Block } from "./blocks";
import { toLocalDay } from "./dates";

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
}

/** Stored on the assistant message doc. */
export interface MessageUsage extends RunUsage {
  model: string;
  latencyMs: number;
}

/** Amounts added to the thread's `usage` map and to the monthly rollup for one answer. */
export interface UsageIncrement extends RunUsage {
  questions: number;
}

/** A non-negative whole number; anything else (NaN, negative, missing) counts as 0. */
export function countOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function messageUsage(usage: RunUsage, model: string, latencyMs: number): MessageUsage {
  return {
    inputTokens: countOf(usage.inputTokens),
    outputTokens: countOf(usage.outputTokens),
    modelCalls: countOf(usage.modelCalls),
    model: model || "unknown",
    latencyMs: countOf(latencyMs),
  };
}

/** One answered question. */
export function usageIncrement(usage: RunUsage): UsageIncrement {
  return {
    questions: 1,
    inputTokens: countOf(usage.inputTokens),
    outputTokens: countOf(usage.outputTokens),
    modelCalls: countOf(usage.modelCalls),
  };
}

/** "YYYY-MM" of [date] in [timeZone] (India time for the rollup). */
export function usageMonth(date: Date, timeZone: string): string {
  return toLocalDay(date, timeZone).slice(0, 7);
}

/** Doc id of the monthly rollup: `YYYY-MM_<homeId>`. */
export function aiUsageDocId(month: string, homeId: string): string {
  return `${month}_${homeId}`;
}

/**
 * Short preview of an answer for the conversation list: the first text block,
 * whitespace collapsed, cut at [max] characters with an ellipsis. Falls back
 * to the first stat ("Label: value") when the answer has no text.
 */
export function messagePreview(blocks: Block[], max = 80): string {
  const text = blocks.find((b) => b.type === "text");
  const stat = blocks.find((b) => b.type === "stat");
  const raw = text?.type === "text" ? text.text : stat?.type === "stat" ? `${stat.label}: ${stat.value}` : "";
  const clean = raw.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Admin view

export interface HouseholdUsageRow {
  homeId: string;
  homeName: string;
  questions: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
}

export interface AssistantUsageSummary {
  /** False when the rollup could not be read. */
  available: boolean;
  questions: number;
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  /** Households that asked at least one question this month. */
  activeHouseholds: number;
  /** Sorted by total tokens (input + output), highest first. */
  byHousehold: { homeId: string; homeName: string; questions: number; inputTokens: number; outputTokens: number }[];
}

export const EMPTY_ASSISTANT_USAGE: AssistantUsageSummary = {
  available: false,
  questions: 0,
  inputTokens: 0,
  outputTokens: 0,
  modelCalls: 0,
  activeHouseholds: 0,
  byHousehold: [],
};

export function shapeAssistantUsage(rows: HouseholdUsageRow[]): AssistantUsageSummary {
  const clean = rows.map((r) => ({
    homeId: r.homeId,
    homeName: r.homeName || "Household",
    questions: countOf(r.questions),
    inputTokens: countOf(r.inputTokens),
    outputTokens: countOf(r.outputTokens),
    modelCalls: countOf(r.modelCalls),
  }));
  const sum = (k: "questions" | "inputTokens" | "outputTokens" | "modelCalls") => clean.reduce((s, r) => s + r[k], 0);
  const byHousehold = clean
    .filter((r) => r.questions > 0 || r.inputTokens > 0 || r.outputTokens > 0)
    .sort(
      (a, b) =>
        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
        b.questions - a.questions ||
        a.homeId.localeCompare(b.homeId),
    )
    .map(({ homeId, homeName, questions, inputTokens, outputTokens }) => ({ homeId, homeName, questions, inputTokens, outputTokens }));
  return {
    available: true,
    questions: sum("questions"),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    modelCalls: sum("modelCalls"),
    activeHouseholds: clean.filter((r) => r.questions > 0).length,
    byHousehold,
  };
}
