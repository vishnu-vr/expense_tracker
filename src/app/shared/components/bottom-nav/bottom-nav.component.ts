import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
    selector: 'app-bottom-nav',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
        @if (visible()) {
        <nav class="bottom-nav" aria-label="Main navigation">
            <a routerLink="/home" routerLinkActive="bottom-nav-active" class="bottom-nav-item" aria-label="Home">
                <span class="material-icons">home</span>
                <span class="bottom-nav-label">Home</span>
            </a>
            <a routerLink="/transactions" routerLinkActive="bottom-nav-active" class="bottom-nav-item" aria-label="Transactions">
                <span class="material-icons">receipt_long</span>
                <span class="bottom-nav-label">Transactions</span>
            </a>
            <a routerLink="/add-transaction" class="bottom-nav-fab" aria-label="Add transaction">
                <span class="material-icons">add</span>
            </a>
            <a routerLink="/budgets" routerLinkActive="bottom-nav-active" class="bottom-nav-item" aria-label="Budgets">
                <span class="material-icons">account_balance_wallet</span>
                <span class="bottom-nav-label">Budgets</span>
            </a>
            <a routerLink="/analysis" routerLinkActive="bottom-nav-active" class="bottom-nav-item" aria-label="Analytics">
                <span class="material-icons">analytics</span>
                <span class="bottom-nav-label">Analytics</span>
            </a>
        </nav>
        }
    `,
    styles: [
        `
            .bottom-nav {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                z-index: 50;
                display: flex;
                align-items: flex-end;
                justify-content: space-around;
                padding: 0.5rem 0.75rem;
                padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));
                background: rgba(255, 255, 255, 0.92);
                backdrop-filter: blur(12px);
                border-top: 1px solid rgba(15, 23, 42, 0.06);
                box-shadow: 0 -4px 24px rgba(15, 23, 42, 0.06);
            }

            .bottom-nav-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.125rem;
                padding: 0.375rem 0.5rem;
                color: #64748b;
                text-decoration: none;
                border-radius: 0.75rem;
                transition: color 0.15s, background 0.15s;
                min-width: 3.5rem;
            }

            .bottom-nav-item .material-icons {
                font-size: 1.375rem;
            }

            .bottom-nav-label {
                font-size: 0.625rem;
                font-weight: 600;
                letter-spacing: 0.02em;
            }

            .bottom-nav-active {
                color: #2563eb;
            }

            .bottom-nav-fab {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 3.25rem;
                height: 3.25rem;
                margin-bottom: 0.25rem;
                border-radius: 9999px;
                background: linear-gradient(135deg, #2563eb, #4f46e5);
                color: white;
                text-decoration: none;
                box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45);
                transition: transform 0.15s, box-shadow 0.15s;
            }

            .bottom-nav-fab:active {
                transform: scale(0.95);
            }

            .bottom-nav-fab .material-icons {
                font-size: 1.75rem;
            }
        `
    ]
})
export class BottomNavComponent {
    private router = inject(Router);
    private url = signal(this.router.url);

    constructor() {
        this.router.events
            .pipe(filter((e) => e instanceof NavigationEnd))
            .subscribe((e) => {
                this.url.set((e as NavigationEnd).urlAfterRedirects);
            });
    }

    visible = computed(() => {
        const path = this.url().split('?')[0];
        const hidden = ['/login', '/onboarding', '/add-transaction', '/sms-permission-help'];
        if (hidden.includes(path)) return false;
        if (path.startsWith('/edit-transaction')) return false;
        return true;
    });
}
