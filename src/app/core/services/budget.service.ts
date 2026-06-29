import { Injectable, effect, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { FS } from '../firebase/ng-fire-mod';
import { CategoryRecurringBudget } from '../models/models';
import { HomeService } from './home.service';

@Injectable({
    providedIn: 'root'
})
export class BudgetService {
    private firestore = inject(Firestore);
    private homeService = inject(HomeService);
    private unsubscribeBudgets: (() => void) | null = null;

    /**
     * Recurring monthly budgets for the current home (`categoryBudgets` / doc id = categoryId).
     * Legacy per-calendar-month docs (with `year` + `month` fields) are ignored.
     */
    categoryBudgets = signal<CategoryRecurringBudget[]>([]);

    constructor() {
        effect(() => {
            const home = this.homeService.currentHome();
            if (this.unsubscribeBudgets) {
                this.unsubscribeBudgets();
                this.unsubscribeBudgets = null;
            }

            if (!home) {
                this.categoryBudgets.set([]);
                return;
            }

            const col = FS.collection(this.firestore, 'homes', home.id, 'categoryBudgets');
            this.unsubscribeBudgets = FS.onSnapshot(
                col,
                (snapshot) => {
                    const list: CategoryRecurringBudget[] = [];
                    for (const d of snapshot.docs) {
                        const data = d.data();
                        if (typeof data['year'] === 'number' && typeof data['month'] === 'number') {
                            continue;
                        }
                        const categoryId = (data['categoryId'] as string) || d.id;
                        const amount = Number(data['amount'] ?? 0);
                        if (!Number.isFinite(amount) || amount <= 0) {
                            continue;
                        }
                        list.push({
                            id: d.id,
                            categoryId,
                            amount
                        });
                    }
                    this.categoryBudgets.set(list);
                },
                (error) => {
                    console.error('Error loading category budgets:', error);
                    this.categoryBudgets.set([]);
                }
            );
        }, { allowSignalWrites: true });
    }

    /** Recurring monthly cap for this category (same every month). */
    amountFor(categoryId: string): number {
        const row = this.categoryBudgets().find((b) => b.categoryId === categoryId);
        return row?.amount ?? 0;
    }

    async setCategoryBudget(categoryId: string, amount: number): Promise<void> {
        const home = this.homeService.currentHome();
        if (!home) {
            throw new Error('No active home selected');
        }

        const ref = FS.doc(this.firestore, 'homes', home.id, 'categoryBudgets', categoryId);

        if (!Number.isFinite(amount) || amount <= 0) {
            await FS.deleteDoc(ref);
            return;
        }

        await FS.setDoc(ref, {
            categoryId,
            amount,
            homeId: home.id,
            updatedAt: new Date()
        });
    }
}
