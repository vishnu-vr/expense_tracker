import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { signal } from '@angular/core';
import { FS, resetNgFireModules } from '../firebase/ng-fire-mod';
import { UserService } from './user.service';
import { AuthService } from './auth.service';
import { HomeService } from './home.service';

describe('UserService', () => {
    let currentUser: ReturnType<typeof signal<{ uid: string } | null>>;
    let currentHome: ReturnType<
        typeof signal<{ id: string; memberIds: string[] } | null>
    >;

    beforeEach(() => {
        currentUser = signal({ uid: 'u1' });
        currentHome = signal({
            id: 'h1',
            memberIds: ['u1', 'u2'],
        });

        spyOn(FS, 'doc').and.callFake(
            ((_fs: unknown, ...segments: string[]) => ({
                id: segments[segments.length - 1],
            })) as typeof FS.doc,
        );
        spyOn(FS, 'onSnapshot').and.callFake(((
            ref: { id?: string },
            next: (s: unknown) => void,
        ) => {
            const id = ref.id ?? '';
            queueMicrotask(() =>
                next({
                    exists: () => true,
                    id,
                    data: () => ({ id, name: id === 'u1' ? 'Alice' : 'Bob' }),
                }),
            );
            return () => {};
        }) as unknown as typeof FS.onSnapshot);

        TestBed.configureTestingModule({
            providers: [
                UserService,
                { provide: Firestore, useValue: {} },
                {
                    provide: AuthService,
                    useValue: { currentUser },
                },
                {
                    provide: HomeService,
                    useValue: { currentHome },
                },
            ],
        });
    });

    afterEach(() => {
        resetNgFireModules();
    });

    it('getUserById returns user after snapshot', async () => {
        const svc = TestBed.inject(UserService);
        await Promise.resolve();
        await Promise.resolve();
        expect(svc.getUserById('u1')?.name).toBe('Alice');
    });

    it('getUserName prefers display name from map', async () => {
        const svc = TestBed.inject(UserService);
        await Promise.resolve();
        await Promise.resolve();
        expect(svc.getUserName('u2')).toBe('Bob');
    });

    it('getUserName falls back to formatted id when unknown', () => {
        const svc = TestBed.inject(UserService);
        const longId = 'abcdefghijklmno';
        const name = svc.getUserName(longId);
        expect(name).toContain('...');
        expect(name.startsWith('abcdef')).toBeTrue();
    });
});
