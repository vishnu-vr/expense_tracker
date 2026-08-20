import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, ActivatedRoute, ParamMap } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import { TransactionService } from '../../core/services/transaction.service';
import { CategoryService } from '../../core/services/category.service';
import { TagService } from '../../core/services/tag.service';
import { BudgetService } from '../../core/services/budget.service';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';
import {
    budgetDraftAlert,
    monthKeyFromDateInput,
    spentForCategoryInMonth
} from '../../core/utils/budget-alert';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';

@Component({
  selector: 'app-add-transaction',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaskCurrencyPipe],
  templateUrl: './add-transaction.component.html',
  styleUrl: './add-transaction.component.css'
})
export class AddTransactionComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private transactionService = inject(TransactionService);
  private authService = inject(AuthService);
  private budgetService = inject(BudgetService);
  categoryService = inject(CategoryService);
  tagService = inject(TagService);

  isEdit = signal(false);
  isOwner = signal(true);
  isSaving = signal(false);
  isLoadingTransaction = signal(false);
  isCreatingTag = signal(false);
  showNewTagInput = signal(false);
  newTagName = signal('');
  tagError = signal('');
  transactionId: string | null = null;
  private queryParamSub: Subscription | null = null;

  form = this.fb.group({
    type: ['expense', Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    categoryId: ['', Validators.required],
    date: [new Date().toLocaleDateString('en-CA'), Validators.required],
    time: [new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), Validators.required],
    note: [''],
    tagIds: this.fb.nonNullable.control<string[]>([])
  });

  /** Keeps spend projection in sync with the form (including SMS prefill and edit load). */
  private formSnapshot = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() }
  );

  /** Budget warning while adding/editing an expense (same 90% / over-cap rules as the Budgets screen). */
  budgetApproachAlert = computed(() => {
    if (!this.isOwner()) return null;
    const v = this.formSnapshot();
    if (!v || v.type !== 'expense') return null;
    const categoryId = v.categoryId;
    if (!categoryId) return null;
    const budget = this.budgetService.amountFor(categoryId);
    if (budget <= 0) return null;
    const ym = monthKeyFromDateInput(v.date as string);
    if (!ym) return null;
    const draftRaw = v.amount as number | null;
    const draftAmount = typeof draftRaw === 'number' && draftRaw > 0 ? draftRaw : 0;
    const spentBefore = spentForCategoryInMonth(
      this.transactionService.transactions(),
      categoryId,
      ym.year,
      ym.month,
      this.isEdit() ? this.transactionId : null
    );
    return budgetDraftAlert(budget, spentBefore, draftAmount);
  });

  async ngOnInit() {
    this.transactionId = this.route.snapshot.paramMap.get('id');
    if (this.transactionId) {
      this.isEdit.set(true);
      await this.loadTransactionForEdit(this.transactionId);
      return;
    }

    this.queryParamSub = this.route.queryParamMap.subscribe((params) => {
      this.applySmsPrefill(params);
    });
  }

  private async loadTransactionForEdit(id: string) {
    this.isLoadingTransaction.set(true);
    try {
      const transaction = await this.transactionService.getTransactionById(id);
      if (!transaction) {
        this.router.navigate(['/dashboard']);
        return;
      }

      // Check ownership
      const currentUser = this.authService.currentUser();
      if (currentUser && transaction.userId && transaction.userId !== currentUser.uid) {
        this.isOwner.set(false);
        this.form.disable();
      }

      const transDate = new Date(transaction.date);
      this.form.patchValue({
        type: transaction.type,
        amount: transaction.amount,
        categoryId: transaction.categoryId,
        date: transDate.toLocaleDateString('en-CA'),
        time: transDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        note: transaction.note,
        tagIds: transaction.tagIds || []
      });
    } finally {
      this.isLoadingTransaction.set(false);
    }
  }

  private applySmsPrefill(queryParamMap: ParamMap) {
    const smsPrefill = queryParamMap.get('smsPrefill');
    if (smsPrefill !== '1') return;

    const amountRaw = queryParamMap.get('amount');
    const typeRaw = queryParamMap.get('type');
    const noteRaw = queryParamMap.get('note');

    const parsedAmount = amountRaw ? Number(amountRaw) : NaN;
    const type = typeRaw === 'income' ? 'income' : 'expense';

    this.form.patchValue({
      type,
      amount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null,
      categoryId: '',
      note: noteRaw || ''
    });
  }

  ngOnDestroy() {
    this.queryParamSub?.unsubscribe();
  }

  async onSubmit() {
    if (this.form.valid && this.isOwner() && !this.isSaving()) {
      this.isSaving.set(true);
      try {
        const val = this.form.value;
        // Combine date and time
        const dateTime = new Date(`${val.date}T${val.time}`);
        const transactionData = {
          amount: val.amount!,
          type: val.type as 'income' | 'expense',
          categoryId: val.categoryId!,
          date: dateTime,
          note: val.note || '',
          accountId: 'default', // Placeholder
          tagIds: this.selectedTagIds()
        };

        if (this.isEdit() && this.transactionId) {
          await this.transactionService.updateTransaction({
            ...transactionData,
            id: this.transactionId
          });
        } else {
          await this.transactionService.addTransaction(transactionData);
        }
        this.router.navigate(['/dashboard']);
      } catch (error) {
        console.error('Error saving transaction:', error);
        this.isSaving.set(false);
        alert('Failed to save transaction. Please try again.');
      }
    }
  }

  async onDelete() {
    if (this.isEdit() && this.transactionId && this.isOwner()) {
      if (confirm('Are you sure you want to delete this transaction?')) {
        await this.transactionService.deleteTransaction(this.transactionId);
        this.router.navigate(['/dashboard']);
      }
    }
  }

  onCancel() {
    this.router.navigate(['/dashboard']);
  }

  selectedTagIds(): string[] {
    return this.form.controls.tagIds.value ?? [];
  }

  isTagSelected(tagId: string): boolean {
    return this.selectedTagIds().includes(tagId);
  }

  toggleTag(tagId: string) {
    if (!this.isOwner()) {
      return;
    }
    const current = this.selectedTagIds();
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    this.form.controls.tagIds.setValue(next);
  }

  onNewTagNameInput(event: Event) {
    this.newTagName.set((event.target as HTMLInputElement).value);
  }

  async createAndSelectTag() {
    const name = this.newTagName().trim();
    if (!name || this.isCreatingTag() || !this.isOwner()) {
      return;
    }

    this.tagError.set('');
    this.isCreatingTag.set(true);
    try {
      const tag = await this.tagService.addTag({ name });
      if (!this.isTagSelected(tag.id)) {
        this.form.controls.tagIds.setValue([...this.selectedTagIds(), tag.id]);
      }
      this.newTagName.set('');
      this.showNewTagInput.set(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create tag';
      this.tagError.set(message);
    } finally {
      this.isCreatingTag.set(false);
    }
  }
}
