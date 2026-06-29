import { Component, inject, computed, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { UserService } from '../../core/services/user.service';
import { HomeService } from '../../core/services/home.service';
import { NoteEmbeddingService } from '../../core/services/note-embedding.service';
import { Category, Transaction } from '../../core/models/models';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';
import { groupTransactionsByNoteRules, NoteBucket } from '../../core/utils/note-grouping';
import { semanticMergeBuckets } from '../../core/utils/embedding-clustering';

interface PieSlice {
    category: Category;
    amount: number;
    percentage: number;
    startAngle: number;
    endAngle: number;
    path: string;
    labelX: number;
    labelY: number;
}

interface NoteDonutSlice {
    bucket: NoteBucket;
    path: string;
    startAngle: number;
    endAngle: number;
}

@Component({
    selector: 'app-analysis',
    standalone: true,
    imports: [CommonModule, RouterModule, MaskCurrencyPipe],
    templateUrl: './analysis.component.html',
    styles: []
})
export class AnalysisComponent implements OnInit {
    transactionService = inject(TransactionService);
    categoryService = inject(CategoryService);
    userService = inject(UserService);
    homeService = inject(HomeService);
    noteEmbeddingService = inject(NoteEmbeddingService);
    private router = inject(Router);
    private analysisNavigationState = this.router.getCurrentNavigation()?.extras?.state as
        | { analysisYear?: number; analysisMonthIndex?: number }
        | undefined;

    // Selected category for detail view
    selectedCategory = signal<Category | null>(null);
    
    // Selected user filter (null = all users)
    selectedUserId = signal<string | null>(null);
    showUserDropdown = signal(false);
    rangeStartDraft = signal('');
    rangeEndDraft = signal('');
    rangeError = signal<string | null>(null);

    selectedUserDisplayName = computed(() => {
        this.userService.users();
        const userId = this.selectedUserId();
        if (!userId) return 'All Users';
        return this.userService.getUserName(userId);
    });

    rangeDisplayLabel = computed(() => {
        const start = this.transactionService.analysisRangeStart();
        const end = this.transactionService.analysisRangeEnd();
        return `${this.formatDisplayDate(start)} - ${this.formatDisplayDate(end)}`;
    });

    // Household members + anyone who appears in transactions; names from UserService
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

    // Filtered transactions based on user selection
    userFilteredTransactions = computed(() => {
        const userId = this.selectedUserId();
        let transactions = this.transactionService.analysisFilteredTransactions();
        
        if (userId) {
            transactions = transactions.filter(t => t.userId === userId);
        }
        
        return transactions;
    });

    // Transactions for the selected category (with user filter)
    categoryTransactions = computed(() => {
        const category = this.selectedCategory();
        if (!category) return [];
        
        return this.userFilteredTransactions()
            .filter(t => t.categoryId === category.id && t.type === 'expense')
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    });

    // Total for the selected category
    categoryTotal = computed(() => {
        return this.categoryTransactions().reduce((sum, t) => sum + t.amount, 0);
    });

    // === Note ("description") breakdown for the open category ===
    // Pass A: synchronous rule-based grouping; renders instantly.
    // Uncapped list (used as input to Pass B and to derive the visible Pass A view).
    private noteBucketsRuleAll = computed<NoteBucket[]>(() =>
        groupTransactionsByNoteRules(this.categoryTransactions(), { applyTopN: false })
    );
    // Visible Pass A view: top-N + Other applied.
    noteBucketsRule = computed<NoteBucket[]>(() =>
        groupTransactionsByNoteRules(this.categoryTransactions())
    );
    // Pass B: refined output once the on-device embedding model finishes a run.
    // Null until the first run completes; reset to null when the inputs change.
    noteBucketsSemantic = signal<NoteBucket[] | null>(null);
    // What the UI reads. Prefers the semantic version when available.
    noteBuckets = computed<NoteBucket[]>(
        () => this.noteBucketsSemantic() ?? this.noteBucketsRule()
    );
    // Show a small "refining..." pill while we're waiting on Pass B.
    noteBucketsRefining = computed(
        () =>
            !!this.selectedCategory() &&
            this.noteBucketsSemantic() === null &&
            !this.noteEmbeddingService.modelFailed() &&
            this.noteBucketsRule().length >= 2
    );

    // Donut slice paths for the note-breakdown chart.
    noteDonutSlices = computed<NoteDonutSlice[]>(() => {
        const buckets = this.noteBuckets();
        if (buckets.length === 0) return [];
        const total = buckets.reduce((s, b) => s + b.total, 0) || 1;
        const slices: NoteDonutSlice[] = [];
        let currentAngle = -90;
        for (const b of buckets) {
            const angleSize = (b.total / total) * 360;
            const startAngle = currentAngle;
            const endAngle = currentAngle + angleSize;
            slices.push({
                bucket: b,
                path: this.describeArc(60, 60, 50, startAngle, endAngle),
                startAngle,
                endAngle,
            });
            currentAngle = endAngle;
        }
        return slices;
    });

    // Cancellation guard for stale Pass B runs (e.g. user switches categories quickly).
    private noteSemanticRunId = 0;

    private noteSemanticEffect = effect(
        async () => {
            const ruleAll = this.noteBucketsRuleAll();
            const cat = this.selectedCategory();
            const runId = ++this.noteSemanticRunId;

            // Reset whenever inputs change so the UI re-shows Pass A immediately.
            this.noteBucketsSemantic.set(null);

            if (!cat || ruleAll.length < 2 || this.noteEmbeddingService.modelFailed()) {
                return;
            }

            try {
                const refined = await semanticMergeBuckets(ruleAll, (texts) =>
                    this.noteEmbeddingService.embed(texts)
                );
                if (runId !== this.noteSemanticRunId) return; // a newer run started; drop
                this.noteBucketsSemantic.set(refined);
            } catch {
                if (runId === this.noteSemanticRunId) {
                    this.noteBucketsSemantic.set(null);
                }
            }
        },
        { allowSignalWrites: true }
    );

    ngOnInit(): void {
        const historyState = history.state as { analysisYear?: number; analysisMonthIndex?: number };
        const targetYear = this.analysisNavigationState?.analysisYear ?? historyState.analysisYear;
        const targetMonthIndex = this.analysisNavigationState?.analysisMonthIndex ?? historyState.analysisMonthIndex;
        const hasTargetMonth =
            Number.isInteger(targetYear) &&
            Number.isInteger(targetMonthIndex) &&
            (targetMonthIndex as number) >= 0 &&
            (targetMonthIndex as number) <= 11;

        const baseDate = hasTargetMonth
            ? new Date(targetYear as number, targetMonthIndex as number, 1)
            : new Date();

        this.transactionService.setAnalysisFilter('monthly');
        this.transactionService.setAnalysisDate(baseDate);

        const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
        const monthEnd = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
        this.transactionService.setAnalysisDateRange(monthStart, monthEnd);
        this.rangeStartDraft.set(this.toDateInputValue(monthStart));
        this.rangeEndDraft.set(this.toDateInputValue(monthEnd));
    }

    // Total expense with user filter
    totalExpenseFiltered = computed(() => {
        return this.userFilteredTransactions()
            .filter(t => t.type === 'expense')
            .reduce((sum, t) => sum + t.amount, 0);
    });

    // Computed stats for the analysis view (with user filter)
    categoryStats = computed(() => {
        const transactions = this.userFilteredTransactions().filter(t => t.type === 'expense');
        const totalExpense = transactions.reduce((sum, t) => sum + t.amount, 0);

        const statsMap = new Map<string, number>();

        transactions.forEach(t => {
            const current = statsMap.get(t.categoryId) || 0;
            statsMap.set(t.categoryId, current + t.amount);
        });

        const stats = [];
        for (const [categoryId, amount] of statsMap.entries()) {
            const category = this.categoryService.categories().find(c => c.id === categoryId);
            if (category) {
                stats.push({
                    category,
                    amount,
                    percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0
                });
            }
        }

        return stats.sort((a, b) => b.amount - a.amount);
    });

    // Pie chart slices for current month expenses
    pieChartSlices = computed<PieSlice[]>(() => {
        const stats = this.categoryStats();
        if (stats.length === 0) return [];

        const slices: PieSlice[] = [];
        let currentAngle = -90; // Start at top

        stats.forEach(stat => {
            const angleSize = (stat.percentage / 100) * 360;
            const startAngle = currentAngle;
            const endAngle = currentAngle + angleSize;

            // Calculate path for pie slice
            const path = this.describeArc(100, 100, 80, startAngle, endAngle);
            
            // Calculate label position (middle of the arc)
            const labelAngle = startAngle + angleSize / 2;
            const labelRadius = 50; // Distance from center for label
            const labelX = 100 + labelRadius * Math.cos((labelAngle * Math.PI) / 180);
            const labelY = 100 + labelRadius * Math.sin((labelAngle * Math.PI) / 180);

            slices.push({
                category: stat.category,
                amount: stat.amount,
                percentage: stat.percentage,
                startAngle,
                endAngle,
                path,
                labelX,
                labelY
            });

            currentAngle = endAngle;
        });

        return slices;
    });

    // Helper function to create SVG arc path
    private describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number): string {
        const start = this.polarToCartesian(x, y, radius, endAngle);
        const end = this.polarToCartesian(x, y, radius, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;

        return [
            'M', x, y,
            'L', start.x, start.y,
            'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
            'Z'
        ].join(' ');
    }

    private polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
        const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
        return {
            x: centerX + radius * Math.cos(angleInRadians),
            y: centerY + radius * Math.sin(angleInRadians)
        };
    }

    // Re-use date navigation logic or just expose service methods if needed
    // For now, we'll bind directly to service signals in template or use simple wrappers

    prevPeriod() {
        this.transactionService.analysisPrevPeriod();
    }

    nextPeriod() {
        this.transactionService.analysisNextPeriod();
    }

    setFilter(filter: 'monthly' | 'range') {
        this.transactionService.setAnalysisFilter(filter);
        if (filter === 'monthly') {
            this.rangeError.set(null);
        }
    }

    // Date picker helpers
    onDateChange(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.value) {
            this.transactionService.setAnalysisDate(new Date(input.value));
        }
    }

    onMonthChange(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.value) {
            const [year, month] = input.value.split('-').map(Number);
            const newDate = new Date(year, month - 1, 1);
            this.transactionService.setAnalysisDate(newDate);
        }
    }

    onRangeStartChange(event: Event) {
        const input = event.target as HTMLInputElement;
        this.rangeStartDraft.set(input.value);
        this.rangeError.set(null);
    }

    onRangeEndChange(event: Event) {
        const input = event.target as HTMLInputElement;
        this.rangeEndDraft.set(input.value);
        this.rangeError.set(null);
    }

    applyDateRange() {
        const startValue = this.rangeStartDraft();
        const endValue = this.rangeEndDraft();
        if (!startValue || !endValue) {
            this.rangeError.set('Select both start and end dates.');
            return;
        }

        const startDate = new Date(startValue);
        const endDate = new Date(endValue);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            this.rangeError.set('Please enter a valid date range.');
            return;
        }

        if (startDate.getTime() > endDate.getTime()) {
            this.rangeError.set('From date cannot be after To date.');
            return;
        }

        this.transactionService.setAnalysisDateRange(startDate, endDate);
        this.transactionService.setAnalysisFilter('range');
        this.rangeError.set(null);
    }

    get currentDateStr() {
        const date = this.transactionService.analysisCurrentDate();
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().split('T')[0];
    }

    get currentMonthStr() {
        const date = this.transactionService.analysisCurrentDate();
        return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    }

    // Select a category to show its transactions
    selectCategory(category: Category) {
        this.selectedCategory.set(category);
    }

    // Close the category detail view
    closeDetail() {
        this.selectedCategory.set(null);
    }

    // Navigate to edit a transaction
    editTransaction(id: string) {
        this.router.navigate(['/edit-transaction', id]);
    }

    // User filter methods
    selectUser(userId: string | null) {
        this.selectedUserId.set(userId);
        this.showUserDropdown.set(false);
    }

    toggleUserDropdown() {
        this.showUserDropdown.update(v => !v);
    }

    private toDateInputValue(date: Date): string {
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().split('T')[0];
    }

    private formatDisplayDate(date: Date): string {
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    }

}
