import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { UserService } from '../../core/services/user.service';
import { HomeService } from '../../core/services/home.service';
import { Category } from '../../core/models/models';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';
import { PrivacyModeService } from '../../core/services/privacy-mode.service';

interface MonthlyTopSpending {
    month: string;
    monthLabel: string;
    year: number;
    topItems: {
        category: Category;
        amount: number;
        percentage: number;
    }[];
    totalExpense: number;
}

interface ChartBar {
    month: string;
    monthLabel: string;
    year: number;
    amount: number;
    percentage: number; // Percentage of max value (for bar height)
    x: number;
    barWidth: number;
    barHeight: number;
    y: number;
}

interface InsightCard {
    icon: string;
    color: 'amber' | 'blue' | 'red' | 'emerald' | 'purple' | 'indigo';
    title: string;
    narrative: string;
}

import { detectRecurringExpenses } from '../../core/utils/recurring-expenses';

@Component({
    selector: 'app-trends',
    standalone: true,
    imports: [CommonModule, RouterModule, MaskCurrencyPipe],
    templateUrl: './trends.component.html',
    styles: []
})
export class TrendsComponent {
    transactionService = inject(TransactionService);
    categoryService = inject(CategoryService);
    userService = inject(UserService);
    homeService = inject(HomeService);
    privacyModeService = inject(PrivacyModeService);
    private router = inject(Router);

    // Time period options
    readonly periodOptions = [
        { value: 3, label: '3 Months' },
        { value: 6, label: '6 Months' },
        { value: 12, label: '12 Months' }
    ];
    selectedPeriod = signal(6); // Default 6 months

    rangeMode = signal<'preset' | 'custom'>('preset');
    customStartStr = signal('');
    customEndStr = signal('');
    customRangeError = signal<string | null>(null);
    private committedCustomRange = signal<{ start: Date; end: Date } | null>(null);

    periodSubtitle = computed(() => {
        if (this.rangeMode() === 'preset') {
            return `Last ${this.selectedPeriod()} months`;
        }
        const range = this.committedCustomRange();
        if (!range) {
            return 'Custom range';
        }
        const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
        return `${range.start.toLocaleDateString('en-US', opts)} – ${range.end.toLocaleDateString('en-US', opts)}`;
    });

    summaryTotalLabel = computed(() => {
        return this.rangeMode() === 'preset'
            ? `${this.selectedPeriod()} Month Total`
            : 'Period Total';
    });

    // Selected user filter (null = all users)
    selectedUserId = signal<string | null>(null);
    showUserDropdown = signal(false);

    selectedUserDisplayName = computed(() => {
        this.userService.users();
        const userId = this.selectedUserId();
        if (!userId) return 'All Users';
        return this.userService.getUserName(userId);
    });

    availableUsers = computed(() => {
        this.userService.users();

        const userIds = new Set<string>();
        const home = this.homeService.currentHome();
        home?.memberIds?.forEach((id) => userIds.add(id));

        this.transactionService.transactions().forEach((t) => {
            if (t.userId) {
                userIds.add(t.userId);
            }
        });

        return Array.from(userIds)
            .map((userId) => ({
                id: userId,
                name: this.userService.getUserName(userId)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    });

    // Top spending by month for selected period or custom range
    monthlyTopSpending = computed<MonthlyTopSpending[]>(() => {
        const allTransactions = this.transactionService.transactions();
        const userId = this.selectedUserId();

        let transactions = userId
            ? allTransactions.filter(t => t.userId === userId)
            : allTransactions;
        transactions = transactions.filter(t => t.type === 'expense');

        const buckets =
            this.rangeMode() === 'preset'
                ? this.buildPresetMonthBuckets(this.selectedPeriod())
                : this.buildCustomMonthBuckets(this.committedCustomRange());

        const months: MonthlyTopSpending[] = [];

        for (const bucket of buckets) {
            const monthTransactions = transactions.filter(t => {
                const tDate = new Date(t.date);
                return tDate >= bucket.windowStart && tDate <= bucket.windowEnd;
            });

            const categoryTotals = new Map<string, number>();
            monthTransactions.forEach(t => {
                const current = categoryTotals.get(t.categoryId) || 0;
                categoryTotals.set(t.categoryId, current + t.amount);
            });

            const totalExpense = monthTransactions.reduce((sum, t) => sum + t.amount, 0);

            const topItems = Array.from(categoryTotals.entries())
                .map(([categoryId, amount]) => {
                    const category = this.categoryService.categories().find(c => c.id === categoryId);
                    return category ? {
                        category,
                        amount,
                        percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0
                    } : null;
                })
                .filter(item => item !== null)
                .sort((a, b) => b!.amount - a!.amount)
                .slice(0, 5) as MonthlyTopSpending['topItems'];

            months.push({
                month: bucket.monthKey,
                monthLabel: bucket.monthLabel,
                year: bucket.year,
                topItems,
                totalExpense
            });
        }

        return months;
    });

    // Total expense across selected period
    totalExpenseForPeriod = computed(() => {
        return this.monthlyTopSpending().reduce((sum, m) => sum + m.totalExpense, 0);
    });

    // Average monthly expense (among months that have any expense in range)
    averageMonthlyExpense = computed(() => {
        const monthsWithData = this.monthlyTopSpending().filter(m => m.totalExpense > 0);
        if (monthsWithData.length === 0) return 0;
        return this.totalExpenseForPeriod() / monthsWithData.length;
    });

    // Max monthly expense (for chart scaling)
    maxMonthlyExpense = computed(() => {
        return Math.max(...this.monthlyTopSpending().map(m => m.totalExpense), 1);
    });

    // Chart bar data (reversed to show oldest first, left to right)
    chartBars = computed<ChartBar[]>(() => {
        const data = [...this.monthlyTopSpending()].reverse();
        const maxExpense = this.maxMonthlyExpense();
        const chartWidth = 300;
        const chartHeight = 150;
        const barGap = 4;
        const numBars = data.length;
        const barWidth = Math.max(8, (chartWidth - (numBars - 1) * barGap) / numBars);

        return data.map((m, index) => {
            const percentage = maxExpense > 0 ? (m.totalExpense / maxExpense) * 100 : 0;
            const barHeight = (percentage / 100) * chartHeight;
            
            return {
                month: m.month,
                monthLabel: m.monthLabel,
                year: m.year,
                amount: m.totalExpense,
                percentage,
                x: index * (barWidth + barGap),
                barWidth,
                barHeight: Math.max(barHeight, 2), // Minimum height for visibility
                y: chartHeight - barHeight
            };
        });
    });

    insightCards = computed<InsightCard[]>(() => {
        const monthlyData = this.monthlyTopSpending();
        const monthsWithExpense = monthlyData.filter(m => m.totalExpense > 0);
        const cards: InsightCard[] = [];

        if (monthsWithExpense.length === 0) {
            return cards;
        }

        const peakMonth = monthsWithExpense.reduce((max, month) =>
            month.totalExpense > max.totalExpense ? month : max
        );
        const peakTopCategory = peakMonth.topItems[0];
        const peakMonthLabel = `${peakMonth.monthLabel} ${peakMonth.year}`;
        if (peakTopCategory) {
            cards.push({
                icon: 'trending_up',
                color: 'amber',
                title: 'Peak Month',
                narrative: `${peakMonthLabel} was your highest spend at ${this.formatCurrency(peakMonth.totalExpense)} - driven by a spike in ${peakTopCategory.category.name} (${this.formatPercent(peakTopCategory.percentage)}).`
            });
        } else {
            cards.push({
                icon: 'trending_up',
                color: 'amber',
                title: 'Peak Month',
                narrative: `${peakMonthLabel} was your highest spend at ${this.formatCurrency(peakMonth.totalExpense)}.`
            });
        }

        const lowestMonth = monthsWithExpense.reduce((min, month) =>
            month.totalExpense < min.totalExpense ? month : min
        );
        const lowestMonthLabel = `${lowestMonth.monthLabel} ${lowestMonth.year}`;
        if (lowestMonth.month !== peakMonth.month || lowestMonth.year !== peakMonth.year) {
            cards.push({
                icon: 'savings',
                color: 'blue',
                title: 'Lowest Month',
                narrative: `${lowestMonthLabel} was your lightest month at ${this.formatCurrency(lowestMonth.totalExpense)}.`
            });
        }

        const chronological = [...monthlyData].reverse();
        let biggestIncrease: { from: MonthlyTopSpending; to: MonthlyTopSpending; changePct: number } | null = null;
        let biggestDrop: { from: MonthlyTopSpending; to: MonthlyTopSpending; changePct: number } | null = null;

        for (let i = 1; i < chronological.length; i++) {
            const previous = chronological[i - 1];
            const current = chronological[i];
            if (previous.totalExpense <= 0) {
                continue;
            }

            const changePct = ((current.totalExpense - previous.totalExpense) / previous.totalExpense) * 100;
            if (changePct > 0 && (!biggestIncrease || changePct > biggestIncrease.changePct)) {
                biggestIncrease = { from: previous, to: current, changePct };
            }
            if (changePct < 0 && (!biggestDrop || changePct < biggestDrop.changePct)) {
                biggestDrop = { from: previous, to: current, changePct };
            }
        }

        if (biggestIncrease) {
            cards.push({
                icon: 'north_east',
                color: 'red',
                title: 'Biggest Spike',
                narrative: `Spending jumped ${this.formatPercent(biggestIncrease.changePct)} from ${biggestIncrease.from.monthLabel} ${biggestIncrease.from.year} to ${biggestIncrease.to.monthLabel} ${biggestIncrease.to.year}.`
            });
        }

        if (biggestDrop) {
            cards.push({
                icon: 'south_east',
                color: 'emerald',
                title: 'Biggest Drop',
                narrative: `Spending dropped ${this.formatPercent(Math.abs(biggestDrop.changePct))} from ${biggestDrop.from.monthLabel} ${biggestDrop.from.year} to ${biggestDrop.to.monthLabel} ${biggestDrop.to.year}.`
            });
        }

        const categoryTotals = new Map<string, { name: string; amount: number }>();
        monthsWithExpense.forEach(month => {
            month.topItems.forEach(item => {
                const current = categoryTotals.get(item.category.id);
                if (current) {
                    current.amount += item.amount;
                    return;
                }
                categoryTotals.set(item.category.id, {
                    name: item.category.name,
                    amount: item.amount
                });
            });
        });

        const overallTopCategory = Array.from(categoryTotals.values()).sort((a, b) => b.amount - a.amount)[0];
        if (overallTopCategory && this.totalExpenseForPeriod() > 0) {
            const share = (overallTopCategory.amount / this.totalExpenseForPeriod()) * 100;
            cards.push({
                icon: 'category',
                color: 'purple',
                title: 'Top Category',
                narrative: `${overallTopCategory.name} dominated your spending, accounting for ${this.formatPercent(share)} across this period.`
            });
        }

        const categoriesByMonth = new Map<string, { name: string; amounts: number[] }>();
        chronological.forEach((month, monthIndex) => {
            month.topItems.forEach(item => {
                if (!categoriesByMonth.has(item.category.id)) {
                    categoriesByMonth.set(item.category.id, {
                        name: item.category.name,
                        amounts: Array(chronological.length).fill(0)
                    });
                }
                categoriesByMonth.get(item.category.id)!.amounts[monthIndex] = item.amount;
            });
        });

        const risingCategory = Array.from(categoriesByMonth.values()).find(({ amounts }) => {
            for (let i = 0; i <= amounts.length - 3; i++) {
                const a = amounts[i];
                const b = amounts[i + 1];
                const c = amounts[i + 2];
                if (a > 0 && b > 0 && c > 0 && a < b && b < c) {
                    return true;
                }
            }
            return false;
        });

        if (risingCategory) {
            cards.push({
                icon: 'insights',
                color: 'indigo',
                title: 'Rising Category',
                narrative: `${risingCategory.name} costs grew steadily over the last 3 months.`
            });
        }

        return cards;
    });

    recurringExpenseInsights = computed(() => {
        const range = this.getActiveRange();
        if (!range) return [];

        const userId = this.selectedUserId();
        const inRange = this.transactionService.transactions().filter((t) => {
            const date = new Date(t.date);
            return date >= range.start && date <= range.end;
        });

        const detected = detectRecurringExpenses(
            inRange,
            (id) => this.categoryService.categories().find((c) => c.id === id)?.name ?? 'Uncategorized',
            { maxResults: 4, userId }
        );

        return detected.map((item) => ({
            ...item,
            narrative: `${item.label} looks recurring: about ${this.formatCurrency(item.averageAmount)} ${item.cadenceLabel} (${item.occurrences} payments, latest on ${item.lastPaidDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}).`
        }));
    });

    private formatCurrency(amount: number): string {
        if (this.privacyModeService.hideAmounts()) {
            return '••••';
        }
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(amount);
    }

    private formatPercent(percent: number): string {
        const rounded = Math.round(percent);
        return `${rounded}%`;
    }

    private getActiveRange(): { start: Date; end: Date } | null {
        if (this.rangeMode() === 'custom') {
            return this.committedCustomRange();
        }
        const buckets = this.buildPresetMonthBuckets(this.selectedPeriod());
        if (buckets.length === 0) {
            return null;
        }
        const oldest = buckets[buckets.length - 1];
        const newest = buckets[0];
        return {
            start: oldest.windowStart,
            end: newest.windowEnd
        };
    }

    private buildPresetMonthBuckets(period: number): {
        monthKey: string;
        monthLabel: string;
        year: number;
        windowStart: Date;
        windowEnd: Date;
    }[] {
        const now = new Date();
        const buckets: {
            monthKey: string;
            monthLabel: string;
            year: number;
            windowStart: Date;
            windowEnd: Date;
        }[] = [];

        for (let i = 0; i < period; i++) {
            const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const windowStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1, 0, 0, 0, 0);
            const windowEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
            buckets.push({
                monthKey: `${monthDate.getFullYear()}-${monthDate.getMonth()}`,
                monthLabel: monthDate.toLocaleDateString('en-US', { month: 'short' }),
                year: monthDate.getFullYear(),
                windowStart,
                windowEnd
            });
        }
        return buckets;
    }

    private buildCustomMonthBuckets(range: { start: Date; end: Date } | null): {
        monthKey: string;
        monthLabel: string;
        year: number;
        windowStart: Date;
        windowEnd: Date;
    }[] {
        if (!range || range.start > range.end) {
            return [];
        }
        const start = range.start;
        const end = range.end;
        const chronological: {
            monthKey: string;
            monthLabel: string;
            year: number;
            windowStart: Date;
            windowEnd: Date;
        }[] = [];

        let y = start.getFullYear();
        let m = start.getMonth();
        const endY = end.getFullYear();
        const endM = end.getMonth();

        while (y < endY || (y === endY && m <= endM)) {
            const first = new Date(y, m, 1, 0, 0, 0, 0);
            const last = new Date(y, m + 1, 0, 23, 59, 59, 999);
            const windowStart = first.getTime() < start.getTime() ? new Date(start) : first;
            const windowEnd = last.getTime() > end.getTime() ? new Date(end) : last;
            if (windowStart <= windowEnd) {
                chronological.push({
                    monthKey: `${y}-${m}`,
                    monthLabel: first.toLocaleDateString('en-US', { month: 'short' }),
                    year: y,
                    windowStart,
                    windowEnd
                });
            }
            m++;
            if (m > 11) {
                m = 0;
                y++;
            }
        }

        return chronological.reverse();
    }

    private toDateInputValue(d: Date): string {
        return d.toLocaleDateString('en-CA');
    }

    // Set time period (preset)
    setPeriod(months: number) {
        this.rangeMode.set('preset');
        this.selectedPeriod.set(months);
        this.customRangeError.set(null);
    }

    selectCustomMode() {
        this.rangeMode.set('custom');
        if (!this.committedCustomRange()) {
            const end = new Date();
            const start = new Date(end.getFullYear(), end.getMonth() - 5, 1);
            this.customEndStr.set(this.toDateInputValue(end));
            this.customStartStr.set(this.toDateInputValue(start));
            this.applyCustomRange();
        }
    }

    applyCustomRange() {
        const s = this.customStartStr().trim();
        const e = this.customEndStr().trim();
        if (!s || !e) {
            this.customRangeError.set('Select both start and end dates.');
            return;
        }
        const start = new Date(s + 'T00:00:00');
        const end = new Date(e + 'T23:59:59.999');
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            this.customRangeError.set('Invalid dates.');
            return;
        }
        if (start > end) {
            this.customRangeError.set('Start date must be on or before end date.');
            return;
        }
        this.customRangeError.set(null);
        this.committedCustomRange.set({ start, end });
    }

    onCustomStartInput(event: Event) {
        this.customStartStr.set((event.target as HTMLInputElement).value);
    }

    onCustomEndInput(event: Event) {
        this.customEndStr.set((event.target as HTMLInputElement).value);
    }

    // User filter methods
    selectUser(userId: string | null) {
        this.selectedUserId.set(userId);
        this.showUserDropdown.set(false);
    }

    toggleUserDropdown() {
        this.showUserDropdown.update(v => !v);
    }

    // Navigate to analysis page with specific month selected
    goToMonthAnalysis(monthLabel: string, year: number) {
        // Find the month index (0-11) from the label
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthIndex = monthNames.indexOf(monthLabel);
        
        if (monthIndex !== -1) {
            this.router.navigate(['/analysis'], {
                state: {
                    analysisYear: year,
                    analysisMonthIndex: monthIndex
                }
            });
        }
    }
}

