import { Injectable, effect, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { FS } from '../firebase/ng-fire-mod';
import { Category } from '../models/models';
import { HomeService } from './home.service';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class CategoryService {
    private firestore = inject(Firestore);
    private homeService = inject(HomeService);
    private authService = inject(AuthService);
    private unsubscribeHomeCategories: (() => void) | null = null;
    private defaultCategoryIds: Set<string>;

    categories = signal<Category[]>([]);

    // Default categories (used as fallback and for initial data)
    private defaults: Category[] = [
        // Income
        { id: 'salary', name: 'Salary', icon: 'attach_money', color: '#4CAF50', type: 'income' },
        { id: 'business', name: 'Business', icon: 'business', color: '#8BC34A', type: 'income' },
        { id: 'gifts', name: 'Gifts', icon: 'card_giftcard', color: '#CDDC39', type: 'income' },

        // Expense
        { id: 'baby', name: 'Baby', icon: 'child_friendly', color: '#E91E63', type: 'expense' },
        { id: 'beauty', name: 'Beauty', icon: 'face', color: '#F06292', type: 'expense' },
        { id: 'bills', name: 'Bills', icon: 'receipt', color: '#FF5722', type: 'expense' },
        { id: 'car', name: 'Car', icon: 'directions_car', color: '#2196F3', type: 'expense' },
        { id: 'clothing', name: 'Clothing', icon: 'checkroom', color: '#9C27B0', type: 'expense' },
        { id: 'education', name: 'Education', icon: 'school', color: '#3F51B5', type: 'expense' },
        { id: 'electronics', name: 'Electronics', icon: 'devices', color: '#607D8B', type: 'expense' },
        { id: 'entertainment', name: 'Entertainment', icon: 'movie', color: '#673AB7', type: 'expense' },
        { id: 'food', name: 'Food', icon: 'restaurant', color: '#FF9800', type: 'expense' },
        { id: 'health', name: 'Health', icon: 'favorite', color: '#F44336', type: 'expense' },
        { id: 'home', name: 'Home', icon: 'home', color: '#795548', type: 'expense' },
        { id: 'insurance', name: 'Insurance', icon: 'security', color: '#009688', type: 'expense' },
        { id: 'shopping', name: 'Shopping', icon: 'shopping_cart', color: '#03A9F4', type: 'expense' },
        { id: 'social', name: 'Social', icon: 'people', color: '#E91E63', type: 'expense' },
        { id: 'sport', name: 'Sport', icon: 'sports_soccer', color: '#FFC107', type: 'expense' },
        { id: 'tax', name: 'Tax', icon: 'account_balance', color: '#9E9E9E', type: 'expense' },
        { id: 'telephone', name: 'Telephone', icon: 'phone', color: '#00BCD4', type: 'expense' },
        { id: 'transportation', name: 'Transportation', icon: 'directions_bus', color: '#3F51B5', type: 'expense' },
        { id: 'fun_activities', name: 'Fun Activities', icon: 'celebration', color: '#FFEB3B', type: 'expense' },
        { id: 'grocery', name: 'Grocery', icon: 'local_grocery_store', color: '#8BC34A', type: 'expense' },
        { id: 'gift', name: 'gift', icon: 'card_giftcard', color: '#CDDC39', type: 'expense' },
    ];

    constructor() {
        this.defaultCategoryIds = new Set(this.defaults.map((category) => category.id));
        this.startCategorySync();
    }

    private startCategorySync() {
        this.categories.set([...this.defaults]);

        effect(() => {
            const home = this.homeService.currentHome();
            if (this.unsubscribeHomeCategories) {
                this.unsubscribeHomeCategories();
                this.unsubscribeHomeCategories = null;
            }

            if (!home) {
                this.categories.set([...this.defaults]);
                return;
            }

            const homeCategoriesCollection = FS.collection(this.firestore, 'homes', home.id, 'categories');
            this.unsubscribeHomeCategories = FS.onSnapshot(homeCategoriesCollection, (snapshot) => {
                const firestoreCategories = snapshot.docs.map(categoryDoc => ({
                    id: categoryDoc.id,
                    ...categoryDoc.data()
                } as Category));

                const merged = new Map<string, Category>();
                this.defaults.forEach(cat => merged.set(cat.id, cat));
                firestoreCategories.forEach(cat => merged.set(cat.id, cat));

                this.categories.set(Array.from(merged.values()));
            }, (error) => {
                console.error('Error loading categories from Firestore:', error);
                this.categories.set([...this.defaults]);
            });
        }, { allowSignalWrites: true });
    }

    async addCustomCategory(input: {
        name: string;
        type: 'income' | 'expense';
        icon?: string;
        color?: string;
    }) {
        const user = this.authService.currentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }

        const home = this.homeService.currentHome();
        if (!home) {
            throw new Error('No active home selected');
        }

        const name = input.name.trim();
        if (!name) {
            throw new Error('Category name is required');
        }

        const duplicate = this.categories().some((category) =>
            category.type === input.type &&
            category.name.trim().toLowerCase() === name.toLowerCase()
        );
        if (duplicate) {
            throw new Error('A category with this name already exists');
        }

        const categoryId = this.generateCategoryId(name);
        const customCategoryRef = FS.doc(this.firestore, 'homes', home.id, 'categories', categoryId);
        await FS.setDoc(customCategoryRef, {
            name,
            type: input.type,
            icon: input.icon?.trim() || 'category',
            color: input.color?.trim() || '#3B82F6',
            homeId: home.id,
            createdBy: user.uid,
            createdAt: new Date()
        });
    }

    async updateCustomCategory(categoryId: string, input: {
        name: string;
        type: 'income' | 'expense';
        icon?: string;
        color?: string;
    }) {
        if (this.isDefaultCategory(categoryId)) {
            throw new Error('Default categories cannot be edited');
        }

        const home = this.requireHome();
        const name = input.name.trim();
        if (!name) {
            throw new Error('Category name is required');
        }

        const duplicate = this.categories().some((category) =>
            category.id !== categoryId &&
            category.type === input.type &&
            category.name.trim().toLowerCase() === name.toLowerCase()
        );
        if (duplicate) {
            throw new Error('A category with this name already exists');
        }

        const customCategoryRef = FS.doc(this.firestore, 'homes', home.id, 'categories', categoryId);
        await FS.updateDoc(customCategoryRef, {
            name,
            type: input.type,
            icon: input.icon?.trim() || 'category',
            color: input.color?.trim() || '#3B82F6'
        });
    }

    async deleteCustomCategory(categoryId: string) {
        if (this.isDefaultCategory(categoryId)) {
            throw new Error('Default categories cannot be deleted');
        }

        const home = this.requireHome();
        const customCategoryRef = FS.doc(this.firestore, 'homes', home.id, 'categories', categoryId);
        await FS.deleteDoc(customCategoryRef);
    }

    isDefaultCategory(categoryId: string): boolean {
        return this.defaultCategoryIds.has(categoryId);
    }

    private requireHome() {
        const user = this.authService.currentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }
        const home = this.homeService.currentHome();
        if (!home) {
            throw new Error('No active home selected');
        }
        return home;
    }

    private generateCategoryId(name: string): string {
        const slug = name
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return `${slug || 'custom_category'}_${Date.now()}`;
    }
}
