import { Component, inject, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { TransactionService } from '../../core/services/transaction.service';
import { BudgetService } from '../../core/services/budget.service';
import { CategoryService } from '../../core/services/category.service';
import { spentForCategoryInMonth } from '../../core/utils/budget-alert';
import { AuthService } from '../../core/services/auth.service';
import { HomeService } from '../../core/services/home.service';
import { PwaService } from '../../core/services/pwa.service';
import { Transaction } from '../../core/models/models';
import { NotificationBellComponent } from '../../shared/components/notification-bell/notification-bell.component';
import { ChangelogService } from '../../core/services/changelog.service';
import { TagService } from '../../core/services/tag.service';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, NotificationBellComponent, MaskCurrencyPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent {
  transactionService = inject(TransactionService);
  budgetService = inject(BudgetService);
  categoryService = inject(CategoryService);
  tagService = inject(TagService);
  authService = inject(AuthService);
  homeService = inject(HomeService);
  pwaService = inject(PwaService);
  private router = inject(Router);
  private changelogService = inject(ChangelogService);
  private whatsNewAutoShown = false;
  isHydrating = computed(() => !this.homeService.initialized() || !this.transactionService.hasLoadedInitialData());

  /** Collapsed by default; user expands to see category breakdown. */
  budgetAlertsExpanded = signal(false);

  toggleBudgetAlertsExpanded(): void {
    this.budgetAlertsExpanded.update((v) => !v);
  }

  constructor() {
    // Redirect to onboarding if user has no home
    effect(() => {
      if (this.homeService.initialized() && !this.homeService.currentHome()) {
        this.router.navigate(['/onboarding']);
      }
    });

    effect(() => {
      if (this.transactionService.dashboardFilterState() !== 'monthly') {
        this.budgetAlertsExpanded.set(false);
      }
    }, { allowSignalWrites: true });

    effect(() => {
      if (this.whatsNewAutoShown) {
        return;
      }
      if (!this.authService.currentUser()?.uid) {
        return;
      }
      if (!this.homeService.initialized() || !this.homeService.currentHome()) {
        return;
      }
      this.whatsNewAutoShown = true;
      this.changelogService.showIfUnseen();
    }, { allowSignalWrites: true });
  }

  /**
   * In monthly view, categories that are at ≥90% of budget or over (same rules as Budgets / add-transaction).
   */
  monthlyBudgetAlerts = computed(() => {
    if (this.transactionService.dashboardFilterState() !== 'monthly') return [];
    const d = this.transactionService.dashboardCurrentDate();
    const year = d.getFullYear();
    const month = d.getMonth();
    const transactions = this.transactionService.transactions();
    const cats = this.categoryService.categories();
    const list: {
      categoryId: string;
      name: string;
      spent: number;
      budget: number;
      level: 'approach' | 'over';
      /** Rounded % of budget used; may exceed 100 when over. */
      spentPct: number;
      /** Width for progress bar (capped at 100). */
      barWidthPct: number;
    }[] = [];
    for (const b of this.budgetService.categoryBudgets()) {
      if (b.amount <= 0) continue;
      const spent = spentForCategoryInMonth(transactions, b.categoryId, year, month);
      const cat = cats.find((c) => c.id === b.categoryId);
      const spentPct = Math.round((spent / b.amount) * 100);
      const barWidthPct = Math.min(100, (spent / b.amount) * 100);
      if (spent > b.amount) {
        list.push({
          categoryId: b.categoryId,
          name: cat?.name ?? 'Category',
          spent,
          budget: b.amount,
          level: 'over',
          spentPct,
          barWidthPct
        });
      } else if (spent >= b.amount * 0.9) {
        list.push({
          categoryId: b.categoryId,
          name: cat?.name ?? 'Category',
          spent,
          budget: b.amount,
          level: 'approach',
          spentPct,
          barWidthPct
        });
      }
    }
    return list.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level === 'over' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  });

  /** Short sentence for the collapsed budget alert banner. */
  budgetAlertsSummaryLine = computed(() => {
    const rows = this.monthlyBudgetAlerts();
    const over = rows.filter((r) => r.level === 'over').length;
    const near = rows.filter((r) => r.level === 'approach').length;
    if (over > 0 && near > 0) {
      return `${over} over budget, ${near} near limit · ${rows.length} categories this month.`;
    }
    if (over > 0) {
      return over === 1
        ? '1 category is over budget this month.'
        : `${over} categories are over budget this month.`;
    }
    return near === 1
      ? '1 category is near its monthly budget limit.'
      : `${near} categories are near their monthly budget limits.`;
  });

  groupedTransactions = computed(() => {
    const transactions = this.transactionService.dashboardFilteredTransactions();
    const groups: { date: string; total: number; transactions: Transaction[] }[] = [];

    transactions.forEach(t => {
      const dateStr = new Date(t.date).toDateString();
      let group = groups.find(g => g.date === dateStr);
      if (!group) {
        group = { date: dateStr, total: 0, transactions: [] };
        groups.push(group);
      }
      group.transactions.push(t);
      if (t.type === 'expense') {
        group.total -= t.amount;
      } else {
        group.total += t.amount;
      }
    });

    return groups;
  });

  setFilter(filter: 'daily' | 'monthly') {
    this.transactionService.setDashboardFilter(filter);
  }

  prevPeriod() {
    this.transactionService.dashboardPrevPeriod();
  }

  nextPeriod() {
    this.transactionService.dashboardNextPeriod();
  }

  editTransaction(id: string) {
    this.router.navigate(['/edit-transaction', id]);
  }

  getCategory(id: string) {
    return this.categoryService.categories().find(c => c.id === id);
  }

  getTags(tagIds?: string[]) {
    return this.tagService.getTagsByIds(tagIds);
  }

  openTag(event: Event, tagId: string) {
    event.stopPropagation();
    this.router.navigate(['/tags', tagId]);
  }

  isOwner(transaction: Transaction): boolean {
    const currentUser = this.authService.currentUser();
    return !!currentUser && !!transaction.userId && transaction.userId === currentUser.uid;
  }

  onDateChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      this.transactionService.setDashboardDate(new Date(input.value));
    }
  }

  onMonthChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.value) {
      const [year, month] = input.value.split('-').map(Number);
      const newDate = new Date(year, month - 1, 1);
      this.transactionService.setDashboardDate(newDate);
    }
  }

  get currentDateStr() {
    const date = this.transactionService.dashboardCurrentDate();
    // Ensure we get the local date string in YYYY-MM-DD format
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
  }

  get currentMonthStr() {
    const date = this.transactionService.dashboardCurrentDate();
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
  }
}
