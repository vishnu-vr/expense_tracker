import { z } from "zod";
import { LTx } from "./types";

/**
 * Response blocks — the contract with the Flutter app, which renders each
 * type as a native widget. Do not change these shapes without changing the app.
 */
export const TextBlockSchema = z.object({ type: z.literal("text"), text: z.string().min(1) });
export const StatBlockSchema = z.object({
  type: z.literal("stat"),
  label: z.string().min(1),
  value: z.string().min(1),
  caption: z.string().optional(),
});
export const BarsBlockSchema = z.object({
  type: z.literal("bars"),
  title: z.string().optional(),
  items: z
    .array(z.object({ label: z.string(), value: z.number().finite(), display: z.string() }))
    .min(1)
    .max(60),
});
export const TransactionsBlockSchema = z.object({
  type: z.literal("transactions"),
  items: z
    .array(
      z.object({
        id: z.string(),
        note: z.string(),
        categoryName: z.string(),
        amount: z.number(),
        type: z.enum(["income", "expense"]),
        /** ISO-8601 instant */
        date: z.string(),
      }),
    )
    .min(1)
    .max(50),
});
export const ProposalActionSchema = z.enum(["set_budget", "tag_transactions", "recategorise"]);
export const ProposalBlockSchema = z.object({
  type: z.literal("proposal"),
  proposalId: z.string().min(1),
  action: ProposalActionSchema,
  summary: z.string().min(1),
});

export const BlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  StatBlockSchema,
  BarsBlockSchema,
  TransactionsBlockSchema,
  ProposalBlockSchema,
]);
export type Block = z.infer<typeof BlockSchema>;
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

/**
 * What the MODEL sends to the `respond` tool. It is deliberately flat (no
 * unions — every provider handles it) and never carries transaction or
 * proposal details: the model names ids, the server fills in the data.
 */
export const DraftBlockSchema = z.object({
  type: z.enum(["text", "stat", "bars", "transactions", "proposal"]),
  text: z.string().optional().describe("text block: the prose"),
  label: z.string().optional().describe("stat block: short label, e.g. 'Spent in October'"),
  value: z.string().optional().describe("stat block: the figure exactly as a tool returned it, e.g. '₹12,340'"),
  caption: z.string().optional().describe("stat block: optional small print"),
  title: z.string().optional().describe("bars block: optional chart title"),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.number().describe("the raw number from the tool result"),
        display: z.string().optional().describe("the matching ...Display string from the tool result"),
      }),
    )
    .optional()
    .describe("bars block: one bar per item"),
  transactionIds: z.array(z.string()).optional().describe("transactions block: ids of transactions returned by tools"),
  proposalId: z.string().optional().describe("proposal block: id returned by a propose_* tool"),
});
export type DraftBlock = z.infer<typeof DraftBlockSchema>;

export interface BlockContext {
  /** Transactions of the caller's home, for hydrating `transactions` blocks. */
  transactionById: (id: string) => LTx | undefined;
  categoryName: (id: string) => string;
  /** Proposals created during this run. */
  proposalById: (id: string) => { action: ProposalAction; summary: string } | undefined;
  formatNumber: (n: number) => string;
}

const MAX_BLOCKS = 12;

/**
 * Turn whatever the model produced into valid blocks. Invalid or empty
 * blocks are dropped; unknown transaction / proposal ids are dropped (the
 * model cannot invent data). If nothing valid remains, falls back to a single
 * text block.
 */
export function normalizeBlocks(raw: unknown, ctx: BlockContext, fallbackText: string): Block[] {
  const out: Block[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list.slice(0, MAX_BLOCKS * 2)) {
    const draft = DraftBlockSchema.safeParse(item);
    if (!draft.success) continue;
    const d = draft.data;
    let candidate: unknown = null;
    switch (d.type) {
      case "text":
        candidate = { type: "text", text: (d.text ?? "").trim() };
        break;
      case "stat":
        candidate = {
          type: "stat",
          label: (d.label ?? "").trim(),
          value: (d.value ?? "").trim(),
          ...(d.caption?.trim() ? { caption: d.caption.trim() } : {}),
        };
        break;
      case "bars":
        candidate = {
          type: "bars",
          ...(d.title?.trim() ? { title: d.title.trim() } : {}),
          items: (d.items ?? []).map((i) => ({
            label: i.label,
            value: i.value,
            display: i.display?.trim() ? i.display.trim() : ctx.formatNumber(i.value),
          })),
        };
        break;
      case "transactions": {
        const seen = new Set<string>();
        const items = (d.transactionIds ?? [])
          .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
          .map((id) => ctx.transactionById(id))
          .filter((t): t is LTx => !!t)
          .slice(0, 50)
          .map((t) => ({
            id: t.id,
            note: t.note ?? "",
            categoryName: ctx.categoryName(t.categoryId),
            amount: t.amount,
            type: t.type,
            date: t.date.toISOString(),
          }));
        candidate = { type: "transactions", items };
        break;
      }
      case "proposal": {
        const p = d.proposalId ? ctx.proposalById(d.proposalId) : undefined;
        candidate = p ? { type: "proposal", proposalId: d.proposalId, action: p.action, summary: p.summary } : null;
        break;
      }
    }
    const parsed = BlockSchema.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
    if (out.length >= MAX_BLOCKS) break;
  }
  if (out.length === 0) {
    const text = fallbackText.trim() || "Sorry, I could not put together an answer. Please try rephrasing.";
    return [{ type: "text", text }];
  }
  return out;
}

/** Plain-text rendering of blocks, used to replay earlier assistant turns as history. */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "text":
          return b.text;
        case "stat":
          return `[stat] ${b.label}: ${b.value}${b.caption ? ` (${b.caption})` : ""}`;
        case "bars":
          return `[chart${b.title ? ` ${b.title}` : ""}] ${b.items.map((i) => `${i.label}: ${i.display}`).join("; ")}`;
        case "transactions":
          return `[transactions] ${b.items
            .map((i) => `${i.id} ${i.date.slice(0, 10)} ${i.categoryName} ${i.amount} ${i.note}`.trim())
            .join("; ")}`;
        case "proposal":
          return `[proposal ${b.proposalId}] ${b.summary}`;
      }
    })
    .join("\n");
}
