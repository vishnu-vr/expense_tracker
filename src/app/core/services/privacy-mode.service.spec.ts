import { TestBed } from '@angular/core/testing';
import {
    installMemoryLocalStorage,
    restoreLocalStorage,
} from '../../../testing/browser-mocks';
import { PrivacyModeService } from './privacy-mode.service';

describe('PrivacyModeService', () => {
    const key = 'expense-tracker.hide-amounts';

    beforeEach(() => {
        installMemoryLocalStorage();
    });

    afterEach(() => {
        restoreLocalStorage();
    });

    it('reads initial hideAmounts from localStorage', () => {
        window.localStorage.setItem(key, 'true');
        const svc = TestBed.runInInjectionContext(() => new PrivacyModeService());
        expect(svc.hideAmounts()).toBeTrue();
    });

    it('toggle flips hideAmounts and persists string true/false', () => {
        const svc = TestBed.runInInjectionContext(() => new PrivacyModeService());
        expect(svc.hideAmounts()).toBeFalse();
        svc.toggle();
        expect(svc.hideAmounts()).toBeTrue();
        expect(window.localStorage.getItem(key)).toBe('true');
        svc.toggle();
        expect(svc.hideAmounts()).toBeFalse();
        expect(window.localStorage.getItem(key)).toBe('false');
    });

    it('setHidden persists to localStorage', () => {
        const svc = TestBed.runInInjectionContext(() => new PrivacyModeService());
        svc.setHidden(true);
        expect(window.localStorage.getItem(key)).toBe('true');
        svc.setHidden(false);
        expect(window.localStorage.getItem(key)).toBe('false');
    });
});
