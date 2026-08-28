import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
    let svc: ThemeService;
    const storage: Record<string, string> = {};

    beforeEach(() => {
        Object.keys(storage).forEach((k) => delete storage[k]);
        spyOn(localStorage, 'getItem').and.callFake((key: string) => storage[key] ?? null);
        spyOn(localStorage, 'setItem').and.callFake((key: string, value: string) => {
            storage[key] = value;
        });

        TestBed.configureTestingModule({});
        svc = TestBed.inject(ThemeService);
        document.documentElement.classList.remove('dark');
    });

    afterEach(() => {
        document.documentElement.classList.remove('dark');
    });

    it('defaults to system preference', () => {
        expect(svc.preference()).toBe('system');
    });

    it('applies dark class when preference is dark', () => {
        svc.setPreference('dark');
        expect(svc.effectiveTheme()).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBeTrue();
    });

    it('removes dark class when preference is light', () => {
        svc.setPreference('dark');
        svc.setPreference('light');
        expect(svc.effectiveTheme()).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBeFalse();
    });

    it('persists preference to localStorage', () => {
        svc.setPreference('dark');
        expect(localStorage.setItem).toHaveBeenCalledWith('expense-tracker.theme', 'dark');
    });

    it('cycles through system, light, dark', () => {
        svc.setPreference('system');
        svc.cycle();
        expect(svc.preference()).toBe('light');
        svc.cycle();
        expect(svc.preference()).toBe('dark');
        svc.cycle();
        expect(svc.preference()).toBe('system');
    });

    it('restores stored preference on init', () => {
        storage['expense-tracker.theme'] = 'dark';
        const fresh = TestBed.runInInjectionContext(() => new ThemeService());
        expect(fresh.preference()).toBe('dark');
    });
});
