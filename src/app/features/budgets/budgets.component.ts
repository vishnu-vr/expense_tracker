import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CategoryService } from '../../core/services/category.service';
import { BudgetService } from '../../core/services/budget.service';
import { TransactionService } from '../../core/services/transaction.service';
import { HomeService } from '../../core/services/home.service';
import { Category } from '../../core/models/models';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';

type BudgetRow = { cat: Category; budget: number; spent: number; /** Bar fill width 0–100 */ pct: number; /** Actual % used, may exceed 100 */ spentPct: number };

@Component({
    selector: 'app-budgets',
    standalone: true,
    imports: [CommonModule, RouterModule, MaskCurrencyPipe],
    templateUrl: './budgets.component.html',
    styleUrl: './budgets.component.css'
})
export class BudgetsComponent {
    categoryService = inject(CategoryService);
    budgetService = inject(BudgetService);
    transactionService = inject(TransactionService);
    homeService = inject(HomeService);

    /** First day of the month for spend / progress */
    viewMonth = signal<Date>(this.startOfMonth(new Date()));

    errorMessage = signal('');
    savingCategoryId = signal<string | null>(null);
    /** Search on the main list (budgets only). */
    categoryQuery = signal('');

    /** Add-budget modal */
    showAddBudget = signal(false);
    addFlowCategoryQuery = signal('');
    addFlowSelectedCategoryId = signal<string | null>(null);
    addFlowAmountDraft = signal('');
    addFlowError = signal('');
    addFlowSaving = signal(false);

    expenseCategories = computed(() =>
        this.categoryService
            .categories()
            .filter((c) => c.type === 'expense')
            .sort((a, b) => a.name.localeCompare(b.name))
    );

    spentByCategory = computed(() => {
        const year = this.viewMonth().getFullYear();
        const month = this.viewMonth().getMonth();
        const map = new Map<string, number>();

        for (const t of this.transactionService.transactions()) {
            if (t.type !== 'expense') continue;
            const d = new Date(t.date);
            if (d.getFullYear() !== year || d.getMonth() !== month) continue;
            map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + t.amount);
        }
        return map;
    });

    rows = computed((): BudgetRow[] => {
        const spentMap = this.spentByCategory();

        return this.expenseCategories().map((cat) => {
            const budget = this.budgetService.amountFor(cat.id);
            const spent = spentMap.get(cat.id) ?? 0;
            const spentPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
            const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
            return { cat, budget, spent, pct, spentPct };
        });
    });

    /** Expense categories that do not have a recurring budget yet. */
    categoriesWithoutBudget = computed(() => {
        const budgeted = new Set(this.budgetService.categoryBudgets().map((b) => b.categoryId));
        return this.expenseCategories().filter((c) => !budgeted.has(c.id));
    });

    addFlowFilteredCategories = computed(() => {
        const q = this.addFlowCategoryQuery().trim().toLowerCase();
        let list = this.categoriesWithoutBudget();
        if (q) {
            list = list.filter((c) => c.name.toLowerCase().includes(q));
        }
        return list;
    });

    /**
     * Main list: only categories with a budget. Over cap first, then ≥90% spend, then A–Z.
     * While searching, sort A–Z only.
     */
    budgetedDisplayRows = computed(() => {
        const q = this.categoryQuery().trim().toLowerCase();
        let list = this.rows().filter((r) => r.budget > 0);
        if (q) {
            list = list.filter((r) => r.cat.name.toLowerCase().includes(q));
            return [...list].sort((a, b) => a.cat.name.localeCompare(b.cat.name));
        }
        return [...list].sort((a, b) => {
            const aOver = a.spent >= a.budget;
            const bOver = b.spent >= b.budget;
            if (aOver !== bOver) {
                return aOver ? -1 : 1;
            }
            const aWarn = a.spent >= a.budget * 0.9;
            const bWarn = b.spent >= b.budget * 0.9;
            if (aWarn !== bWarn) {
                return aWarn ? -1 : 1;
            }
            return a.cat.name.localeCompare(b.cat.name);
        });
    });

    get currentMonthStr(): string {
        const d = this.viewMonth();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    onMonthInput(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.value) return;
        const [year, month] = input.value.split('-').map(Number);
        this.viewMonth.set(new Date(year, month - 1, 1));
    }

    prevMonth() {
        const d = new Date(this.viewMonth());
        d.setMonth(d.getMonth() - 1);
        this.viewMonth.set(this.startOfMonth(d));
    }

    nextMonth() {
        const d = new Date(this.viewMonth());
        d.setMonth(d.getMonth() + 1);
        this.viewMonth.set(this.startOfMonth(d));
    }

    async saveBudget(cat: Category, rawValue: string) {
        this.errorMessage.set('');
        const parsed = parseFloat(rawValue.replace(/,/g, '').trim());
        const amount = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

        this.savingCategoryId.set(cat.id);
        try {
            await this.budgetService.setCategoryBudget(cat.id, amount);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Could not save budget';
            this.errorMessage.set(msg);
        } finally {
            this.savingCategoryId.set(null);
        }
    }

    private startOfMonth(d: Date): Date {
        return new Date(d.getFullYear(), d.getMonth(), 1);
    }

    budgetRowTrack(row: BudgetRow) {
        return row.cat.id;
    }

    inputValue(row: { budget: number }): string | number {
        return row.budget > 0 ? row.budget : '';
    }

    onBudgetCommit(cat: Category, event: Event) {
        const el = event.target as HTMLInputElement;
        this.saveBudget(cat, el.value);
    }

    async deleteBudget(cat: Category) {
        if (!confirm(`Remove monthly budget for "${cat.name}"?`)) {
            return;
        }
        this.errorMessage.set('');
        this.savingCategoryId.set(cat.id);
        try {
            await this.budgetService.setCategoryBudget(cat.id, 0);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Could not remove budget';
            this.errorMessage.set(msg);
        } finally {
            this.savingCategoryId.set(null);
        }
    }

    onSearchInput(event: Event) {
        const v = (event.target as HTMLInputElement).value;
        this.categoryQuery.set(v);
    }

    clearSearch() {
        this.categoryQuery.set('');
    }

    openAddBudget() {
        this.addFlowError.set('');
        this.addFlowSelectedCategoryId.set(null);
        this.addFlowAmountDraft.set('');
        this.addFlowCategoryQuery.set('');
        this.showAddBudget.set(true);
    }

    closeAddBudget() {
        this.showAddBudget.set(false);
    }

    selectCategoryForAdd(categoryId: string) {
        this.addFlowSelectedCategoryId.set(categoryId);
        this.addFlowError.set('');
    }

    onAddFlowCategorySearch(event: Event) {
        this.addFlowCategoryQuery.set((event.target as HTMLInputElement).value);
    }

    onAddFlowAmountInput(event: Event) {
        this.addFlowAmountDraft.set((event.target as HTMLInputElement).value);
        this.addFlowError.set('');
    }

    async submitAddBudget() {
        const catId = this.addFlowSelectedCategoryId();
        if (!catId) {
            this.addFlowError.set('Choose a category.');
            return;
        }
        const parsed = parseFloat(this.addFlowAmountDraft().replace(/,/g, '').trim());
        if (!Number.isFinite(parsed) || parsed <= 0) {
            this.addFlowError.set('Enter a monthly budget amount greater than zero.');
            return;
        }

        this.addFlowSaving.set(true);
        this.addFlowError.set('');
        try {
            await this.budgetService.setCategoryBudget(catId, parsed);
            this.closeAddBudget();
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Could not save budget';
            this.addFlowError.set(msg);
        } finally {
            this.addFlowSaving.set(false);
        }
    }
}
