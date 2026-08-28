import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { InsightsService } from './insights.service';
import { TransactionService } from './transaction.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { UserService } from './user.service';
import { HomeService } from './home.service';
import {
    budgetPacingRatio,
    dailyBurnRate,
    daysElapsedInMonth,
    monthEndForecast,
    pacingStatus,
    periodOverPeriodDelta,
    totalDaysInMonth
} from '../utils/insights-math';
import { detectRecurringExpenses } from '../utils/recurring-expenses';
import { Transaction } from '../models/models';

describe('insights-math utilities', () => {
    describe('daysElapsedInMonth', () => {
        it('returns day of month', () => {
            expect(daysElapsedInMonth(new Date(2026, 7, 18))).toBe(18);
        });
    });

    describe('totalDaysInMonth', () => {
        it('handles 31-day months', () => {
            expect(totalDaysInMonth(2026, 0)).toBe(31);
        });

        it('handles February in leap year', () => {
            expect(totalDaysInMonth(2024, 1)).toBe(29);
        });

        it('handles February in non-leap year', () => {
            expect(totalDaysInMonth(2026, 1)).toBe(28);
        });
    });

    describe('dailyBurnRate', () => {
        it('computes spent MTD / days elapsed', () => {
            expect(dailyBurnRate(9000, 18)).toBe(500);
        });

        it('returns 0 for zero days elapsed', () => {
            expect(dailyBurnRate(1000, 0)).toBe(0);
        });

        it('returns 0 for zero spend', () => {
            expect(dailyBurnRate(0, 10)).toBe(0);
        });
    });

    describe('monthEndForecast', () => {
        it('computes burn rate * total days', () => {
            expect(monthEndForecast(500, 31)).toBe(15500);
        });

        it('returns 0 for zero total days', () => {
            expect(monthEndForecast(500, 0)).toBe(0);
        });
    });

    describe('budgetPacingRatio', () => {
        it('computes (spent/budget) / (days/totalDays)', () => {
            const ratio = budgetPacingRatio(5200, 10000, 18, 31);
            expect(ratio).not.toBeNull();
            expect(ratio!).toBeCloseTo(0.895, 2);
        });

        it('returns null for zero budget', () => {
            expect(budgetPacingRatio(1000, 0, 10, 31)).toBeNull();
        });

        it('returns null for zero days elapsed', () => {
            expect(budgetPacingRatio(1000, 5000, 0, 31)).toBeNull();
        });

        it('flags warning when ratio > 1.1', () => {
            const ratio = budgetPacingRatio(8000, 10000, 18, 31);
            expect(pacingStatus(ratio)).toBe('warning');
        });

        it('flags on_track when ratio <= 1.0', () => {
            const ratio = budgetPacingRatio(4000, 10000, 18, 31);
            expect(pacingStatus(ratio)).toBe('on_track');
        });
    });

    describe('periodOverPeriodDelta', () => {
        it('computes percentage change', () => {
            expect(periodOverPeriodDelta(140, 100)).toBe(40);
            expect(periodOverPeriodDelta(80, 100)).toBe(-20);
        });

        it('returns null when previous is zero (zero-division protection)', () => {
            expect(periodOverPeriodDelta(100, 0)).toBeNull();
            expect(periodOverPeriodDelta(0, 0)).toBeNull();
        });
    });
});

describe('detectRecurringExpenses', () => {
    const mkTx = (partial: Partial<Transaction>): Transaction =>
        ({
            id: 't1',
            amount: 100,
            categoryId: 'rent',
            date: new Date(2026, 0, 1),
            type: 'expense',
            ...partial
        }) as Transaction;

    it('returns empty for fewer than 3 transactions', () => {
        const result = detectRecurringExpenses(
            [mkTx({ id: '1' }), mkTx({ id: '2' })],
            () => 'Rent'
        );
        expect(result).toEqual([]);
    });

    it('detects monthly recurring with stable amounts', () => {
        const txs = [
            mkTx({ id: '1', amount: 5000, date: new Date(2026, 0, 1), note: 'Rent payment' }),
            mkTx({ id: '2', amount: 5100, date: new Date(2026, 1, 1), note: 'Rent payment' }),
            mkTx({ id: '3', amount: 4950, date: new Date(2026, 2, 1), note: 'Rent payment' })
        ];
        const result = detectRecurringExpenses(txs, () => 'Rent');
        expect(result.length).toBe(1);
        expect(result[0].cadenceLabel).toBe('monthly');
        expect(result[0].label).toBe('Rent Payment');
    });
});

describe('InsightsService', () => {
    const transactions = [
        {
            id: '1',
            amount: 50000,
            categoryId: 'salary',
            date: new Date(2026, 7, 5),
            type: 'income' as const
        },
        {
            id: '2',
            amount: 3000,
            categoryId: 'food',
            date: new Date(2026, 7, 10),
            type: 'expense' as const,
            userId: 'u1'
        },
        {
            id: '3',
            amount: 2000,
            categoryId: 'food',
            date: new Date(2026, 7, 15),
            type: 'expense' as const,
            userId: 'u2'
        },
        {
            id: '4',
            amount: 40000,
            categoryId: 'salary',
            date: new Date(2026, 6, 5),
            type: 'income' as const
        },
        {
            id: '5',
            amount: 8000,
            categoryId: 'food',
            date: new Date(2026, 6, 10),
            type: 'expense' as const
        }
    ];

    let service: InsightsService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                InsightsService,
                {
                    provide: TransactionService,
                    useValue: {
                        transactions: signal(transactions)
                    }
                },
                {
                    provide: BudgetService,
                    useValue: {
                        categoryBudgets: signal([
                            { id: 'b1', categoryId: 'food', amount: 10000 }
                        ])
                    }
                },
                {
                    provide: CategoryService,
                    useValue: {
                        categories: signal([
                            { id: 'food', name: 'Food', icon: 'restaurant', color: '#f00', type: 'expense' },
                            { id: 'salary', name: 'Salary', icon: 'payments', color: '#0f0', type: 'income' }
                        ])
                    }
                },
                {
                    provide: UserService,
                    useValue: {
                        getUserName: (id: string) => (id === 'u1' ? 'Alice' : 'Bob')
                    }
                },
                {
                    provide: HomeService,
                    useValue: {
                        currentHome: signal({ id: 'h1', memberIds: ['u1', 'u2'] })
                    }
                }
            ]
        });

        service = TestBed.inject(InsightsService);
    });

    it('computes financial health for current month', () => {
        const health = service.financialHealth();
        expect(health.income).toBe(50000);
        expect(health.expense).toBe(5000);
        expect(health.netCashFlow).toBe(45000);
    });

    it('computes burn rate and forecast', () => {
        const burn = service.burnRate();
        expect(burn.spentMtd).toBe(5000);
        expect(burn.dailyBurnRate).toBeGreaterThan(0);
        expect(burn.monthEndForecast).toBeGreaterThan(burn.spentMtd);
    });

    it('computes budget pacing', () => {
        const pacing = service.budgetPacing();
        expect(pacing.totalBudget).toBe(10000);
        expect(pacing.spentMtd).toBe(5000);
        expect(pacing.budgetUsedPct).toBe(50);
    });

    it('returns recent transactions (top 5)', () => {
        expect(service.recentTransactions().length).toBeLessThanOrEqual(5);
    });

    it('computes household split for multi-member homes', () => {
        const split = service.householdSplit();
        expect(split.length).toBe(2);
        expect(split[0].amount + split[1].amount).toBe(5000);
    });

    it('handles zero spend edge case', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                InsightsService,
                { provide: TransactionService, useValue: { transactions: signal([]) } },
                { provide: BudgetService, useValue: { categoryBudgets: signal([]) } },
                { provide: CategoryService, useValue: { categories: signal([]) } },
                { provide: UserService, useValue: { getUserName: () => 'User' } },
                { provide: HomeService, useValue: { currentHome: signal(null) } }
            ]
        });

        const emptyService = TestBed.inject(InsightsService);
        const health = emptyService.financialHealth();
        expect(health.netCashFlow).toBe(0);
        expect(emptyService.burnRate().dailyBurnRate).toBe(0);
        expect(emptyService.budgetPacing().ratio).toBeNull();
    });

    it('handles single transaction month', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                InsightsService,
                {
                    provide: TransactionService,
                    useValue: {
                        transactions: signal([
                            {
                                id: 'solo',
                                amount: 500,
                                categoryId: 'food',
                                date: new Date(2026, 7, 1),
                                type: 'expense' as const
                            }
                        ])
                    }
                },
                { provide: BudgetService, useValue: { categoryBudgets: signal([]) } },
                { provide: CategoryService, useValue: { categories: signal([]) } },
                { provide: UserService, useValue: { getUserName: () => 'User' } },
                { provide: HomeService, useValue: { currentHome: signal(null) } }
            ]
        });

        const soloService = TestBed.inject(InsightsService);
        expect(soloService.financialHealth().expense).toBe(500);
        expect(soloService.burnRate().spentMtd).toBe(500);
    });
});
