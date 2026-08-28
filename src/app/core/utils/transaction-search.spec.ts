import { transactionMatchesQuery } from './transaction-search';

describe('transactionMatchesQuery', () => {
    const tx = {
        amount: 1200.5,
        note: 'Lunch at cafe',
        type: 'expense' as const,
        userEmail: 'alex@example.com'
    };

    it('matches everything when the query is empty', () => {
        expect(transactionMatchesQuery(tx, '  ')).toBeTrue();
    });

    it('matches category, note, tags, type, amount, and email', () => {
        expect(transactionMatchesQuery(tx, 'food', { categoryName: 'Food' })).toBeTrue();
        expect(transactionMatchesQuery(tx, 'cafe')).toBeTrue();
        expect(transactionMatchesQuery(tx, 'trip', { tagNames: ['Goa Trip'] })).toBeTrue();
        expect(transactionMatchesQuery(tx, 'expense')).toBeTrue();
        expect(transactionMatchesQuery(tx, '1200.5')).toBeTrue();
        expect(transactionMatchesQuery(tx, 'alex@')).toBeTrue();
    });

    it('returns false when nothing matches', () => {
        expect(transactionMatchesQuery(tx, 'salary', { categoryName: 'Food', tagNames: ['Goa'] })).toBeFalse();
    });
});
