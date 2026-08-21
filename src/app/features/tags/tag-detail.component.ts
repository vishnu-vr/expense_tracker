import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { TagService } from '../../core/services/tag.service';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { UserService } from '../../core/services/user.service';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';

@Component({
  selector: 'app-tag-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, MaskCurrencyPipe],
  templateUrl: './tag-detail.component.html'
})
export class TagDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tagService = inject(TagService);
  private transactionService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private userService = inject(UserService);

  private tagId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') || '')),
    { initialValue: this.route.snapshot.paramMap.get('id') || '' }
  );

  tag = computed(() => this.tagService.getTagById(this.tagId()));

  taggedTransactions = computed(() => {
    const id = this.tagId();
    if (!id) {
      return [];
    }
    return this.transactionService.transactions()
      .filter((t) => t.tagIds?.includes(id))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  totalExpense = computed(() =>
    this.taggedTransactions()
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0)
  );

  totalIncome = computed(() =>
    this.taggedTransactions()
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0)
  );

  net = computed(() => this.totalIncome() - this.totalExpense());

  dateRange = computed(() => {
    const txs = this.taggedTransactions();
    if (!txs.length) {
      return null;
    }
    const times = txs.map((t) => new Date(t.date).getTime());
    return {
      start: new Date(Math.min(...times)),
      end: new Date(Math.max(...times))
    };
  });

  categoryBreakdown = computed(() => {
    const expenses = this.taggedTransactions().filter((t) => t.type === 'expense');
    const total = expenses.reduce((sum, t) => sum + t.amount, 0);
    const byCategory = new Map<string, number>();
    expenses.forEach((t) => {
      byCategory.set(t.categoryId, (byCategory.get(t.categoryId) || 0) + t.amount);
    });

    return Array.from(byCategory.entries())
      .map(([categoryId, amount]) => {
        const category = this.categoryService.categories().find((c) => c.id === categoryId);
        return {
          categoryId,
          name: category?.name || 'Unknown',
          icon: category?.icon || 'category',
          color: category?.color || '#9E9E9E',
          amount,
          percentage: total > 0 ? (amount / total) * 100 : 0
        };
      })
      .sort((a, b) => b.amount - a.amount);
  });

  personSplit = computed(() => {
    this.userService.users();
    const byUser = new Map<string, { expense: number; income: number; count: number }>();
    this.taggedTransactions().forEach((t) => {
      const key = t.userId || t.userEmail || 'unknown';
      const current = byUser.get(key) || { expense: 0, income: 0, count: 0 };
      if (t.type === 'expense') {
        current.expense += t.amount;
      } else {
        current.income += t.amount;
      }
      current.count += 1;
      byUser.set(key, current);
    });

    return Array.from(byUser.entries())
      .map(([userId, totals]) => ({
        userId,
        name: this.userService.getUserName(userId) || userId,
        ...totals
      }))
      .sort((a, b) => b.expense - a.expense);
  });

  getCategoryName(categoryId: string): string {
    return this.categoryService.categories().find((c) => c.id === categoryId)?.name || 'Unknown';
  }

  editTransaction(id: string) {
    this.router.navigate(['/edit-transaction', id]);
  }
}
