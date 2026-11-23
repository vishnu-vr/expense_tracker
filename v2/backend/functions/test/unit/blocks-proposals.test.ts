import { describe, expect, it } from "vitest";
import { BlockContext, BlockSchema, blocksToText, normalizeBlocks } from "../../src/core/blocks";
import { formatINR } from "../../src/core/money";
import { buildProposal } from "../../src/core/proposals";
import { home, tx } from "./helpers";

const data = home(
  [
    tx("2026-10-05", 400, "food", "Swiggy", { id: "mine1" }),
    tx("2026-10-06", 600, "food", "Zomato", { id: "mine2", tagIds: ["trip"] }),
    tx("2026-10-07", 900, "food", "Dinner", { id: "theirs", userId: "u2" }),
    tx("2026-10-01", 50000, "salary", "Salary", { id: "inc", type: "income" }),
  ],
  [{ categoryId: "food", amount: 10000 }],
);
const byId = new Map(data.transactions.map((t) => [t.id, t]));
const ctx: BlockContext = {
  transactionById: (id) => byId.get(id),
  categoryName: (id) => (id === "food" ? "Food" : id),
  proposalById: (id) => (id === "p1" ? { action: "set_budget", summary: "Set a monthly Food budget of ₹14,000" } : undefined),
  formatNumber: formatINR,
};

describe("normalizeBlocks", () => {
  it("produces exactly the block shapes the app renders", () => {
    const blocks = normalizeBlocks(
      [
        { type: "text", text: " You spent a lot. " },
        { type: "stat", label: "October", value: "₹1,900", caption: "3 entries" },
        { type: "bars", title: "By month", items: [{ label: "Sep", value: 100, display: "₹100" }, { label: "Oct", value: 1900 }] },
        { type: "transactions", transactionIds: ["mine1", "ghost", "mine1", "theirs"] },
        { type: "proposal", proposalId: "p1" },
      ],
      ctx,
      "",
    );
    expect(blocks).toEqual([
      { type: "text", text: "You spent a lot." },
      { type: "stat", label: "October", value: "₹1,900", caption: "3 entries" },
      { type: "bars", title: "By month", items: [{ label: "Sep", value: 100, display: "₹100" }, { label: "Oct", value: 1900, display: "₹1,900" }] },
      {
        type: "transactions",
        items: [
          { id: "mine1", note: "Swiggy", categoryName: "Food", amount: 400, type: "expense", date: "2026-10-05T06:30:00.000Z" },
          { id: "theirs", note: "Dinner", categoryName: "Food", amount: 900, type: "expense", date: "2026-10-07T06:30:00.000Z" },
        ],
      },
      { type: "proposal", proposalId: "p1", action: "set_budget", summary: "Set a monthly Food budget of ₹14,000" },
    ]);
    for (const b of blocks) expect(BlockSchema.safeParse(b).success).toBe(true);
  });

  it("drops invalid blocks, unknown ids and invented proposals", () => {
    const blocks = normalizeBlocks(
      [
        { type: "chart", text: "?" },
        { type: "stat", label: "No value" },
        { type: "bars", items: [] },
        { type: "transactions", transactionIds: ["ghost"] },
        { type: "proposal", proposalId: "made-up" },
        "nonsense",
        { type: "text", text: "Kept." },
      ],
      ctx,
      "",
    );
    expect(blocks).toEqual([{ type: "text", text: "Kept." }]);
  });

  it("falls back to a single text block when nothing valid was produced", () => {
    expect(normalizeBlocks(undefined, ctx, "Plain answer from the model.")).toEqual([{ type: "text", text: "Plain answer from the model." }]);
    expect(normalizeBlocks("garbage", ctx, "")).toEqual([
      { type: "text", text: "Sorry, I could not put together an answer. Please try rephrasing." },
    ]);
    expect(normalizeBlocks([{ type: "text", text: "   " }], ctx, "Fallback")).toEqual([{ type: "text", text: "Fallback" }]);
  });

  it("caps the number of blocks", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ type: "text", text: `line ${i}` }));
    expect(normalizeBlocks(many, ctx, "")).toHaveLength(12);
  });

  it("renders blocks back to text for conversation history", () => {
    const text = blocksToText([
      { type: "text", text: "Hello" },
      { type: "stat", label: "Spent", value: "₹100" },
      { type: "proposal", proposalId: "p1", action: "set_budget", summary: "Set budget" },
    ]);
    expect(text).toBe("Hello\n[stat] Spent: ₹100\n[proposal p1] Set budget");
  });
});

describe("buildProposal", () => {
  it("set_budget: validates the category and amount and describes the change", () => {
    expect(buildProposal(data, "u1", { action: "set_budget", categoryId: "food", amount: 14000 })).toEqual({
      ok: true,
      proposal: {
        action: "set_budget",
        params: { action: "set_budget", categoryId: "food", amount: 14000 },
        summary: "Change the monthly Food budget from ₹10,000 to ₹14,000",
        skipped: [],
      },
    });
    const fresh = buildProposal(data, "u1", { action: "set_budget", categoryId: "grocery", amount: 8000 });
    expect(fresh.ok && fresh.proposal.summary).toBe("Set a monthly Grocery budget of ₹8,000");
    expect(buildProposal(data, "u1", { action: "set_budget", categoryId: "nope", amount: 1 }).ok).toBe(false);
    expect(buildProposal(data, "u1", { action: "set_budget", categoryId: "salary", amount: 1 }).ok).toBe(false);
    expect(buildProposal(data, "u1", { action: "set_budget", categoryId: "food", amount: -5 }).ok).toBe(false);
    expect(buildProposal(data, "u1", { action: "set_budget", categoryId: "food", amount: NaN }).ok).toBe(false);
  });

  it("tag_transactions: only the caller's own entries, skipping ones already tagged", () => {
    const r = buildProposal(data, "u1", { action: "tag_transactions", transactionIds: ["mine1", "mine2", "theirs", "ghost"], tagId: "trip" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.params).toEqual({ action: "tag_transactions", transactionIds: ["mine1"], tagId: "trip" });
    expect(r.proposal.summary).toBe('Add the tag "Trip" to 1 transaction totalling ₹400');
    expect(r.proposal.skipped).toEqual([
      { id: "mine2", reason: "no_change" },
      { id: "theirs", reason: "not_owner" },
      { id: "ghost", reason: "not_found" },
    ]);
    expect(buildProposal(data, "u1", { action: "tag_transactions", transactionIds: ["mine1"], tagId: "unknown" }).ok).toBe(false);
  });

  it("recategorise: refuses another member's entries and income/expense mismatches", () => {
    const r = buildProposal(data, "u1", { action: "recategorise", transactionIds: ["mine1", "mine2", "inc"], categoryId: "grocery" });
    expect(r.ok && r.proposal.params).toEqual({ action: "recategorise", transactionIds: ["mine1", "mine2"], categoryId: "grocery" });
    expect(r.ok && r.proposal.summary).toBe("Move 2 transactions (₹1,000) from Food to Grocery");
    expect(r.ok && r.proposal.skipped).toEqual([{ id: "inc", reason: "wrong_type" }]);
    const denied = buildProposal(data, "u1", { action: "recategorise", transactionIds: ["theirs"], categoryId: "grocery" });
    expect(denied).toEqual({
      ok: false,
      error: "Nothing to change: the transactions are added by another member (only the member who added an entry can change it).",
    });
    expect(buildProposal(data, "u1", { action: "recategorise", transactionIds: [], categoryId: "grocery" }).ok).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, i) => `id${i}`);
    expect(buildProposal(data, "u1", { action: "recategorise", transactionIds: tooMany, categoryId: "grocery" }).ok).toBe(false);
  });
});
