import { z } from "zod";
import { Phraser } from "../core/insights/phrasing";
import { getAgentRuntime } from "./models";

/**
 * Optional model-backed phraser for insight cards. The model is given only
 * the deterministic template text and asked to reword it; `isSafePhrasing`
 * then rejects any rewrite that introduces a number the template did not have.
 */
export function createModelPhraser(modelId: string): Phraser {
  return async (card) => {
    const { ai, model } = await getAgentRuntime(modelId);
    const res = await ai.generate({
      model,
      output: { schema: z.object({ title: z.string(), body: z.string() }) },
      prompt:
        "Reword this insight card from a household expense app so it reads naturally and is easy to scan. " +
        "Keep every number, amount, date and name exactly as written. Do not add facts, advice or numbers. " +
        "Title: at most 60 characters. Body: at most 2 short sentences. Plain text, no markdown.\n\n" +
        `Title: ${card.title}\nBody: ${card.body}`,
    });
    return res.output ?? null;
  };
}
