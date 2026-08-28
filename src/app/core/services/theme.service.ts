import { Injectable, computed, signal, effect } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private readonly storageKey = 'expense-tracker.theme';
    private systemDark = signal(this.readSystemDark());

    preference = signal<ThemePreference>('system');

    effectiveTheme = computed<EffectiveTheme>(() => {
        const pref = this.preference();
        if (pref === 'light') return 'light';
        if (pref === 'dark') return 'dark';
        return this.systemDark() ? 'dark' : 'light';
    });

    constructor() {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(this.storageKey) as ThemePreference | null;
            if (stored === 'system' || stored === 'light' || stored === 'dark') {
                this.preference.set(stored);
            }

            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            const onChange = (e: MediaQueryListEvent) => this.systemDark.set(e.matches);
            mq.addEventListener('change', onChange);
        }

        effect(() => {
            this.applyTheme(this.effectiveTheme());
        }, { allowSignalWrites: true });
    }

    setPreference(pref: ThemePreference) {
        this.preference.set(pref);
        if (typeof window !== 'undefined') {
            localStorage.setItem(this.storageKey, pref);
        }
        this.applyTheme(this.effectiveTheme());
    }

    cycle() {
        const order: ThemePreference[] = ['system', 'light', 'dark'];
        const idx = order.indexOf(this.preference());
        this.setPreference(order[(idx + 1) % order.length]);
    }

    private readSystemDark(): boolean {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    private applyTheme(theme: EffectiveTheme) {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        const meta = document.getElementById('theme-color-meta') as HTMLMetaElement | null;
        if (meta) {
            meta.content = theme === 'dark' ? '#0b1120' : '#f1f5f9';
        }
    }
}
