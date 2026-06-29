import { Transaction } from '../models/models';

/** Parse `YYYY-MM-DD` from a date input (local calendar month). */
export function monthKeyFromDateInput(dateStr: string | null | undefined): { year: number; month: number } | null {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return null;
    return { year, month };
}

export function spentForCategoryInMonth(
    transactions: Transaction[],
    categoryId: string,
    year: number,
    month: number,
    excludeTransactionId?: string | null
): number {
    let sum = 0;
    for (const t of transactions) {
        if (t.type !== 'expense' || t.categoryId !== categoryId) continue;
        if (excludeTransactionId && t.id === excludeTransactionId) continue;
        const d = new Date(t.date);
        if (d.getFullYear() !== year || d.getMonth() !== month) continue;
        sum += t.amount;
    }
    return sum;
}

export type BudgetDraftAlertLevel = 'approach' | 'over';

export interface BudgetDraftAlert {
    level: BudgetDraftAlertLevel;
    budget: number;
    spentBefore: number;
    draftAmount: number;
    projected: number;
    projectedPct: number;
}

const DEFAULT_APPROACH_THRESHOLD = 0.9;

/**
 * While adding/editing an expense: warn when the month’s spend for the category
 * (including this draft amount) reaches `approachThreshold` of the recurring budget (default 90%),
 * or when it would exceed the budget.
 */
export function budgetDraftAlert(
    budget: number,
    spentBefore: number,
    draftAmount: number,
    options?: { approachThreshold?: number }
): BudgetDraftAlert | null {
    if (!Number.isFinite(budget) || budget <= 0) return null;
    const draft = Number.isFinite(draftAmount) && draftAmount > 0 ? draftAmount : 0;
    const projected = spentBefore + draft;
    const threshold = options?.approachThreshold ?? DEFAULT_APPROACH_THRESHOLD;
    const projectedPct = (projected / budget) * 100;

    if (projected > budget) {
        return { level: 'over', budget, spentBefore, draftAmount: draft, projected, projectedPct };
    }
    if (projected >= budget * threshold) {
        return { level: 'approach', budget, spentBefore, draftAmount: draft, projected, projectedPct };
    }
    return null;
}
