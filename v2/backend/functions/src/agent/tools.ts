import { z } from "zod";
import { findAnomalies } from "../core/anomalies";
import { DraftBlockSchema, ProposalAction } from "../core/blocks";
import { budgetStatus } from "../core/budget";
import { comparePeriods } from "../core/compare";
import { isValidDay, monthKey } from "../core/dates";
import { buildProposal, ProposalParams } from "../core/proposals";
import { makeRowMapper, queryTransactions } from "../core/query";
import { detectRecurringBills, recurringMonthlyTotal } from "../core/recurring";
import { formatINR } from "../core/money";
import { AgentBackend } from "./backend";

export interface ToolRunContext {
  backend: AgentBackend;
  /** Today's calendar day in the caller's time zone. */
  today: string;
  /** Proposals created while answering this question (id -> action + summary). */
  proposals: Map<string, { action: ProposalAction; summary: string }>;
}

export interface ToolSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** Shown to the user while the tool runs. */
  status: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>, ctx: ToolRunContext) => Promise<unknown>;
}

const day = (what: string) => z.string().describe(`${what}, as YYYY-MM-DD (inclusive)`);
const ids = (what: string) => z.array(z.string()).optional().describe(what);

function assertDays(...days: (string | undefined)[]): void {
  for (const d of days) {
    if (d !== undefined && !isValidDay(d)) throw new Error(`"${d}" is not a valid YYYY-MM-DD date.`);
  }
}
function assertRange(from?: string, to?: string): void {
  assertDays(from, to);
  if (from && to && from > to) throw new Error(`Range start ${from} is after its end ${to}.`);
}

const spec = <S extends z.ZodTypeAny>(s: ToolSpec<S>): ToolSpec<S> => s;

/**
 * The agent's tools. Each one computes exact numbers in code (see `core/`)
 * and returns raw values next to ready-to-quote `...Display` strings.
 * None of them accepts a home id: the backend is already bound to the
 * caller's household.
 */
export const TOOL_SPECS = [
  spec({
    name: "query_transactions",
    status: "Looking through transactions…",
    description:
      "Filter and aggregate the household's transactions. Returns exact totals, counts and averages, optional groups " +
      "(by category, month, week, weekday, member or merchant) and a capped list of matching rows. " +
      "`type` defaults to expense. Use this for any 'how much / how many / biggest / list' question.",
    inputSchema: z.object({
      from: day("Start date").optional(),
      to: day("End date").optional(),
      type: z.enum(["expense", "income", "all"]).optional().describe("Default expense"),
      categoryIds: ids("Only these category ids (from list_categories)"),
      tagIds: ids("Only transactions carrying any of these tag ids (from list_tags)"),
      userIds: ids("Only transactions added by these member ids (from list_members)"),
      minAmount: z.number().optional(),
      maxAmount: z.number().optional(),
      text: z.string().optional().describe("Match on the note text or merchant name, e.g. 'swiggy'"),
      groupBy: z.enum(["category", "month", "week", "weekday", "member", "merchant", "none"]).optional(),
      topN: z.number().optional().describe("Max groups for category/member/merchant grouping (default 10, max 50)"),
      rowLimit: z.number().optional().describe("Max rows to return (default 10, max 50; 0 for none)"),
      rowSort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).optional(),
    }),
    run: async (input, ctx) => {
      assertRange(input.from, input.to);
      const { groupBy, topN, rowLimit, rowSort, ...filter } = input;
      return queryTransactions(await ctx.backend.loadData(), filter, { groupBy, topN, rowLimit, rowSort });
    },
  }),
  spec({
    name: "compare_periods",
    status: "Comparing the two periods…",
    description:
      "Compare two date ranges: totals for each, the change (B minus A) and the change per category. " +
      "Period A is the baseline (usually the earlier one).",
    inputSchema: z.object({
      fromA: day("Period A start"),
      toA: day("Period A end"),
      fromB: day("Period B start"),
      toB: day("Period B end"),
      type: z.enum(["expense", "income"]).optional().describe("Default expense"),
      categoryIds: ids("Limit to these category ids"),
      tagIds: ids("Limit to these tag ids"),
      userIds: ids("Limit to these member ids"),
    }),
    run: async (input, ctx) => {
      assertRange(input.fromA, input.toA);
      assertRange(input.fromB, input.toB);
      return comparePeriods(
        await ctx.backend.loadData(),
        { from: input.fromA, to: input.toA },
        { from: input.fromB, to: input.toB },
        { type: input.type, categoryIds: input.categoryIds, tagIds: input.tagIds, userIds: input.userIds },
      );
    },
  }),
  spec({
    name: "budget_status",
    status: "Checking budgets…",
    description:
      "Monthly category budgets for a month (default: the current month): budget, spent, remaining, percent used, " +
      "pacing ratio, month-end forecast and the day a budget was or will be crossed.",
    inputSchema: z.object({
      month: z.string().optional().describe("YYYY-MM; defaults to the current month"),
      categoryIds: ids("Limit to these category ids"),
    }),
    run: async (input, ctx) => {
      if (input.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
        throw new Error(`"${input.month}" is not a valid YYYY-MM month.`);
      }
      return budgetStatus(await ctx.backend.loadData(), ctx.today, input.month ?? monthKey(ctx.today), input.categoryIds);
    },
  }),
  spec({
    name: "recurring_bills",
    status: "Finding recurring bills…",
    description:
      "Detected recurring expenses (subscriptions, rent, bills): cadence, usual and latest amount, last paid and next " +
      "expected dates, whether a payment is missed or the series has stopped, and any price change.",
    inputSchema: z.object({
      userId: z.string().optional().describe("Only this member's entries"),
      includeStopped: z.boolean().optional().describe("Default true"),
    }),
    run: async (input, ctx) => {
      const bills = detectRecurringBills(await ctx.backend.loadData(), ctx.today, {
        userId: input.userId,
        includeStopped: input.includeStopped,
      });
      const monthly = recurringMonthlyTotal(bills);
      return {
        asOf: ctx.today,
        count: bills.length,
        monthlyEquivalentTotal: monthly,
        monthlyEquivalentTotalDisplay: formatINR(monthly),
        bills,
      };
    },
  }),
  spec({
    name: "find_anomalies",
    status: "Looking for unusual entries…",
    description:
      "Unusually large expenses (far above the norm for their merchant or category) and likely duplicate entries. " +
      "Optionally limited to a date range; recurring bills are not reported as unusual.",
    inputSchema: z.object({
      from: day("Start date").optional(),
      to: day("End date").optional(),
      limit: z.number().optional().describe("Max results of each kind (default 10)"),
    }),
    run: async (input, ctx) => {
      assertRange(input.from, input.to);
      const data = await ctx.backend.loadData();
      const recurring = detectRecurringBills(data, ctx.today, { maxResults: 200 });
      return findAnomalies(data, {
        range: { from: input.from, to: input.to },
        excludeRecurringKeys: new Set(recurring.map((b) => b.key)),
        limit: input.limit,
      });
    },
  }),
  spec({
    name: "search_notes",
    status: "Searching notes…",
    description:
      "Semantic search over transaction notes — use when the user describes something loosely " +
      "('that plumber', 'the anniversary dinner') and a plain text filter may miss it. Returns matching transactions, " +
      "best match first. It returns rows only; use query_transactions for totals.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().optional().describe("Default 10, max 25"),
    }),
    run: async (input, ctx) => {
      const limit = Math.max(1, Math.min(25, Math.floor(input.limit ?? 10)));
      const [data, hits] = await Promise.all([ctx.backend.loadData(), ctx.backend.searchNotes(input.query, limit)]);
      const toRow = makeRowMapper(data);
      const byId = new Map(data.transactions.map((t) => [t.id, t]));
      const rows = hits
        .map((h) => byId.get(h.transactionId))
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map(toRow);
      return { count: rows.length, rows };
    },
  }),
  spec({
    name: "list_categories",
    status: "Reading categories…",
    description: "All categories of the household (id, name, type).",
    inputSchema: z.object({}),
    run: async (_input, ctx) => {
      const data = await ctx.backend.loadData();
      return { categories: data.categories.map((c) => ({ id: c.id, name: c.name, type: c.type })) };
    },
  }),
  spec({
    name: "list_tags",
    status: "Reading tags…",
    description: "All tags of the household (id, name).",
    inputSchema: z.object({}),
    run: async (_input, ctx) => {
      const data = await ctx.backend.loadData();
      return { tags: data.tags.map((t) => ({ id: t.id, name: t.name })) };
    },
  }),
  spec({
    name: "list_members",
    status: "Reading household members…",
    description: "Members of the household (id, name) and which one is the person asking.",
    inputSchema: z.object({}),
    run: async (_input, ctx) => {
      const data = await ctx.backend.loadData();
      return {
        members: data.members.map((m) => ({ id: m.id, name: m.name, isCaller: m.id === ctx.backend.uid })),
      };
    },
  }),
  spec({
    name: "propose_set_budget",
    status: "Preparing a budget suggestion…",
    description:
      "Propose setting the monthly budget of an expense category. Nothing changes until the user confirms in the app. " +
      "Returns a proposalId — show it with a proposal block.",
    inputSchema: z.object({ categoryId: z.string(), amount: z.number().describe("Monthly budget in rupees") }),
    run: (input, ctx) => propose(ctx, { action: "set_budget", categoryId: input.categoryId, amount: input.amount }),
  }),
  spec({
    name: "propose_tag_transactions",
    status: "Preparing a tagging suggestion…",
    description:
      "Propose adding an existing tag to transactions. Only entries added by the person asking can be changed. " +
      "Nothing changes until the user confirms. Returns a proposalId — show it with a proposal block.",
    inputSchema: z.object({ transactionIds: z.array(z.string()).min(1), tagId: z.string() }),
    run: (input, ctx) =>
      propose(ctx, { action: "tag_transactions", transactionIds: input.transactionIds, tagId: input.tagId }),
  }),
  spec({
    name: "propose_recategorise",
    status: "Preparing a category change…",
    description:
      "Propose moving transactions to another category. Only entries added by the person asking can be changed. " +
      "Nothing changes until the user confirms. Returns a proposalId — show it with a proposal block.",
    inputSchema: z.object({ transactionIds: z.array(z.string()).min(1), categoryId: z.string() }),
    run: (input, ctx) =>
      propose(ctx, { action: "recategorise", transactionIds: input.transactionIds, categoryId: input.categoryId }),
  }),
] as const;

async function propose(ctx: ToolRunContext, params: ProposalParams): Promise<unknown> {
  const built = buildProposal(await ctx.backend.loadData(), ctx.backend.uid, params);
  if (!built.ok) return { error: built.error };
  const proposalId = await ctx.backend.createProposal(built.proposal);
  ctx.proposals.set(proposalId, { action: built.proposal.action, summary: built.proposal.summary });
  return {
    proposalId,
    status: "pending",
    summary: built.proposal.summary,
    skipped: built.proposal.skipped,
    note: "Not applied. The user must confirm it in the app.",
  };
}

/** The final answer. The model calls this once; the run stops there. */
export const RESPOND_TOOL = {
  name: "respond",
  description:
    "Send the final answer to the user as an ordered list of blocks. Call this exactly once, as the last step. " +
    "Block types: text (prose), stat (one headline figure), bars (a comparison across groups or periods), " +
    "transactions (a list — give the ids only), proposal (a pending change — give the proposalId only).",
  inputSchema: z.object({ blocks: z.array(DraftBlockSchema).min(1) }),
} as const;

/** Run a tool by name; failures become `{error}` so the model can recover. */
export async function runTool(name: string, input: unknown, ctx: ToolRunContext): Promise<unknown> {
  const tool = TOOL_SPECS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  const parsed = tool.inputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  }
  try {
    return await (tool.run as (i: unknown, c: ToolRunContext) => Promise<unknown>)(parsed.data, ctx);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed" };
  }
}
