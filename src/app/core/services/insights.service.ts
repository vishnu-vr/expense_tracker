import { Injectable, computed, inject } from '@angular/core';
import { TransactionService } from './transaction.service';
import { BudgetService } from './budget.service';
import { CategoryService } from './category.service';
import { UserService } from './user.service';
import { HomeService } from './home.service';
import { Transaction } from '../models/models';
import { spentForCategoryInMonth } from '../utils/budget-alert';
import {
    budgetPacingRatio,
    dailyBurnRate,
    daysElapsedInMonth,
    monthEndForecast,
    pacingStatus,
    periodOverPeriodDelta,
    PacingStatus,
    totalDaysInMonth
} from '../utils/insights-math';
import { detectRecurringExpenses, RecurringExpenseInsight } from '../utils/recurring-expenses';

export interface FinancialHealth {
    income: number;
    expense: number;
    netCashFlow: number;
    lastMonthNetCashFlow: number;
    periodDeltaPct: number | null;
}

export interface BurnRateInsight {
    spentMtd: number;
    dailyBurnRate: number;
    monthEndForecast: number;
    daysElapsed: number;
    totalDays: number;
    projectedSavings: number;
}

export interface CategoryPacingWarning {
    categoryId: string;
    name: string;
    spent: number;
    budget: number;
    ratio: number;
    status: PacingStatus;
}

export interface BudgetPacingInsight {
    spentMtd: number;
    totalBudget: number;
    budgetUsedPct: number;
    ratio: number | null;
    status: PacingStatus;
    daysElapsed: number;
    totalDays: number;
    timePct: number;
    categoryWarnings: CategoryPacingWarning[];
}

export interface SmartInsightCard {
    icon: string;
    color: 'amber' | 'blue' | 'red' | 'emerald' | 'purple' | 'indigo';
    title: string;
    narrative: string;
}

export interface HouseholdMemberSpend {
    userId: string;
    name: string;
    amount: number;
    percentage: number;
}

function monthIncome(transactions: Transaction[], year: number, month: number): number {
    return transactions
        .filter((t) => {
            const d = new Date(t.date);
            return t.type === 'income' && d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, t) => sum + t.amount, 0);
}

function monthExpense(transactions: Transaction[], year: number, month: number): number {
    return transactions
        .filter((t) => {
            const d = new Date(t.date);
            return t.type === 'expense' && d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, t) => sum + t.amount, 0);
}

@Injectable({
    providedIn: 'root'
})
export class InsightsService {
    private transactionService = inject(TransactionService);
    private budgetService = inject(BudgetService);
    private categoryService = inject(CategoryService);
    private userService = inject(UserService);
    private homeService = inject(HomeService);

    private now = computed(() => new Date());

    private currentYear = computed(() => this.now().getFullYear());
    private currentMonth = computed(() => this.now().getMonth());

    private lastMonthDate = computed(() => {
        const d = new Date(this.currentYear(), this.currentMonth(), 1);
        d.setMonth(d.getMonth() - 1);
        return d;
    });

    private transactions = computed(() => this.transactionService.transactions());

    financialHealth = computed<FinancialHealth>(() => {
        const txs = this.transactions();
        const year = this.currentYear();
        const month = this.currentMonth();
        const last = this.lastMonthDate();

        const income = monthIncome(txs, year, month);
        const expense = monthExpense(txs, year, month);
        const netCashFlow = income - expense;

        const lastIncome = monthIncome(txs, last.getFullYear(), last.getMonth());
        const lastExpense = monthExpense(txs, last.getFullYear(), last.getMonth());
        const lastMonthNetCashFlow = lastIncome - lastExpense;

        return {
            income,
            expense,
            netCashFlow,
            lastMonthNetCashFlow,
            periodDeltaPct: periodOverPeriodDelta(netCashFlow, lastMonthNetCashFlow)
        };
    });

    burnRate = computed<BurnRateInsight>(() => {
        const txs = this.transactions();
        const year = this.currentYear();
        const month = this.currentMonth();
        const spentMtd = monthExpense(txs, year, month);
        const daysElapsed = daysElapsedInMonth(this.now());
        const totalDays = totalDaysInMonth(year, month);
        const burn = dailyBurnRate(spentMtd, daysElapsed);
        const forecast = monthEndForecast(burn, totalDays);
        const income = monthIncome(txs, year, month);

        return {
            spentMtd,
            dailyBurnRate: burn,
            monthEndForecast: forecast,
            daysElapsed,
            totalDays,
            projectedSavings: income - forecast
        };
    });

    budgetPacing = computed<BudgetPacingInsight>(() => {
        const txs = this.transactions();
        const year = this.currentYear();
        const month = this.currentMonth();
        const daysElapsed = daysElapsedInMonth(this.now());
        const totalDays = totalDaysInMonth(year, month);
        const timePct = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;

        const budgets = this.budgetService.categoryBudgets();
        const cats = this.categoryService.categories();
        let totalBudget = 0;
        let spentMtd = 0;
        const categoryWarnings: CategoryPacingWarning[] = [];

        for (const b of budgets) {
            if (b.amount <= 0) continue;
            totalBudget += b.amount;
            const spent = spentForCategoryInMonth(txs, b.categoryId, year, month);
            spentMtd += spent;

            const ratio = budgetPacingRatio(spent, b.amount, daysElapsed, totalDays);
            if (ratio !== null && ratio > 1.0) {
                const cat = cats.find((c) => c.id === b.categoryId);
                categoryWarnings.push({
                    categoryId: b.categoryId,
                    name: cat?.name ?? 'Category',
                    spent,
                    budget: b.amount,
                    ratio,
                    status: pacingStatus(ratio)
                });
            }
        }

        categoryWarnings.sort((a, b) => b.ratio - a.ratio);

        const ratio = budgetPacingRatio(spentMtd, totalBudget, daysElapsed, totalDays);
        const budgetUsedPct = totalBudget > 0 ? (spentMtd / totalBudget) * 100 : 0;

        return {
            spentMtd,
            totalBudget,
            budgetUsedPct,
            ratio,
            status: pacingStatus(ratio),
            daysElapsed,
            totalDays,
            timePct,
            categoryWarnings
        };
    });

    smartInsights = computed<SmartInsightCard[]>(() => {
        const cards: SmartInsightCard[] = [];
        const txs = this.transactions();
        const year = this.currentYear();
        const month = this.currentMonth();
        const now = this.now();

        // Spike: this week vs last week
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const prevWeekStart = new Date(weekStart);
        prevWeekStart.setDate(prevWeekStart.getDate() - 7);
        const prevWeekEnd = new Date(weekStart);
        prevWeekEnd.setMilliseconds(-1);

        const thisWeekExpense = txs
            .filter((t) => t.type === 'expense')
            .filter((t) => new Date(t.date) >= weekStart)
            .reduce((s, t) => s + t.amount, 0);
        const lastWeekExpense = txs
            .filter((t) => t.type === 'expense')
            .filter((t) => {
                const d = new Date(t.date);
                return d >= prevWeekStart && d <= prevWeekEnd;
            })
            .reduce((s, t) => s + t.amount, 0);

        if (lastWeekExpense > 0 && thisWeekExpense > lastWeekExpense) {
            const spikePct = periodOverPeriodDelta(thisWeekExpense, lastWeekExpense);
            if (spikePct !== null && spikePct >= 15) {
                cards.push({
                    icon: 'trending_up',
                    color: 'red',
                    title: 'Spending Spike',
                    narrative: `Spending is ${Math.round(spikePct)}% higher this week compared to last week.`
                });
            }
        }

        // Day-of-week habits (current month expenses)
        const dayTotals = [0, 0, 0, 0, 0, 0, 0];
        txs
            .filter((t) => {
                const d = new Date(t.date);
                return t.type === 'expense' && d.getFullYear() === year && d.getMonth() === month;
            })
            .forEach((t) => {
                dayTotals[new Date(t.date).getDay()] += t.amount;
            });
        const totalDaySpend = dayTotals.reduce((a, b) => a + b, 0);
        if (totalDaySpend > 0) {
            const friSat = dayTotals[5] + dayTotals[6];
            const pct = (friSat / totalDaySpend) * 100;
            if (pct >= 40) {
                cards.push({
                    icon: 'event',
                    color: 'indigo',
                    title: 'Weekend Spending',
                    narrative: `${Math.round(pct)}% of your discretionary spending this month occurs on Fridays & Saturdays.`
                });
            }
        }

        // Top burner category
        const categoryTotals = new Map<string, number>();
        txs
            .filter((t) => {
                const d = new Date(t.date);
                return t.type === 'expense' && d.getFullYear() === year && d.getMonth() === month;
            })
            .forEach((t) => {
                categoryTotals.set(t.categoryId, (categoryTotals.get(t.categoryId) ?? 0) + t.amount);
            });
        const sortedCats = Array.from(categoryTotals.entries()).sort((a, b) => b[1] - a[1]);
        if (sortedCats.length > 0 && monthExpense(txs, year, month) > 0) {
            const [topId, topAmt] = sortedCats[0];
            const cat = this.categoryService.categories().find((c) => c.id === topId);
            const share = (topAmt / monthExpense(txs, year, month)) * 100;
            cards.push({
                icon: 'category',
                color: 'purple',
                title: 'Top Burner',
                narrative: `${cat?.name ?? 'Unknown'} is your top spending category at ${Math.round(share)}% of monthly expenses.`
            });
        }

        // Rising category (14-day vs prior 14-day)
        const fourteenAgo = new Date(now);
        fourteenAgo.setDate(fourteenAgo.getDate() - 14);
        const twentyEightAgo = new Date(now);
        twentyEightAgo.setDate(twentyEightAgo.getDate() - 28);

        const recentByCat = new Map<string, number>();
        const priorByCat = new Map<string, number>();
        txs
            .filter((t) => t.type === 'expense')
            .forEach((t) => {
                const d = new Date(t.date);
                if (d >= fourteenAgo) {
                    recentByCat.set(t.categoryId, (recentByCat.get(t.categoryId) ?? 0) + t.amount);
                } else if (d >= twentyEightAgo && d < fourteenAgo) {
                    priorByCat.set(t.categoryId, (priorByCat.get(t.categoryId) ?? 0) + t.amount);
                }
            });

        let bestRise: { name: string; pct: number } | null = null;
        for (const [catId, recent] of recentByCat.entries()) {
            const prior = priorByCat.get(catId) ?? 0;
            if (prior > 0 && recent > prior) {
                const pct = periodOverPeriodDelta(recent, prior);
                if (pct !== null && (!bestRise || pct > bestRise.pct)) {
                    const cat = this.categoryService.categories().find((c) => c.id === catId);
                    bestRise = { name: cat?.name ?? 'Category', pct };
                }
            }
        }
        if (bestRise && bestRise.pct >= 20) {
            cards.push({
                icon: 'insights',
                color: 'amber',
                title: 'Rising Category',
                narrative: `${bestRise.name} spending rose ${Math.round(bestRise.pct)}% in the last 14 days vs the prior 14 days.`
            });
        }

        // Household contribution
        const members = this.householdSplit();
        if (members.length >= 2) {
            const top = members[0];
            cards.push({
                icon: 'groups',
                color: 'blue',
                title: 'Household Split',
                narrative: `${top.name} accounts for ${Math.round(top.percentage)}% of household spending this month.`
            });
        }

        return cards.slice(0, 6);
    });

    householdSplit = computed<HouseholdMemberSpend[]>(() => {
        const home = this.homeService.currentHome();
        if (!home || !home.memberIds || home.memberIds.length < 2) return [];

        const txs = this.transactions();
        const year = this.currentYear();
        const month = this.currentMonth();
        const byUser = new Map<string, number>();

        txs
            .filter((t) => {
                const d = new Date(t.date);
                return t.type === 'expense' && d.getFullYear() === year && d.getMonth() === month;
            })
            .forEach((t) => {
                if (!t.userId) return;
                byUser.set(t.userId, (byUser.get(t.userId) ?? 0) + t.amount);
            });

        const total = Array.from(byUser.values()).reduce((a, b) => a + b, 0);
        if (total <= 0) return [];

        return Array.from(byUser.entries())
            .map(([userId, amount]) => ({
                userId,
                name: this.userService.getUserName(userId),
                amount,
                percentage: (amount / total) * 100
            }))
            .sort((a, b) => b.amount - a.amount);
    });

    recurringExpenses = computed<RecurringExpenseInsight[]>(() => {
        const now = this.now();
        const rangeStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        const inRange = this.transactions().filter((t) => {
            const d = new Date(t.date);
            return d >= rangeStart && d <= rangeEnd;
        });

        return detectRecurringExpenses(
            inRange,
            (id) => this.categoryService.categories().find((c) => c.id === id)?.name ?? 'Uncategorized',
            { maxResults: 4 }
        );
    });

    recentTransactions = computed(() => {
        return [...this.transactions()]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 5);
    });
}
