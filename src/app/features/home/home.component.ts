import { Component, inject, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { InsightsService } from '../../core/services/insights.service';
import { CategoryService } from '../../core/services/category.service';
import { AuthService } from '../../core/services/auth.service';
import { HomeService } from '../../core/services/home.service';
import { TransactionService } from '../../core/services/transaction.service';
import { PrivacyModeService } from '../../core/services/privacy-mode.service';
import { ThemeService } from '../../core/services/theme.service';
import { NotificationBellComponent } from '../../shared/components/notification-bell/notification-bell.component';
import { MaskCurrencyPipe } from '../../shared/pipes/mask-currency.pipe';
import { buildBurnSparkline } from '../../core/utils/burn-sparkline';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterModule, NotificationBellComponent, MaskCurrencyPipe],
    templateUrl: './home.component.html',
    styleUrl: './home.component.css'
})
export class HomeComponent {
    readonly Math = Math;

    insights = inject(InsightsService);
    categoryService = inject(CategoryService);
    authService = inject(AuthService);
    homeService = inject(HomeService);
    transactionService = inject(TransactionService);
    privacyModeService = inject(PrivacyModeService);
    themeService = inject(ThemeService);
    private router = inject(Router);

    isHydrating = computed(
        () => !this.homeService.initialized() || !this.transactionService.hasLoadedInitialData()
    );

    greeting = computed(() => {
        const user = this.authService.currentUser();
        const name = user?.displayName?.split(' ')[0] || 'there';
        const hour = new Date().getHours();
        const prefix = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        return `${prefix}`;
    });

    pacingLabel = computed(() => {
        const pacing = this.insights.budgetPacing();
        const status = pacing.status;
        if (pacing.totalBudget <= 0) return 'No budgets set';
        if (status === 'warning') return 'Pacing ahead of schedule';
        if (status === 'ahead') return 'Slightly ahead';
        return 'On track';
    });

    deltaLabel = computed(() => {
        const delta = this.insights.financialHealth().periodDeltaPct;
        if (delta === null) return null;
        const rounded = Math.round(delta);
        if (rounded > 0) return `+${rounded}% vs last month`;
        if (rounded < 0) return `${rounded}% vs last month`;
        return 'Same as last month';
    });

    burnNarrative = computed(() => {
        const burn = this.insights.burnRate();
        const savings = burn.projectedSavings;
        if (burn.dailyBurnRate <= 0) return 'No spending recorded this month yet.';
        if (savings >= 0) {
            return `At your current pace, you'll save this month.`;
        }
        return `At your current pace, spending may exceed income.`;
    });

    /** Cumulative spend sparkline + dashed month-end forecast. Display-only; does not change burn math. */
    burnSparkline = computed(() => {
        const burn = this.insights.burnRate();
        const daysElapsed = burn.daysElapsed;

        if (daysElapsed <= 0 || burn.spentMtd <= 0) {
            return buildBurnSparkline([], burn.totalDays, burn.monthEndForecast);
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const daily = new Array<number>(daysElapsed).fill(0);

        for (const t of this.transactionService.transactions()) {
            if (t.type !== 'expense') continue;
            const d = new Date(t.date);
            if (d.getFullYear() !== year || d.getMonth() !== month) continue;
            const day = d.getDate();
            if (day >= 1 && day <= daysElapsed) {
                daily[day - 1] += t.amount;
            }
        }

        return buildBurnSparkline(daily, burn.totalDays, burn.monthEndForecast);
    });

    insightColorClass = (color: string): string => {
        const map: Record<string, string> = {
            amber: 'insight-amber',
            blue: 'insight-blue',
            red: 'insight-red',
            emerald: 'insight-emerald',
            purple: 'insight-purple',
            indigo: 'insight-indigo'
        };
        return map[color] ?? 'insight-blue';
    };

    getCategory(id: string) {
        return this.categoryService.categories().find((c) => c.id === id);
    }

    togglePrivacy() {
        this.privacyModeService.toggle();
    }

    toggleTheme() {
        this.themeService.cycle();
    }

    constructor() {
        effect(() => {
            if (this.homeService.initialized() && !this.homeService.currentHome()) {
                this.router.navigate(['/onboarding']);
            }
        });
    }
}
