import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CategoryService } from '../../../core/services/category.service';
import { HomeService } from '../../../core/services/home.service';
import { Category } from '../../../core/models/models';

@Component({
  selector: 'app-category-list',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './category-list.component.html',
  styleUrl: './category-list.component.css'
})
export class CategoryListComponent {
  private fb = inject(FormBuilder);
  @ViewChild('editFormCard') editFormCard?: ElementRef<HTMLElement>;
  categoryService = inject(CategoryService);
  homeService = inject(HomeService);
  availableIcons = [
    'category',
    'attach_money',
    'business',
    'card_giftcard',
    'child_friendly',
    'face',
    'receipt',
    'directions_car',
    'checkroom',
    'school',
    'devices',
    'movie',
    'restaurant',
    'favorite',
    'home',
    'security',
    'shopping_cart',
    'people',
    'sports_soccer',
    'account_balance',
    'phone',
    'directions_bus',
    'celebration',
    'local_grocery_store'
  ];
  formatIconLabel(icon: string) {
    return icon.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  isAdding = signal(false);
  errorMessage = signal('');
  successMessage = signal('');
  editingCategoryId = signal<string | null>(null);

  addCategoryForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(40)]],
    type: ['expense' as 'income' | 'expense', Validators.required],
    icon: ['category'],
    color: ['#3B82F6']
  });

  async onAddCategory() {
    this.errorMessage.set('');
    this.successMessage.set('');
    if (this.addCategoryForm.invalid || this.isAdding()) {
      return;
    }

    this.isAdding.set(true);
    try {
      const value = this.addCategoryForm.getRawValue();
      const payload = {
        name: value.name,
        type: value.type,
        icon: value.icon || undefined,
        color: value.color || undefined
      };
      const editingId = this.editingCategoryId();
      if (editingId) {
        await this.categoryService.updateCustomCategory(editingId, payload);
        this.successMessage.set('Category updated.');
      } else {
        await this.categoryService.addCustomCategory(payload);
        this.successMessage.set('Category added to this home.');
      }

      this.editingCategoryId.set(null);
      this.addCategoryForm.patchValue({
        name: '',
        type: 'expense',
        icon: 'category',
        color: '#3B82F6'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add category';
      this.errorMessage.set(message);
    } finally {
      this.isAdding.set(false);
    }
  }

  startEdit(category: Category) {
    if (this.categoryService.isDefaultCategory(category.id)) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.editingCategoryId.set(category.id);
    this.addCategoryForm.patchValue({
      name: category.name,
      type: category.type,
      icon: category.icon || 'category',
      color: category.color || '#3B82F6'
    });
    setTimeout(() => {
      this.editFormCard?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  cancelEdit() {
    this.editingCategoryId.set(null);
    this.errorMessage.set('');
    this.addCategoryForm.patchValue({
      name: '',
      type: 'expense',
      icon: 'category',
      color: '#3B82F6'
    });
  }

  async deleteCategory(category: Category) {
    if (this.categoryService.isDefaultCategory(category.id)) {
      return;
    }
    if (!confirm(`Delete "${category.name}" category?`)) {
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    try {
      await this.categoryService.deleteCustomCategory(category.id);
      if (this.editingCategoryId() === category.id) {
        this.cancelEdit();
      }
      this.successMessage.set('Category deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete category';
      this.errorMessage.set(message);
    }
  }
}
