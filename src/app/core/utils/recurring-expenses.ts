import { Transaction } from '../models/models';

export interface RecurringExpenseInsight {
    key: string;
    label: string;
    categoryId: string;
    categoryName: string;
    cadenceLabel: string;
    averageAmount: number;
    occurrences: number;
    lastPaidDate: Date;
}

function normalizeNote(note?: string): string {
    if (!note) return '';
    return note
        .toLowerCase()
        .replace(/\d+/g, ' ')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toTitleCase(text: string): string {
    return text
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const variance =
        values.reduce((sum, value) => {
            const delta = value - mean;
            return sum + delta * delta;
        }, 0) / values.length;
    return Math.sqrt(variance);
}

function detectCadence(avgInterval: number, stdDev: number): string | null {
    if (avgInterval >= 5 && avgInterval <= 9 && stdDev <= 2) return 'weekly';
    if (avgInterval >= 10 && avgInterval <= 18 && stdDev <= 3) return 'every 2 weeks';
    if (avgInterval >= 24 && avgInterval <= 40 && stdDev <= 7) return 'monthly';
    if (avgInterval >= 75 && avgInterval <= 105 && stdDev <= 12) return 'quarterly';
    return null;
}

/**
 * Detect recurring expenses from transaction history using the same statistical
 * algorithm as TrendsComponent (cadence + amount variation thresholds).
 */
export function detectRecurringExpenses(
    expenses: Transaction[],
    categoryNameById: (id: string) => string,
    options?: { maxResults?: number; userId?: string | null }
): RecurringExpenseInsight[] {
    const maxResults = options?.maxResults ?? 4;
    const userId = options?.userId ?? null;

    const filtered = expenses
        .filter((t) => t.type === 'expense')
        .filter((t) => !userId || t.userId === userId);

    if (filtered.length < 3) return [];

    type Candidate = {
        txDate: Date;
        amount: number;
        categoryId: string;
        noteKey: string;
    };

    const groups = new Map<string, Candidate[]>();
    filtered.forEach((expense) => {
        const txDate = new Date(expense.date);
        const noteKey = normalizeNote(expense.note);
        const key = `${expense.categoryId}::${noteKey || 'no-note'}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push({
            txDate,
            amount: expense.amount,
            categoryId: expense.categoryId,
            noteKey
        });
    });

    const recurring: RecurringExpenseInsight[] = [];
    groups.forEach((txns, key) => {
        if (txns.length < 3) return;

        const sorted = [...txns].sort((a, b) => a.txDate.getTime() - b.txDate.getTime());
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
            const diffDays = Math.round(
                (sorted[i].txDate.getTime() - sorted[i - 1].txDate.getTime()) / 86400000
            );
            intervals.push(diffDays);
        }

        const avgInterval = average(intervals);
        const intervalStdDev = standardDeviation(intervals, avgInterval);
        const cadence = detectCadence(avgInterval, intervalStdDev);
        if (!cadence) return;

        const amounts = sorted.map((t) => t.amount);
        const avgAmount = average(amounts);
        if (avgAmount <= 0) return;

        const amountStdDev = standardDeviation(amounts, avgAmount);
        const amountVariation = amountStdDev / avgAmount;
        const hasNoNote = sorted[0].noteKey.length === 0;
        const maxVariation = hasNoNote ? 0.2 : 0.35;
        if (amountVariation > maxVariation) return;

        const categoryId = sorted[0].categoryId;
        const categoryName = categoryNameById(categoryId) || 'Uncategorized';
        const label = sorted[0].noteKey ? toTitleCase(sorted[0].noteKey) : categoryName;
        const lastPaidDate = sorted[sorted.length - 1].txDate;

        recurring.push({
            key,
            label,
            categoryId,
            categoryName,
            cadenceLabel: cadence,
            averageAmount: avgAmount,
            occurrences: sorted.length,
            lastPaidDate
        });
    });

    return recurring.sort((a, b) => b.averageAmount - a.averageAmount).slice(0, maxResults);
}
