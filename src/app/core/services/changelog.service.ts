import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

export interface ChangelogEntry {
    icon: string;
    title: string;
    description: string;
    date: string;
}

@Injectable({
    providedIn: 'root'
})
export class ChangelogService {
    private authService = inject(AuthService);

    readonly entries: ChangelogEntry[] = [
        {
            icon: 'insights',
            title: 'Smart insights on spending trends',
            description:
                'Spot patterns in your spending over time — visit Smart insights in Profile to explore trends across categories and periods.',
            date: 'Mar 28, 2026'
        },
        {
            icon: 'visibility_off',
            title: 'Privacy mode',
            description:
                'Hide all amounts from view with one tap. Toggle it on or off anytime from the Privacy mode setting in Profile.',
            date: 'Mar 28, 2026'
        },
        {
            icon: 'date_range',
            title: 'Trends: custom date range',
            description:
                'On Trends, use a custom start and end date to analyze spending over any period, not just presets.',
            date: 'Mar 26, 2026'
        },
        {
            icon: 'account_balance_wallet',
            title: 'Monthly budgets',
            description:
                'Set a recurring monthly cap per category and compare it to spending for any month on the Budgets screen.',
            date: 'Mar 26, 2026'
        },
        {
            icon: 'category',
            title: 'Custom categories',
            description:
                'Add and edit income and expense categories for your home from Manage Categories in Profile.',
            date: 'Mar 26, 2026'
        }
    ];

    visible = signal(false);

    private storageKey(): string | null {
        const uid = this.authService.currentUser()?.uid;
        if (!uid) {
            return null;
        }
        return `expense_tracker_whats_new_v2_${uid}`;
    }

    hasUserSeen(): boolean {
        if (typeof localStorage === 'undefined') {
            return true;
        }
        const key = this.storageKey();
        if (!key) {
            return true;
        }
        return localStorage.getItem(key) === '1';
    }

    private markSeen(): void {
        if (typeof localStorage === 'undefined') {
            return;
        }
        const key = this.storageKey();
        if (!key) {
            return;
        }
        localStorage.setItem(key, '1');
    }

    /** Open from Profile (always allowed). */
    open(): void {
        this.visible.set(true);
    }

    dismiss(): void {
        this.visible.set(false);
        this.markSeen();
    }

    /** Auto-popup once per signed-in user (this browser), after they have a home. */
    showIfUnseen(): void {
        if (this.hasUserSeen()) {
            return;
        }
        this.visible.set(true);
    }
}
