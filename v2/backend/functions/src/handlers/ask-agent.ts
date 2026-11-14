import { FieldValue, Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { Genkit } from "genkit";
import type { ModelArgument } from "genkit/model";
import { HistoryMessage, runAgent, RunAgentResult } from "../agent/run";
import { AGENT_LIMITS, AI_USAGE } from "../config";
import { aiUsageDocId, messagePreview, messageUsage, usageIncrement, usageMonth } from "../core/ai-usage";
import { Block, BlockSchema, blocksToText } from "../core/blocks";
import { isValidTimeZone } from "../core/dates";
import { FirestoreAgentBackend, QueryEmbedder } from "../data/firestore-backend";
import { resolveHome } from "../data/home";

export interface AskAgentRequest {
  threadId?: string;
  message: string;
  timeZone: string;
}

export type AskAgentChunk = { type: "status"; text: string } | { type: "text"; delta: string };

export interface AskAgentResult {
  threadId: string;
  messageId: string;
  blocks: Block[];
}

export interface AskAgentDeps {
  db: Firestore;
  /**
   * Resolves the configured model (lazy, so no credentials are needed until a
   * question is asked). `modelId.id` (e.g. "vertexai/gemini-3.8-flash") is
   * recorded with the usage; without it the model reference's name is used.
   */
  runtime: () => Promise<{ ai: Genkit; model: ModelArgument; modelId?: { id: string } }>;
  embedQuery: QueryEmbedder;
  now?: () => Date;
  /** Receives run metrics only (never message or transaction content). */
  onMetrics?: (m: Pick<RunAgentResult, "usage" | "latencyMs" | "usedFallback"> & { tools: string[] }) => void;
}

function parseRequest(data: unknown): AskAgentRequest {
  const d = (data ?? {}) as Record<string, unknown>;
  const message = typeof d.message === "string" ? d.message.trim() : "";
  if (!message) throw new HttpsError("invalid-argument", "message is required.");
  if (message.length > AGENT_LIMITS.maxMessageLength) {
    throw new HttpsError("invalid-argument", `message is too long (max ${AGENT_LIMITS.maxMessageLength} characters).`);
  }
  if (!isValidTimeZone(d.timeZone)) {
    throw new HttpsError("invalid-argument", "timeZone must be an IANA time zone, e.g. Asia/Kolkata.");
  }
  if (d.threadId !== undefined && d.threadId !== null && (typeof d.threadId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(d.threadId))) {
    throw new HttpsError("invalid-argument", "Invalid threadId.");
  }
  return { threadId: (d.threadId as string | undefined) || undefined, message, timeZone: d.timeZone };
}

/** "vertexai/gemini-3.8-flash" from a Genkit model reference or name. */
function modelNameOf(model: ModelArgument): string {
  if (typeof model === "string") return model;
  const name = (model as { name?: unknown } | null)?.name;
  return typeof name === "string" && name ? name : "unknown";
}

/** Split text into small pieces so the client can render it progressively. */
export function chunkText(text: string, size = 48): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of text.split(/(\s+)/)) {
    if (current.length + piece.length > size && current) {
      out.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) out.push(current);
  return out;
}

/**
 * askAgent: one question to the insights agent.
 * Persists the user message and the assistant reply under
 * homes/{homeId}/aiThreads/{threadId}/messages, with token usage on the reply,
 * running totals on the thread and a monthly rollup in aiUsage (D-025).
 * Only the thread's creator can continue it.
 */
export async function askAgentHandler(
  deps: AskAgentDeps,
  uid: string,
  data: unknown,
  sendChunk: (chunk: AskAgentChunk) => void | Promise<unknown>,
): Promise<AskAgentResult> {
  const req = parseRequest(data);
  const { db } = deps;
  // The household always comes from the caller's uid — never from the request or the model.
  const home = await resolveHome(db, uid);
  const threads = db.collection("homes").doc(home.homeId).collection("aiThreads");

  let threadRef = req.threadId ? threads.doc(req.threadId) : threads.doc();
  let history: HistoryMessage[] = [];
  if (req.threadId) {
    const thread = await threadRef.get();
    // Conversations are personal (D-025): another member's thread is "not found".
    if (!thread.exists || thread.get("createdBy") !== uid) throw new HttpsError("not-found", "Thread not found.");
    const prior = await threadRef
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(AGENT_LIMITS.maxHistoryMessages)
      .get();
    history = prior.docs.reverse().map((doc) => {
      const parsed = BlockSchema.array().safeParse(doc.get("blocks"));
      return {
        role: doc.get("role") === "assistant" ? ("assistant" as const) : ("user" as const),
        text: parsed.success ? blocksToText(parsed.data) : "",
      };
    }).filter((m) => m.text);
  } else {
    threadRef = threads.doc();
    await threadRef.set({
      title: req.message.replace(/\s+/g, " ").slice(0, 60),
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await threadRef.collection("messages").add({
    role: "user",
    blocks: [{ type: "text", text: req.message }],
    createdAt: FieldValue.serverTimestamp(),
  });

  await sendChunk({ type: "status", text: "Thinking…" });

  const backend = new FirestoreAgentBackend(db, uid, home, threadRef.id, req.timeZone, deps.embedQuery);
  let result: RunAgentResult;
  let modelName = "unknown";
  try {
    const { ai, model, modelId } = await deps.runtime();
    modelName = modelId?.id ?? modelNameOf(model);
    result = await runAgent({
      ai,
      model,
      backend,
      message: req.message,
      history,
      timeZone: req.timeZone,
      now: deps.now?.(),
      onStatus: (text) => void sendChunk({ type: "status", text }),
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    // Surface a generic error; details (which may echo the prompt) are not returned.
    throw new HttpsError("internal", "The assistant could not answer right now. Please try again.", {
      reason: (e as { status?: string; name?: string }).status ?? (e as Error).name ?? "error",
    });
  }

  for (const block of result.blocks) {
    if (block.type !== "text") continue;
    for (const delta of chunkText(block.text)) await sendChunk({ type: "text", delta });
    await sendChunk({ type: "text", delta: "\n" });
  }

  // Answer + usage in one batch: the message, the thread's running totals, and
  // the monthly per-household rollup (server-only, India-time month).
  const messageRef = threadRef.collection("messages").doc();
  const inc = usageIncrement(result.usage);
  const now = deps.now?.() ?? new Date();
  const month = usageMonth(now, AI_USAGE.timeZone);
  const batch = db.batch();
  batch.set(messageRef, {
    role: "assistant",
    blocks: result.blocks,
    usage: messageUsage(result.usage, modelName, result.latencyMs),
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(threadRef, {
    "usage.questions": FieldValue.increment(inc.questions),
    "usage.inputTokens": FieldValue.increment(inc.inputTokens),
    "usage.outputTokens": FieldValue.increment(inc.outputTokens),
    "usage.modelCalls": FieldValue.increment(inc.modelCalls),
    lastModel: modelName,
    lastMessagePreview: messagePreview(result.blocks, AI_USAGE.previewChars),
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    db.collection("aiUsage").doc(aiUsageDocId(month, home.homeId)),
    {
      month,
      homeId: home.homeId,
      questions: FieldValue.increment(inc.questions),
      inputTokens: FieldValue.increment(inc.inputTokens),
      outputTokens: FieldValue.increment(inc.outputTokens),
      modelCalls: FieldValue.increment(inc.modelCalls),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();

  deps.onMetrics?.({
    usage: result.usage,
    latencyMs: result.latencyMs,
    usedFallback: result.usedFallback,
    tools: result.toolCalls.map((t) => t.name),
  });
  return { threadId: threadRef.id, messageId: messageRef.id, blocks: result.blocks };
}
