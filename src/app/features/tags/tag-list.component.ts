import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TagService } from '../../core/services/tag.service';
import { HomeService } from '../../core/services/home.service';
import { TransactionService } from '../../core/services/transaction.service';
import { Tag } from '../../core/models/models';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';

@Component({
  selector: 'app-tag-list',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule, MaskCurrencyPipe],
  templateUrl: './tag-list.component.html'
})
export class TagListComponent {
  private fb = inject(FormBuilder);
  @ViewChild('editFormCard') editFormCard?: ElementRef<HTMLElement>;
  tagService = inject(TagService);
  homeService = inject(HomeService);
  private transactionService = inject(TransactionService);

  isSaving = signal(false);
  errorMessage = signal('');
  successMessage = signal('');
  editingTagId = signal<string | null>(null);

  addTagForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    color: ['#3B82F6'],
    note: ['']
  });

  tagSummaries = computed(() => {
    const transactions = this.transactionService.transactions();
    return this.tagService.tags().map((tag) => {
      const tagged = transactions.filter((t) => t.tagIds?.includes(tag.id));
      const expense = tagged
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
      return {
        tag,
        count: tagged.length,
        expense
      };
    });
  });

  async onSaveTag() {
    this.errorMessage.set('');
    this.successMessage.set('');
    if (this.addTagForm.invalid || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    try {
      const value = this.addTagForm.getRawValue();
      const payload = {
        name: value.name,
        color: value.color || undefined,
        note: value.note || undefined
      };
      const editingId = this.editingTagId();
      if (editingId) {
        await this.tagService.updateTag(editingId, payload);
        this.successMessage.set('Tag updated.');
      } else {
        await this.tagService.addTag(payload);
        this.successMessage.set('Tag added to this home.');
      }
      this.cancelEdit();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save tag';
      this.errorMessage.set(message);
    } finally {
      this.isSaving.set(false);
    }
  }

  startEdit(tag: Tag) {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.editingTagId.set(tag.id);
    this.addTagForm.patchValue({
      name: tag.name,
      color: tag.color || '#3B82F6',
      note: tag.note || ''
    });
    setTimeout(() => {
      this.editFormCard?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  cancelEdit() {
    this.editingTagId.set(null);
    this.errorMessage.set('');
    this.addTagForm.patchValue({
      name: '',
      color: '#3B82F6',
      note: ''
    });
  }

  async deleteTag(tag: Tag, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!confirm(`Delete "${tag.name}"? Existing transactions keep their history but will no longer show this tag.`)) {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    try {
      await this.tagService.deleteTag(tag.id);
      if (this.editingTagId() === tag.id) {
        this.cancelEdit();
      }
      this.successMessage.set('Tag deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete tag';
      this.errorMessage.set(message);
    }
  }

  startEditFromRow(tag: Tag, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.startEdit(tag);
  }
}
