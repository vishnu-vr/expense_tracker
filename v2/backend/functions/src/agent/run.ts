import type { Genkit, MessageData, Part } from "genkit";
import type { ModelArgument } from "genkit/model";
import { Block, BlockContext, normalizeBlocks } from "../core/blocks";
import { categoryNameLookup } from "../core/categories";
import { toLocalDay } from "../core/dates";
import { formatINR } from "../core/money";
import { AGENT_LIMITS, AgentLanguage, AgentReplyMode } from "../config";
import { AgentBackend } from "./backend";
import { buildSystemPrompt } from "./prompt";
import { RESPOND_TOOL, runTool, TOOL_SPECS, ToolRunContext } from "./tools";

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export interface RunAgentInput {
  ai: Genkit;
  model: ModelArgument;
  backend: AgentBackend;
  message: string;
  history?: HistoryMessage[];
  timeZone: string;
  /** "voice": the app reads the first text block aloud (D-028). */
  reply?: AgentReplyMode;
  /** Answer language (D-028). */
  language?: AgentLanguage;
  now?: Date;
  /** Called when a tool starts, with a short user-facing status line. */
  onStatus?: (text: string) => void;
  maxTurns?: number;
}

export interface RunAgentResult {
  blocks: Block[];
  /** True when the model did not call `respond` (or sent invalid blocks) and its text was wrapped instead. */
  usedFallback: boolean;
  toolCalls: { name: string; input: unknown; output: unknown }[];
  usage: { inputTokens: number; outputTokens: number; modelCalls: number };
  latencyMs: number;
}

/** Trim history to the configured caps, keeping the most recent turns. */
export function capHistory(history: HistoryMessage[]): HistoryMessage[] {
  const recent = history.slice(-AGENT_LIMITS.maxHistoryMessages);
  const out: HistoryMessage[] = [];
  let chars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const text = recent[i].text.slice(0, 4000);
    if (chars + text.length > AGENT_LIMITS.maxHistoryChars) break;
    chars += text.length;
    out.unshift({ role: recent[i].role, text });
  }
  // A conversation replayed to a model should start with a user turn.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/**
 * One question: the model plans, calls tools (exact numbers computed in
 * code), then calls `respond` with blocks. Works with any Genkit model that
 * supports tool calling; nothing here is provider-specific.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const started = Date.now();
  const { ai, backend } = input;
  const today = toLocalDay(input.now ?? new Date(), input.timeZone);
  const data = await backend.loadData();
  const ctx: ToolRunContext = { backend, today, proposals: new Map() };
  const toolCalls: RunAgentResult["toolCalls"] = [];

  // Tool definitions only: the loop below executes them itself, so it can
  // report status, stop at `respond`, and stay on Genkit's stable API.
  const noop = async () => null;
  const tools = [
    ...TOOL_SPECS.map((spec) =>
      ai.dynamicTool({ name: spec.name, description: spec.description, inputSchema: spec.inputSchema }, noop),
    ),
    ai.dynamicTool(
      { name: RESPOND_TOOL.name, description: RESPOND_TOOL.description, inputSchema: RESPOND_TOOL.inputSchema },
      noop,
    ),
  ];
  const system = buildSystemPrompt({
    today,
    timeZone: input.timeZone,
    callerUid: backend.uid,
    data,
    reply: input.reply,
    language: input.language,
  });

  let messages: MessageData[] = [
    ...capHistory(input.history ?? []).map(
      (m): MessageData => ({ role: m.role === "assistant" ? "model" : "user", content: [{ text: m.text }] }),
    ),
    { role: "user", content: [{ text: input.message }] },
  ];

  const usage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };
  const maxTurns = input.maxTurns ?? AGENT_LIMITS.maxTurns;
  let rawBlocks: unknown = undefined;
  let responded = false;
  let finalText = "";

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await ai.generate({ model: input.model, system, messages, tools, returnToolRequests: true });
    usage.modelCalls += 1;
    usage.inputTokens += response.usage?.inputTokens ?? 0;
    usage.outputTokens += response.usage?.outputTokens ?? 0;

    const requests = response.toolRequests;
    if (requests.length === 0) {
      // Plain-text answer (no `respond` call): wrapped as a text block below.
      finalText = response.text ?? "";
      break;
    }

    // Run the data / proposal tools of this turn, in order.
    const toolResponses: Part[] = [];
    for (const part of requests) {
      const { name, ref, input: toolInput } = part.toolRequest;
      if (name === RESPOND_TOOL.name) continue;
      const spec = TOOL_SPECS.find((t) => t.name === name);
      if (spec) input.onStatus?.(spec.status);
      const output = await runTool(name, toolInput, ctx);
      toolCalls.push({ name, input: toolInput, output });
      toolResponses.push({ toolResponse: { name, ref, output } });
    }

    // `respond` ends the run: its input IS the answer.
    const respondRequest = requests.find((p) => p.toolRequest.name === RESPOND_TOOL.name);
    if (respondRequest) {
      rawBlocks = (respondRequest.toolRequest.input as { blocks?: unknown } | undefined)?.blocks;
      responded = true;
      finalText = response.text ?? "";
      break;
    }

    messages = [...response.messages.filter((m) => m.role !== "system"), { role: "tool", content: toolResponses }];
    if (turn === maxTurns - 1) {
      finalText = "Sorry, that took more steps than I am allowed. Please try a narrower question.";
    }
  }

  const catName = categoryNameLookup(data.categories);
  const txById = new Map(data.transactions.map((t) => [t.id, t]));
  const blockCtx: BlockContext = {
    transactionById: (id) => txById.get(id),
    categoryName: catName,
    proposalById: (id) => ctx.proposals.get(id),
    formatNumber: formatINR,
  };

  // Validate what the model sent; anything unusable falls back to one text block.
  const SENTINEL = "\u0000fallback";
  const parsed = responded ? normalizeBlocks(rawBlocks, blockCtx, SENTINEL) : [];
  const usedFallback = !responded || (parsed.length === 1 && parsed[0].type === "text" && parsed[0].text === SENTINEL);
  const blocks = usedFallback ? normalizeBlocks(undefined, blockCtx, finalText) : parsed;

  // A proposal that was created must always be shown, or the user could never confirm it.
  for (const [proposalId, p] of ctx.proposals) {
    if (!blocks.some((b) => b.type === "proposal" && b.proposalId === proposalId)) {
      blocks.push({ type: "proposal", proposalId, action: p.action, summary: p.summary });
    }
  }

  return { blocks, usedFallback, toolCalls, usage, latencyMs: Date.now() - started };
}
