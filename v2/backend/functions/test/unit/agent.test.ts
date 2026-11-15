import { genkit } from "genkit";
import type { GenerateRequest, GenerateResponseData, Part } from "genkit";
import { describe, expect, it } from "vitest";
import { FIXTURE_BUDGETS, FIXTURE_NOW, FIXTURE_TIME_ZONE, fixtureHomeData } from "../../eval/fixture";
import { FixtureBackend } from "../../eval/fixture-backend";
import { parseModelId } from "../../src/agent/models";
import { buildSystemPrompt, replyStyleSection } from "../../src/agent/prompt";
import { capHistory, runAgent } from "../../src/agent/run";
import { RESPOND_TOOL, runTool, TOOL_SPECS } from "../../src/agent/tools";
import { BlockSchema } from "../../src/core/blocks";
import { chunkText } from "../../src/handlers/ask-agent";
import { AGENT_MODEL_CHOICES, AGENT_MODEL_KEY_PATTERN, DEFAULT_AGENT_MODEL, resolveAgentModel } from "../../src/config";

type Step = (req: GenerateRequest) => Part[];

/**
 * A scripted stand-in for an LLM, registered as a real Genkit model. The agent
 * loop (tool calling, the `respond` interrupt, usage accounting) runs through
 * Genkit exactly as it would with Gemini or Claude — only the "thinking" is canned.
 */
function scripted(steps: Step[]) {
  const ai = genkit({});
  const requests: GenerateRequest[] = [];
  const name = `test/scripted-${Math.random().toString(36).slice(2)}`;
  ai.defineModel(
    { name, supports: { tools: true, multiturn: true, systemRole: true } },
    async (req): Promise<GenerateResponseData> => {
      const step = steps[requests.length];
      requests.push(req);
      if (!step) throw new Error("script exhausted");
      return { message: { role: "model", content: step(req) }, finishReason: "stop", usage: { inputTokens: 100, outputTokens: 20 } };
    },
  );
  return { ai, model: name, requests };
}

const call = (name: string, input: unknown): Part => ({ toolRequest: { name, input, ref: `${name}-1` } });
const lastToolOutput = (req: GenerateRequest): any =>
  [...req.messages].reverse().flatMap((m) => m.content).find((p) => p.toolResponse)?.toolResponse?.output;
const run = (s: ReturnType<typeof scripted>, backend: FixtureBackend, message: string, extra = {}) =>
  runAgent({ ai: s.ai, model: s.model, backend, message, timeZone: FIXTURE_TIME_ZONE, now: FIXTURE_NOW, ...extra });

describe("agent loop (through Genkit, scripted model)", () => {
  it("calls a tool, then responds with blocks built from the tool's exact figures", async () => {
    const s = scripted([
      () => [call("query_transactions", { from: "2026-10-01", to: "2026-10-31", rowLimit: 2, rowSort: "amount_desc" })],
      (req) => {
        const out = lastToolOutput(req);
        return [
          call("respond", {
            blocks: [
              { type: "stat", label: "Spent in October", value: out.summary.expenseTotalDisplay },
              { type: "transactions", transactionIds: out.rows.map((r: { id: string }) => r.id) },
              { type: "text", text: "Rent was the largest entry." },
            ],
          }),
        ];
      },
    ]);
    const statuses: string[] = [];
    const result = await run(s, new FixtureBackend(), "How much did we spend last month?", { onStatus: (t: string) => statuses.push(t) });

    expect(result.usedFallback).toBe(false);
    expect(result.blocks[0]).toEqual({ type: "stat", label: "Spent in October", value: "₹84,151.25" });
    expect(result.blocks[1].type).toBe("transactions");
    if (result.blocks[1].type === "transactions") {
      expect(result.blocks[1].items.map((i) => [i.note, i.amount, i.categoryName, i.type])).toEqual([
        ["House rent", 25000, "Home", "expense"],
        ["Anniversary dinner at Taj", 18500, "Food", "expense"],
      ]);
      expect(result.blocks[1].items[0].date).toMatch(/^2026-10-03T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(result.blocks[2]).toEqual({ type: "text", text: "Rent was the largest entry." });
    for (const b of result.blocks) expect(BlockSchema.safeParse(b).success).toBe(true);

    expect(statuses).toEqual(["Looking through transactions…"]);
    expect(result.toolCalls.map((t) => t.name)).toEqual(["query_transactions"]);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40, modelCalls: 2 });

    // What the model was given
    const first = s.requests[0];
    const system = first.messages.find((m) => m.role === "system")!.content.map((p) => p.text).join("");
    expect(system).toContain("TODAY: 2026-11-10 (Tuesday), time zone Asia/Kolkata");
    expect(system).toContain("You never do arithmetic");
    expect(system).toContain("pets — Pets — expense");
    expect(first.tools!.map((t) => t.name).sort()).toEqual([...TOOL_SPECS.map((t) => t.name), "respond"].sort());
  });

  it("falls back to a single text block when the model answers in plain text", async () => {
    const s = scripted([() => [{ text: "I can only help with your household finances." }]]);
    const result = await run(s, new FixtureBackend(), "Tell me a joke");
    expect(result.blocks).toEqual([{ type: "text", text: "I can only help with your household finances." }]);
    expect(result.usedFallback).toBe(true);
  });

  it("falls back when respond carries nothing usable", async () => {
    const s = scripted([() => [call("respond", { blocks: [{ type: "stat", label: "Total" }] })]]);
    const result = await run(s, new FixtureBackend(), "?");
    expect(result.blocks).toEqual([{ type: "text", text: "Sorry, I could not put together an answer. Please try rephrasing." }]);
    expect(result.usedFallback).toBe(true);
  });

  it("write requests become pending proposals — shown even if the model forgets the block, and nothing is changed", async () => {
    const s = scripted([
      () => [call("propose_set_budget", { categoryId: "food", amount: 14000 })],
      () => [call("respond", { blocks: [{ type: "text", text: "I have suggested the change; please confirm it." }] })],
    ]);
    const backend = new FixtureBackend();
    const result = await run(s, backend, "Set the food budget to 14000");
    expect(backend.proposals).toHaveLength(1);
    expect(backend.proposals[0]).toMatchObject({ action: "set_budget", params: { categoryId: "food", amount: 14000 } });
    expect(result.blocks).toEqual([
      { type: "text", text: "I have suggested the change; please confirm it." },
      { type: "proposal", proposalId: "proposal_1", action: "set_budget", summary: "Change the monthly Food budget from ₹12,000 to ₹14,000" },
    ]);
    expect(lastToolOutput(s.requests[1])).toMatchObject({ status: "pending", proposalId: "proposal_1" });
    expect(fixtureHomeData().budgets).toEqual(FIXTURE_BUDGETS); // user data untouched
  });

  it("a proposal id the model invents is not rendered", async () => {
    const s = scripted([() => [call("respond", { blocks: [{ type: "proposal", proposalId: "fake" }, { type: "text", text: "ok" }] })]]);
    expect((await run(s, new FixtureBackend(), "x")).blocks).toEqual([{ type: "text", text: "ok" }]);
  });

  it("tool errors go back to the model instead of failing the run", async () => {
    const s = scripted([
      () => [call("query_transactions", { from: "2026-13-45" })],
      (req) => [call("respond", { blocks: [{ type: "text", text: String(lastToolOutput(req).error) }] })],
    ]);
    const result = await run(s, new FixtureBackend(), "x");
    expect(result.blocks).toEqual([{ type: "text", text: '"2026-13-45" is not a valid YYYY-MM-DD date.' }]);
  });

  it("replays capped history as alternating user / model turns", async () => {
    const s = scripted([() => [call("respond", { blocks: [{ type: "text", text: "ok" }] })]]);
    await run(s, new FixtureBackend(), "And September?", {
      history: [
        { role: "user", text: "How much did we spend in October?" },
        { role: "assistant", text: "[stat] Spent: ₹84,151.25" },
      ],
    });
    const convo = s.requests[0].messages.filter((m) => m.role !== "system").map((m) => [m.role, m.content[0].text]);
    expect(convo).toEqual([
      ["user", "How much did we spend in October?"],
      ["model", "[stat] Spent: ₹84,151.25"],
      ["user", "And September?"],
    ]);
  });
});

describe("turn limit", () => {
  it("stops after maxTurns and says so instead of looping forever", async () => {
    const s = scripted(Array.from({ length: 3 }, () => () => [call("list_tags", {})]));
    const result = await run(s, new FixtureBackend(), "x", { maxTurns: 3 });
    expect(s.requests).toHaveLength(3);
    expect(result.usedFallback).toBe(true);
    expect(result.blocks).toEqual([{ type: "text", text: "Sorry, that took more steps than I am allowed. Please try a narrower question." }]);
  });
});

describe("history cap", () => {
  it("keeps the most recent turns within the limits and starts on a user turn", () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), text: `m${i}` }));
    const capped = capHistory(long);
    expect(capped.length).toBeLessThanOrEqual(20);
    expect(capped[capped.length - 1].text).toBe("m59");
    expect(capped[0].role).toBe("user");
    const big = (role: "user" | "assistant") => ({ role, text: "a".repeat(9000) });
    const huge = capHistory([big("user"), big("assistant"), big("user"), big("assistant"), big("user"), big("assistant")]);
    // each message is cut to 4,000 characters and the total stays within 12,000
    expect(huge.map((m) => [m.role, m.text.length])).toEqual([["user", 4000], ["assistant", 4000]]);
  });
});

describe("tools", () => {
  const ctx = () => ({ backend: new FixtureBackend(), today: "2026-11-10", proposals: new Map() });

  it("has the tools the brief lists", () => {
    expect(TOOL_SPECS.map((t) => t.name)).toEqual([
      "query_transactions", "compare_periods", "budget_status", "recurring_bills", "find_anomalies", "search_notes",
      "list_categories", "list_tags", "list_members", "propose_set_budget", "propose_tag_transactions", "propose_recategorise",
    ]);
    expect(RESPOND_TOOL.name).toBe("respond");
  });

  it("no tool lets the model choose a household", () => {
    for (const t of [...TOOL_SPECS, RESPOND_TOOL]) {
      const keys = Object.keys((t.inputSchema as unknown as { shape: Record<string, unknown> }).shape);
      expect(keys.filter((k) => /home/i.test(k))).toEqual([]);
    }
  });

  it("validates input and reports problems as data", async () => {
    expect(await runTool("query_transactions", { groupBy: "galaxy" }, ctx())).toMatchObject({ error: expect.stringContaining("Invalid input") });
    expect(await runTool("compare_periods", { fromA: "2026-10-31", toA: "2026-10-01", fromB: "2026-09-01", toB: "2026-09-30" }, ctx())).toEqual({
      error: "Range start 2026-10-31 is after its end 2026-10-01.",
    });
    expect(await runTool("budget_status", { month: "2026-13" }, ctx())).toEqual({ error: '"2026-13" is not a valid YYYY-MM month.' });
    expect(await runTool("nope", {}, ctx())).toEqual({ error: "Unknown tool nope" });
  });

  it("each read tool returns exact, display-ready figures", async () => {
    const budget = (await runTool("budget_status", {}, ctx())) as any;
    expect(budget.month).toBe("2026-11");
    expect(budget.lines.find((l: any) => l.categoryId === "food")).toMatchObject({ spent: 1556, spentDisplay: "₹1,556", remainingDisplay: "₹10,444" });

    const recurring = (await runTool("recurring_bills", {}, ctx())) as any;
    expect(recurring.bills.find((b: any) => b.label === "Netflix").priceChange.currentAmountDisplay).toBe("₹799");
    expect(recurring.monthlyEquivalentTotalDisplay).toMatch(/^₹[\d,]+(\.\d{2})?$/);

    const anomalies = (await runTool("find_anomalies", { from: "2026-10-01", to: "2026-10-31" }, ctx())) as any;
    expect(anomalies.anomalies.map((a: any) => a.transaction.amountDisplay)).toEqual(["₹18,500"]);
    expect(anomalies.duplicates).toHaveLength(1);

    const search = (await runTool("search_notes", { query: "anniversary dinner", limit: 3 }, ctx())) as any;
    expect(search.rows[0].note).toBe("Anniversary dinner at Taj");

    const members = (await runTool("list_members", {}, ctx())) as any;
    expect(members.members).toEqual([
      { id: "u_asha", name: "Asha", isCaller: true },
      { id: "u_vikram", name: "Vikram", isCaller: false },
    ]);
    expect(((await runTool("list_categories", {}, ctx())) as any).categories.length).toBe(25);
    expect(((await runTool("list_tags", {}, ctx())) as any).tags).toEqual([{ id: "tag_goa", name: "Goa trip" }, { id: "tag_work", name: "Work" }]);
  });

  it("propose tools return an error (and store nothing) for invalid requests", async () => {
    const c = ctx();
    expect(await runTool("propose_set_budget", { categoryId: "salary", amount: 100 }, c)).toEqual({ error: "Budgets can only be set on expense categories." });
    expect(c.backend.proposals).toEqual([]);
    expect(c.proposals.size).toBe(0);
  });
});

describe("configuration helpers", () => {
  it("parses model ids for every supported provider", () => {
    expect(parseModelId("vertexai/gemini-3.8-flash")).toEqual({ provider: "vertexai", name: "gemini-3.8-flash", id: "vertexai/gemini-3.8-flash" });
    expect(parseModelId("gemini-3.8-flash").provider).toBe("vertexai");
    expect(parseModelId("claude-sonnet-5").id).toBe("vertex-model-garden/claude-sonnet-5");
    expect(parseModelId("googleai/gemini-3.8-flash").provider).toBe("googleai");
    expect(() => parseModelId("openai/gpt")).toThrow(/Unknown model provider/);
  });
  it("resolves model choices from the allowlist (D-027)", () => {
    const saved = process.env.AGENT_MODEL;
    try {
      delete process.env.AGENT_MODEL;
      expect(resolveAgentModel("flash")).toBe(DEFAULT_AGENT_MODEL);
      expect(resolveAgentModel("flash-lite")).toBe("vertexai/gemini-3.5-flash-lite");
      expect(resolveAgentModel()).toBe(DEFAULT_AGENT_MODEL);
      expect(resolveAgentModel("gpt-9")).toBe(DEFAULT_AGENT_MODEL);
      // The env override moves the default, not the other choices.
      process.env.AGENT_MODEL = "vertex-model-garden/claude-sonnet-5";
      expect(resolveAgentModel("flash")).toBe("vertex-model-garden/claude-sonnet-5");
      expect(resolveAgentModel(undefined)).toBe("vertex-model-garden/claude-sonnet-5");
      expect(resolveAgentModel("unknown")).toBe("vertex-model-garden/claude-sonnet-5");
      expect(resolveAgentModel("flash-lite")).toBe("vertexai/gemini-3.5-flash-lite");
    } finally {
      if (saved === undefined) delete process.env.AGENT_MODEL;
      else process.env.AGENT_MODEL = saved;
    }
  });
  it("every model choice has a valid key and a parseable id", () => {
    expect(new Set(AGENT_MODEL_CHOICES.map((c) => c.key)).size).toBe(AGENT_MODEL_CHOICES.length);
    for (const c of AGENT_MODEL_CHOICES) {
      expect(AGENT_MODEL_KEY_PATTERN.test(c.key)).toBe(true);
      expect(parseModelId(c.id).id).toBe(c.id);
    }
  });
  it("system prompt names the caller and lists reference data", () => {
    const p = buildSystemPrompt({ today: "2026-11-10", timeZone: "Asia/Kolkata", callerUid: "u_vikram", data: fixtureHomeData() });
    expect(p).toContain("The person asking: Vikram (member id u_vikram)");
    expect(p).toContain("Last month: October 2026 (2026-10)");
    expect(p).toContain("tag_goa — Goa trip");
  });
  it("typed English questions get the unchanged prompt; voice and Malayalam add their sections (D-028)", () => {
    const base = { today: "2026-11-10", timeZone: "Asia/Kolkata", callerUid: "u_vikram", data: fixtureHomeData() };
    const plain = buildSystemPrompt(base);
    expect(replyStyleSection()).toBe("");
    expect(buildSystemPrompt({ ...base, reply: "text", language: "en" })).toBe(plain);
    expect(plain).not.toContain("SPOKEN REPLY");
    expect(plain).not.toContain("Malayalam");

    const voice = buildSystemPrompt({ ...base, reply: "voice" });
    expect(voice).toContain(replyStyleSection("voice"));
    expect(voice).not.toContain("LANGUAGE — answer in Malayalam");
    // The added lines sit after the answer format and before the reference data.
    expect(voice.indexOf("SPOKEN REPLY")).toBeGreaterThan(voice.indexOf("ANSWER FORMAT"));
    expect(voice.indexOf("SPOKEN REPLY")).toBeLessThan(voice.indexOf("CATEGORIES (id"));

    const ml = buildSystemPrompt({ ...base, reply: "voice", language: "ml" });
    expect(ml).toContain("SPOKEN REPLY");
    expect(ml).toContain("LANGUAGE — answer in Malayalam");
    expect(ml).toContain("Never write a number in words.");
    // Numbers still come only from tools (D-011).
    expect(ml).toContain("You never do arithmetic.");

    expect(replyStyleSection("voice", "en").split("\n")).toEqual([
      "",
      "",
      "SPOKEN REPLY — the person is talking to you; the app reads your first block aloud",
      "- Make the FIRST block a text block with a 1–2 sentence spoken answer that leads with the answer. No tables, lists, symbols, ids or dates in YYYY-MM-DD form.",
      "- Put the details (stat, bars, transactions, further text) in the blocks after it; they stay on screen.",
      "- Any figure in the spoken answer is still copied verbatim from a tool's Display string.",
      "- After a propose_* tool, the spoken answer says what you suggested and that they can tap Confirm on screen. Never ask them to confirm by voice.",
    ]);
    expect(replyStyleSection("text", "ml").split("\n")).toEqual([
      "",
      "",
      "LANGUAGE — answer in Malayalam",
      "- Write every text block, stat label, caption and bars title in Malayalam script.",
      "- Keep amounts and numbers exactly as the tools give them, in digits with ₹ (for example ₹1,71,518.44). Never write a number in words.",
      "- Category, tag, member and merchant names stay as they are.",
      "- The question may be in Malayalam, English or a mix of both, possibly with recognition errors; understand it as best you can.",
    ]);
  });
  it("chunks text without losing characters", () => {
    const text = "You spent ₹84,151.25 in October 2026, which is 48.9% more than in September.\nMostly food.";
    const chunks = chunkText(text, 20);
    expect(chunks.join("")).toBe(text);
    expect(chunks.length).toBeGreaterThan(3);
  });
});
