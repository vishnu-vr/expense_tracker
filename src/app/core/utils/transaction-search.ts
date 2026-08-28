import { Transaction } from '../models/models';

/**
 * View-layer match for the transactions list search.
 * Does not change period totals or persisted data.
 */
export function transactionMatchesQuery(
    transaction: Pick<Transaction, 'amount' | 'note' | 'type' | 'userEmail'>,
    query: string,
    extras: { categoryName?: string; tagNames?: string[] } = {}
): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;

    const haystacks: string[] = [
        extras.categoryName ?? '',
        transaction.note ?? '',
        transaction.type,
        transaction.userEmail ?? '',
        String(transaction.amount),
        transaction.amount.toFixed(2),
        ...(extras.tagNames ?? [])
    ];

    return haystacks.some((value) => value.toLowerCase().includes(q));
}
