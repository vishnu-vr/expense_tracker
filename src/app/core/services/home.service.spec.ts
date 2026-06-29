import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { FS, FF, resetNgFireModules } from '../firebase/ng-fire-mod';
import { HomeService, Home } from './home.service';
import { AuthService } from './auth.service';

describe('HomeService', () => {
    let user$: Subject<unknown>;
    let currentUser: ReturnType<typeof signal<{ uid: string; email?: string | null } | null>>;
    let navigateSpy: jasmine.Spy;

    const mockUser = { uid: 'user-1', email: 'a@b.com' };

    beforeEach(() => {
        user$ = new Subject();
        currentUser = signal(mockUser);
        navigateSpy = jasmine.createSpy('navigate');

        spyOn(FS, 'collection').and.returnValue({} as never);
        spyOn(FS, 'setDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'getDoc').and.returnValue(
            Promise.resolve({
                exists: () => false,
                data: () => ({}),
                id: 'x',
            } as never),
        );
        spyOn(FS, 'doc').and.callFake(((...args: unknown[]) => {
            const last = args[args.length - 1];
            if (args.length === 1) {
                return { id: 'auto-home-id' };
            }
            return { id: typeof last === 'string' ? last : 'doc' };
        }) as typeof FS.doc);
        spyOn(FS, 'writeBatch').and.returnValue({
            update: jasmine.createSpy('update'),
            commit: jasmine.createSpy('commit').and.returnValue(Promise.resolve()),
        } as never);
        spyOn(FS, 'arrayRemove').and.callFake(((uid: string) => ({ __op: 'arrayRemove', uid })) as never);
        spyOn(FS, 'deleteField').and.returnValue({ __op: 'deleteField' } as never);

        TestBed.configureTestingModule({
            providers: [
                HomeService,
                { provide: Firestore, useValue: {} },
                {
                    provide: AuthService,
                    useValue: {
                        user$: user$.asObservable(),
                        currentUser,
                    },
                },
                { provide: Router, useValue: { navigate: navigateSpy } },
            ],
        });
    });

    afterEach(() => {
        resetNgFireModules();
    });

    it('createHome uses a 6-char display id from charset', async () => {
        spyOn(Math, 'random').and.returnValue(0);
        const svc = TestBed.inject(HomeService);
        const home = await svc.createHome('My Home');
        expect(home.displayId?.length).toBe(6);
        expect(home.displayId).toBe('AAAAAA');
        expect(FS.setDoc).toHaveBeenCalled();
    });

    it('createHome writes home doc and merges user homeId', async () => {
        const svc = TestBed.inject(HomeService);
        (FS.setDoc as jasmine.Spy).calls.reset();
        await svc.createHome('H');
        expect((FS.setDoc as jasmine.Spy).calls.count()).toBeGreaterThanOrEqual(2);
    });

    it('joinHome calls callable joinHome and sets current home', async () => {
        const mockHome: Home = {
            id: 'h1',
            name: 'N',
            displayId: 'ABC123',
            ownerId: 'user-1',
            memberIds: ['user-1'],
            createdAt: new Date(),
        };
        const joinFn = jasmine.createSpy('joinHomeFn').and.returnValue(Promise.resolve({ data: mockHome }));
        spyOn(FF, 'httpsCallable').and.returnValue(joinFn as never);
        spyOn(FF, 'getFunctions').and.returnValue({} as never);

        const svc = TestBed.inject(HomeService);
        spyOn(svc, 'loadHomeMembers').and.returnValue(Promise.resolve());

        const result = await svc.joinHome('ABC123');
        expect(FF.httpsCallable).toHaveBeenCalledWith(jasmine.anything(), 'joinHome');
        expect(joinFn).toHaveBeenCalledWith({ displayId: 'ABC123' });
        expect(result?.id).toBe('h1');
        expect(svc.currentHome()?.id).toBe('h1');
    });

    it('leaveHome runs batch update and navigates to onboarding', async () => {
        const svc = TestBed.inject(HomeService);
        svc.currentHome.set({
            id: 'home-1',
            name: 'N',
            displayId: 'X',
            ownerId: 'user-1',
            memberIds: ['user-1'],
            createdAt: new Date(),
        });

        await svc.leaveHome();

        const writeBatchSpy = FS.writeBatch as jasmine.Spy;
        const batch = writeBatchSpy.calls.mostRecent().returnValue as {
            update: jasmine.Spy;
            commit: jasmine.Spy;
        };
        expect(batch.update).toHaveBeenCalledTimes(2);
        expect(batch.commit).toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith(['/onboarding']);
        expect(svc.currentHome()).toBeNull();
    });

    it('loadUserHome sets currentHome when user doc has homeId', async () => {
        (FS.getDoc as jasmine.Spy).and.callFake(((ref: { id?: string }) => {
            const id = ref.id ?? '';
            if (id === 'user-1') {
                return Promise.resolve({
                    exists: () => true,
                    data: () => ({ homeId: 'home-1' }),
                    id: 'user-1',
                });
            }
            if (id === 'home-1') {
                return Promise.resolve({
                    exists: () => true,
                    data: () => ({
                        name: 'H',
                        displayId: 'DIS123',
                        ownerId: 'user-1',
                        memberIds: ['user-1'],
                        createdAt: new Date(),
                    }),
                    id: 'home-1',
                });
            }
            return Promise.resolve({ exists: () => false, data: () => ({}), id: '' });
        }) as unknown as typeof FS.getDoc);

        const svc = TestBed.inject(HomeService);
        spyOn(svc, 'loadHomeMembers').and.returnValue(Promise.resolve());

        await svc.loadUserHome('user-1');
        expect(svc.currentHome()?.id).toBe('home-1');
    });
});
