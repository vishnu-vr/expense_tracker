import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { Genkit } from "genkit";
import type { ModelArgument } from "genkit/model";
import { AI_USAGE, resolveSmsSuggestModel, SMS_SUGGEST } from "../config";
import { aiUsageDocId, countOf, usageMonth } from "../core/ai-usage";
import { toLocalDay } from "../core/dates";
import {
  buildSuggestPrompt,
  parseSuggestAnswer,
  parseSuggestRequest,
  rateLimitDocId,
  SuggestRequestError,
} from "../core/sms-suggest";
import { loadCategories, resolveHome } from "../data/home";

export interface SuggestSmsCategoryResult {
  /** One category id or null per item, in request order. */
  suggestions: (string | null)[];
  /** The model's display name for "Suggested by AI · <model>", e.g. "Gemini Flash-Lite". */
  model: string;
}

export interface SuggestSmsCategoryDeps {
  db: Firestore;
  /** Genkit and the model for a resolved model id (lazy: no credentials until a call). */
  runtime: (modelId: string) => Promise<{ ai: Genkit; model: ModelArgument }>;
  now?: () => Date;
  /** Counts only (never the text, the prompt or the answer). */
  onMetrics?: (m: { items: number; answered: number; model: string; inputTokens: number; outputTokens: number; latencyMs: number }) => void;
}

/**
 * suggestSmsCategory (D-032): one category id per payee name or reply. The
 * household comes from the caller's uid; the answer is checked against the
 * household's categories. Usage goes into the monthly `aiUsage` rollup as
 * `smsSuggestions` and `smsInputTokens` / `smsOutputTokens`, separate from
 * the assistant's counts. At most `SMS_SUGGEST.dailyCallsPerUser` calls per
 * user per India-time day (`aiRateLimits/{day}_{uid}`, server only).
 */
export async function suggestSmsCategoryHandler(
  deps: SuggestSmsCategoryDeps,
  uid: string,
  data: unknown,
): Promise<SuggestSmsCategoryResult> {
  let req;
  try {
    req = parseSuggestRequest(data);
  } catch (e) {
    if (e instanceof SuggestRequestError) throw new HttpsError("invalid-argument", e.message);
    throw e;
  }
  const { db } = deps;
  const home = await resolveHome(db, uid);
  const now = deps.now?.() ?? new Date();

  // Count the call before the model runs, so failures cannot be used to go past the limit.
  const day = toLocalDay(now, AI_USAGE.timeZone);
  const limitRef = db.collection("aiRateLimits").doc(rateLimitDocId(day, uid));
  await db.runTransaction(async (t) => {
    const snap = await t.get(limitRef);
    const calls = countOf(snap.get("smsSuggestCalls"));
    if (calls >= SMS_SUGGEST.dailyCallsPerUser) {
      throw new HttpsError("resource-exhausted", "Too many suggestions today. Try again tomorrow.");
    }
    t.set(limitRef, { day, uid, smsSuggestCalls: calls + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  const categories = await loadCategories(db, home.homeId);
  const choice = resolveSmsSuggestModel(req.model);
  const started = Date.now();
  let text: string;
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const { ai, model } = await deps.runtime(choice.id);
    const response = await ai.generate({
      model,
      prompt: buildSuggestPrompt(req.items, categories),
      config: { temperature: 0, maxOutputTokens: SMS_SUGGEST.maxOutputTokens },
    });
    text = response.text ?? "";
    inputTokens = countOf(response.usage?.inputTokens);
    outputTokens = countOf(response.usage?.outputTokens);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // Details may echo the prompt; only a generic error goes back.
    throw new HttpsError("unavailable", "No suggestion right now.", {
      reason: (e as { status?: string; name?: string }).status ?? (e as Error).name ?? "error",
    });
  }
  const suggestions = parseSuggestAnswer(text, req.items, categories);

  const month = usageMonth(now, AI_USAGE.timeZone);
  await db.collection("aiUsage").doc(aiUsageDocId(month, home.homeId)).set(
    {
      month,
      homeId: home.homeId,
      smsSuggestions: FieldValue.increment(req.items.length),
      smsInputTokens: FieldValue.increment(inputTokens),
      smsOutputTokens: FieldValue.increment(outputTokens),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  deps.onMetrics?.({
    items: req.items.length,
    answered: suggestions.filter((s) => s !== null).length,
    model: choice.id,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
  });
  return { suggestions, model: choice.label };
}
