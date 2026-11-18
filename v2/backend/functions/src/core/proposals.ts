import { categoryNameLookup } from "./categories";
import { formatINR, round2, sum } from "./money";
import { ProposalAction } from "./blocks";
import { HomeData } from "./types";

export type ProposalStatus = "pending" | "applied" | "rejected";

export type ProposalParams =
  | { action: "set_budget"; categoryId: string; amount: number }
  | { action: "tag_transactions"; transactionIds: string[]; tagId: string }
  | { action: "recategorise"; transactionIds: string[]; categoryId: string };

export interface ProposalDraft {
  action: ProposalAction;
  params: ProposalParams;
  summary: string;
  /** Ids the caller asked for but that were left out, with the reason. */
  skipped: { id: string; reason: "not_found" | "not_owner" | "wrong_type" | "no_change" }[];
}

export type ProposalBuildResult = { ok: true; proposal: ProposalDraft } | { ok: false; error: string };

export const MAX_PROPOSAL_TRANSACTIONS = 200;

/**
 * Validate a proposed write against the household's data and describe it.
 * Nothing is written here or by the model: the draft is stored as `pending`
 * and only applied by `confirmProposal` after the user accepts.
 *
 * Mirrors the security rules: a member may only change transactions they own.
 */
export function buildProposal(data: HomeData, callerUid: string, input: ProposalParams): ProposalBuildResult {
  const catName = categoryNameLookup(data.categories);
  const category = (id: string) => data.categories.find((c) => c.id === id);

  if (input.action === "set_budget") {
    const cat = category(input.categoryId);
    if (!cat) return { ok: false, error: `Unknown categoryId "${input.categoryId}". Use list_categories.` };
    if (cat.type !== "expense") return { ok: false, error: "Budgets can only be set on expense categories." };
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1e9) {
      return { ok: false, error: "Budget amount must be a positive number." };
    }
    const amount = round2(input.amount);
    const current = data.budgets.find((b) => b.categoryId === cat.id && b.amount > 0);
    return {
      ok: true,
      proposal: {
        action: "set_budget",
        params: { action: "set_budget", categoryId: cat.id, amount },
        summary: current
          ? `Change the monthly ${cat.name} budget from ${formatINR(current.amount)} to ${formatINR(amount)}`
          : `Set a monthly ${cat.name} budget of ${formatINR(amount)}`,
        skipped: [],
      },
    };
  }

  const ids = [...new Set(input.transactionIds ?? [])];
  if (ids.length === 0) return { ok: false, error: "No transactionIds given." };
  if (ids.length > MAX_PROPOSAL_TRANSACTIONS) {
    return { ok: false, error: `At most ${MAX_PROPOSAL_TRANSACTIONS} transactions per proposal.` };
  }
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const skipped: ProposalDraft["skipped"] = [];

  if (input.action === "tag_transactions") {
    const tag = data.tags.find((t) => t.id === input.tagId);
    if (!tag) return { ok: false, error: `Unknown tagId "${input.tagId}". Use list_tags.` };
    const keep: string[] = [];
    for (const id of ids) {
      const t = byId.get(id);
      if (!t) skipped.push({ id, reason: "not_found" });
      else if (t.userId !== callerUid) skipped.push({ id, reason: "not_owner" });
      else if (t.tagIds.includes(tag.id)) skipped.push({ id, reason: "no_change" });
      else keep.push(id);
    }
    if (keep.length === 0) return { ok: false, error: noneLeft(skipped) };
    const total = sum(keep.map((id) => byId.get(id)!.amount));
    return {
      ok: true,
      proposal: {
        action: "tag_transactions",
        params: { action: "tag_transactions", transactionIds: keep, tagId: tag.id },
        summary: `Add the tag "${tag.name}" to ${plural(keep.length)} totalling ${formatINR(total)}`,
        skipped,
      },
    };
  }

  const cat = category(input.categoryId);
  if (!cat) return { ok: false, error: `Unknown categoryId "${input.categoryId}". Use list_categories.` };
  const keep: string[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (!t) skipped.push({ id, reason: "not_found" });
    else if (t.userId !== callerUid) skipped.push({ id, reason: "not_owner" });
    else if (t.type !== cat.type) skipped.push({ id, reason: "wrong_type" });
    else if (t.categoryId === cat.id) skipped.push({ id, reason: "no_change" });
    else keep.push(id);
  }
  if (keep.length === 0) return { ok: false, error: noneLeft(skipped) };
  const total = sum(keep.map((id) => byId.get(id)!.amount));
  const from = [...new Set(keep.map((id) => catName(byId.get(id)!.categoryId)))];
  return {
    ok: true,
    proposal: {
      action: "recategorise",
      params: { action: "recategorise", transactionIds: keep, categoryId: cat.id },
      summary: `Move ${plural(keep.length)} (${formatINR(total)}) from ${from.slice(0, 3).join(", ")}${
        from.length > 3 ? "…" : ""
      } to ${cat.name}`,
      skipped,
    },
  };
}

function plural(n: number): string {
  return `${n} transaction${n === 1 ? "" : "s"}`;
}

function noneLeft(skipped: ProposalDraft["skipped"]): string {
  const reasons = [...new Set(skipped.map((s) => s.reason))];
  const text: Record<string, string> = {
    not_found: "not found in this household",
    not_owner: "added by another member (only the member who added an entry can change it)",
    wrong_type: "of a different type (income vs expense) than the target category",
    no_change: "already in that state",
  };
  return `Nothing to change: the transactions are ${reasons.map((r) => text[r]).join("; ")}.`;
}
