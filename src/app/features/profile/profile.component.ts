import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { HomeService } from '../../core/services/home.service';
import { ChangelogService } from '../../core/services/changelog.service';
import { PrivacyModeService } from '../../core/services/privacy-mode.service';

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
    user = this.authService.currentUser;
    home = this.homeService.currentHome;
    members = this.homeService.homeMembers;

    isLeavingHome = signal(false);

    logout() {
        this.authService.logout().subscribe();
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

}
