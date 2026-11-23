import type { Genkit } from "genkit";
import type { ModelArgument } from "genkit/model";
import { REPORTS } from "../config";
import { countOf } from "../core/ai-usage";
import type { ReportBody } from "../core/report";
import {
  allowedNumbers,
  buildNarrativePrompt,
  checkNarrative,
  Narrative,
  NarrativeSchema,
  reportFacts,
  templateNarrative,
} from "../core/report-narrative";

/** One model call: the prompt in, the structured answer (unchecked) and token counts out. */
export type NarrativeGenerate = (prompt: string) => Promise<{ output: unknown; inputTokens: number; outputTokens: number }>;

export interface NarrativeResult {
  narrative: Narrative;
  source: "model" | "template";
  /** "model_failed" (threw), "guard_failed" (broke the rules twice), or null. Never the text. */
  fallbackReason: "no_model" | "model_failed" | "guard_failed" | null;
  usage: { inputTokens: number; outputTokens: number; modelCalls: number };
}

/**
 * The report's narrative (D-033): one model call, checked by the number
 * guard; on a violation one retry with the error; then the template. A model
 * that throws goes straight to the template, so a report always appears.
 * Nothing here logs the prompt, the facts or the answer.
 */
export async function writeNarrative(body: ReportBody, generate: NarrativeGenerate | null): Promise<NarrativeResult> {
  const usage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };
  if (!generate) return { narrative: templateNarrative(body), source: "template", fallbackReason: "no_model", usage };
  const facts = reportFacts(body);
  const allowed = allowedNumbers(facts);
  let retryError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let output: unknown;
    try {
      const res = await generate(buildNarrativePrompt(facts, retryError));
      usage.modelCalls++;
      usage.inputTokens += countOf(res.inputTokens);
      usage.outputTokens += countOf(res.outputTokens);
      output = res.output;
    } catch {
      return { narrative: templateNarrative(body), source: "template", fallbackReason: "model_failed", usage };
    }
    const check = checkNarrative(output, allowed);
    if (check.ok) return { narrative: check.narrative, source: "model", fallbackReason: null, usage };
    retryError = check.error;
  }
  return { narrative: templateNarrative(body), source: "template", fallbackReason: "guard_failed", usage };
}

/** A `NarrativeGenerate` over a Genkit model with JSON output. */
export function genkitNarrativeGenerate(ai: Genkit, model: ModelArgument): NarrativeGenerate {
  return async (prompt) => {
    const res = await ai.generate({
      model,
      prompt,
      output: { schema: NarrativeSchema },
      config: { temperature: 0.2, maxOutputTokens: REPORTS.maxOutputTokens },
    });
    let output: unknown = res.output;
    if (output == null) {
      try {
        output = JSON.parse((res.text ?? "").replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        output = null;
      }
    }
    return { output, inputTokens: countOf(res.usage?.inputTokens), outputTokens: countOf(res.usage?.outputTokens) };
  };
}
