import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { HomeService } from '../../core/services/home.service';
import { ChangelogService } from '../../core/services/changelog.service';
import { PrivacyModeService } from '../../core/services/privacy-mode.service';
import { ThemeService, ThemePreference } from '../../core/services/theme.service';
import { ExportService } from '../../core/services/export.service';

type ExportMode = 'month' | 'range';

@Component({
    selector: 'app-profile',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './profile.component.html',
    styles: []
})
export class ProfileComponent {
    authService = inject(AuthService);
    homeService = inject(HomeService);
    changelogService = inject(ChangelogService);
    privacyModeService = inject(PrivacyModeService);
    themeService = inject(ThemeService);
    exportService = inject(ExportService);
    user = this.authService.currentUser;
    home = this.homeService.currentHome;
    members = this.homeService.homeMembers;

    isLeavingHome = signal(false);
    exportPanelOpen = signal(false);
    exportMode = signal<ExportMode>('month');
    selectedMonth = signal(this.currentYearMonth());
    rangeFrom = signal(this.firstDayOfCurrentMonth());
    rangeTo = signal(this.todayDateOnly());
    exportError = signal<string | null>(null);
    exportSuccess = signal<string | null>(null);

    logout() {
        this.authService.logout().subscribe();
    }

    setThemePreference(pref: ThemePreference) {
        this.themeService.setPreference(pref);
    }

    copyInviteCode() {
        const code = this.home()?.displayId;
        if (code) {
            navigator.clipboard.writeText(code).then(() => {
                alert('Invite code copied to clipboard!');
            });
        }
    }

    async leaveHome() {
        const confirmed = confirm(
            'Leave this home?\n\nYou will no longer see its transactions. Your past transactions will remain for other members.'
        );
        if (!confirmed) return;
        this.isLeavingHome.set(true);
        try {
            await this.homeService.leaveHome();
        } catch (err) {
            console.error('Failed to leave home:', err);
            alert('Something went wrong. Please try again.');
            this.isLeavingHome.set(false);
        }
    }

    toggleExportPanel() {
        this.exportPanelOpen.update((open) => !open);
        this.exportError.set(null);
        this.exportSuccess.set(null);
    }

    setExportMode(mode: ExportMode) {
        this.exportMode.set(mode);
        this.exportError.set(null);
        this.exportSuccess.set(null);
    }

    onMonthChange(event: Event) {
        const value = (event.target as HTMLInputElement).value;
        this.selectedMonth.set(value);
    }

    onRangeFromChange(event: Event) {
        this.rangeFrom.set((event.target as HTMLInputElement).value);
    }

    onRangeToChange(event: Event) {
        this.rangeTo.set((event.target as HTMLInputElement).value);
    }

    async exportTransactions() {
        this.exportError.set(null);
        this.exportSuccess.set(null);

        if (!this.home()) {
            this.exportError.set('Join or create a home before exporting.');
            return;
        }

        const range = this.resolveExportRange();
        if (!range) {
            return;
        }

        try {
            const result = await this.exportService.exportTransactions(range.from, range.to);
            const noun = result.count === 1 ? 'transaction' : 'transactions';
            this.exportSuccess.set(`Exported ${result.count} ${noun}.`);
        } catch (err) {
            console.error('Failed to export transactions:', err);
            this.exportError.set(this.exportService.error() || 'Failed to export transactions. Please try again.');
        }
    }

    private resolveExportRange(): { from: string; to: string } | null {
        if (this.exportMode() === 'month') {
            const month = this.selectedMonth();
            const match = /^(\d{4})-(\d{2})$/.exec(month);
            if (!match) {
                this.exportError.set('Select a month to export.');
                return null;
            }
            const year = Number(match[1]);
            const monthIndex = Number(match[2]) - 1;
            return {
                from: this.toDateOnly(new Date(year, monthIndex, 1)),
                to: this.toDateOnly(new Date(year, monthIndex + 1, 0)),
            };
        }

        const from = this.rangeFrom();
        const to = this.rangeTo();
        if (!from || !to) {
            this.exportError.set('Select both a start and end date.');
            return null;
        }
        if (from > to) {
            this.exportError.set('Start date cannot be after end date.');
            return null;
        }
        return { from, to };
    }

    private currentYearMonth(): string {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    private firstDayOfCurrentMonth(): string {
        const now = new Date();
        return this.toDateOnly(new Date(now.getFullYear(), now.getMonth(), 1));
    }

    private todayDateOnly(): string {
        return this.toDateOnly(new Date());
    }

    private toDateOnly(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
}
