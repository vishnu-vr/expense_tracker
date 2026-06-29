import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { FS, resetNgFireModules } from '../firebase/ng-fire-mod';
import { NotificationService } from './notification.service';
import { AuthService } from './auth.service';
import { HomeService } from './home.service';
import { PlatformService } from './platform.service';
import { installMockNotification } from '../../../testing/browser-mocks';
import { Notification } from '../models/models';

describe('NotificationService', () => {
    beforeEach(() => {
        installMockNotification('granted');

        spyOn(FS, 'collection').and.returnValue({} as never);
        spyOn(FS, 'query').and.returnValue({} as never);
        spyOn(FS, 'where').and.returnValue({} as never);
        spyOn(FS, 'orderBy').and.returnValue({} as never);
        spyOn(FS, 'limit').and.returnValue({} as never);
        spyOn(FS, 'startAfter').and.returnValue({} as never);
        spyOn(FS, 'onSnapshot').and.callFake((( _q: unknown, next: (s: unknown) => void) => {
            queueMicrotask(() =>
                next({
                    docs: [],
                    empty: true,
                }),
            );
            return () => {};
        }) as typeof FS.onSnapshot);
        spyOn(FS, 'addDoc').and.returnValue(Promise.resolve({} as never));
        spyOn(FS, 'doc').and.returnValue({ id: 'n1' } as never);
        spyOn(FS, 'updateDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'setDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'getDocs').and.returnValue(Promise.resolve({ docs: [] } as never));
        spyOn(FS, 'arrayUnion').and.callFake(((uid: string) => ({ __op: 'arrayUnion', uid })) as never);

        TestBed.configureTestingModule({
            providers: [
                NotificationService,
                { provide: Firestore, useValue: {} },
                { provide: AuthService, useValue: { currentUser: signal({ uid: 'me' }) } },
                { provide: HomeService, useValue: { currentHome: signal({ id: 'h1' }) } },
                {
                    provide: PlatformService,
                    useValue: { isNative: false, platform: 'web', isWeb: true },
                },
                {
                    provide: Router,
                    useValue: {
                        navigateByUrl: jasmine.createSpy('navigateByUrl'),
                        navigate: jasmine.createSpy('navigate'),
                    },
                },
            ],
        });
    });

    afterEach(() => {
        resetNgFireModules();
    });

    function sampleNotification(partial: Partial<Notification>): Notification {
        return {
            id: 'n1',
            type: 'transaction_added',
            message: 'hello',
            createdBy: 'other',
            createdByName: 'Bob',
            createdAt: new Date(),
            readBy: [],
            homeId: 'h1',
            ...partial,
        };
    }

    it('getTimeAgo returns Just now for under a minute', () => {
        const svc = TestBed.inject(NotificationService);
        const now = new Date();
        expect(svc.getTimeAgo(new Date(now.getTime() - 30 * 1000))).toBe('Just now');
    });

    it('getTimeAgo returns minutes under an hour', () => {
        const svc = TestBed.inject(NotificationService);
        const now = new Date();
        expect(svc.getTimeAgo(new Date(now.getTime() - 30 * 60 * 1000))).toMatch(/\d+m ago/);
    });

    it('getTimeAgo returns hours under a day', () => {
        const svc = TestBed.inject(NotificationService);
        const now = new Date();
        expect(svc.getTimeAgo(new Date(now.getTime() - 3 * 60 * 60 * 1000))).toMatch(/\d+h ago/);
    });

    it('getTimeAgo returns days under a week', () => {
        const svc = TestBed.inject(NotificationService);
        const now = new Date();
        expect(svc.getTimeAgo(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000))).toMatch(/\d+d ago/);
    });

    it('unreadNotifications excludes self-authored notifications', async () => {
        const svc = TestBed.inject(NotificationService);
        await Promise.resolve();
        svc.notifications.set([
            sampleNotification({ id: 'a', createdBy: 'me' }),
            sampleNotification({ id: 'b', createdBy: 'you', readBy: [] }),
        ]);
        expect(svc.unreadNotifications().map((n) => n.id)).toEqual(['b']);
    });

    it('unreadNotifications excludes notifications already read', async () => {
        const svc = TestBed.inject(NotificationService);
        await Promise.resolve();
        svc.notifications.set([
            sampleNotification({ id: 'b', createdBy: 'you', readBy: ['me'] }),
        ]);
        expect(svc.unreadNotifications().length).toBe(0);
    });

    it('markAllAsRead updates docs for unread items', async () => {
        const svc = TestBed.inject(NotificationService);
        await Promise.resolve();
        svc.notifications.set([
            sampleNotification({ id: 'x', createdBy: 'you', readBy: [] }),
            sampleNotification({ id: 'y', createdBy: 'you', readBy: [] }),
        ]);
        (FS.updateDoc as jasmine.Spy).calls.reset();
        await svc.markAllAsRead();
        expect(FS.updateDoc).toHaveBeenCalled();
        expect((FS.updateDoc as jasmine.Spy).calls.count()).toBe(2);
    });
});
