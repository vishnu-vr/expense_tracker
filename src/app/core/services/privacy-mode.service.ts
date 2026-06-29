import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class PrivacyModeService {
    private readonly storageKey = 'expense-tracker.hide-amounts';
    hideAmounts = signal(false);

    constructor() {
        if (typeof window === 'undefined') {
            return;
        }
        const raw = localStorage.getItem(this.storageKey);
        this.hideAmounts.set(raw === 'true');
    }

    toggle() {
        this.setHidden(!this.hideAmounts());
    }

    setHidden(hidden: boolean) {
        this.hideAmounts.set(hidden);
        if (typeof window !== 'undefined') {
            localStorage.setItem(this.storageKey, String(hidden));
        }
    }
}
