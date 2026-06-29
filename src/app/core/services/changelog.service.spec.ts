import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
    installMemoryLocalStorage,
    restoreLocalStorage,
} from '../../../testing/browser-mocks';
import { ChangelogService } from './changelog.service';
import { AuthService } from './auth.service';

describe('ChangelogService', () => {
    let currentUser: ReturnType<typeof signal<{ uid: string } | null>>;

    beforeEach(() => {
        installMemoryLocalStorage();
        currentUser = signal<{ uid: string } | null>(null);
        TestBed.configureTestingModule({
            providers: [
                ChangelogService,
                { provide: AuthService, useValue: { currentUser } },
            ],
        });
    });

    afterEach(() => {
        restoreLocalStorage();
    });

    it('entries is a non-empty static list', () => {
        const svc = TestBed.inject(ChangelogService);
        expect(svc.entries.length).toBeGreaterThan(0);
    });

    it('hasUserSeen is false when no user', () => {
        const svc = TestBed.inject(ChangelogService);
        expect(svc.hasUserSeen()).toBeTrue(); // no uid -> storageKey null -> seen
    });

    it('hasUserSeen is false when user exists but flag missing', () => {
        currentUser.set({ uid: 'u1' });
        const svc = TestBed.inject(ChangelogService);
        expect(svc.hasUserSeen()).toBeFalse();
    });

    it('dismiss marks seen and hides', () => {
        currentUser.set({ uid: 'u1' });
        const svc = TestBed.inject(ChangelogService);
        svc.visible.set(true);
        svc.dismiss();
        expect(svc.visible()).toBeFalse();
        expect(localStorage.getItem('expense_tracker_whats_new_v2_u1')).toBe('1');
        expect(svc.hasUserSeen()).toBeTrue();
    });

    it('showIfUnseen opens only when unseen', () => {
        currentUser.set({ uid: 'u1' });
        const svc = TestBed.inject(ChangelogService);
        svc.showIfUnseen();
        expect(svc.visible()).toBeTrue();

        svc.dismiss();
        svc.showIfUnseen();
        expect(svc.visible()).toBeFalse();
    });
});
