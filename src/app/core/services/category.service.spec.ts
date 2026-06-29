import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { signal } from '@angular/core';
import { FS, resetNgFireModules } from '../firebase/ng-fire-mod';
import { CategoryService } from './category.service';
import { AuthService } from './auth.service';
import { HomeService } from './home.service';

describe('CategoryService', () => {
    let currentUser: ReturnType<typeof signal<{ uid: string } | null>>;
    let currentHome: ReturnType<typeof signal<{ id: string } | null>>;

    beforeEach(() => {
        currentUser = signal({ uid: 'u1' });
        currentHome = signal({ id: 'home1' });

        spyOn(FS, 'collection').and.returnValue({} as never);
        spyOn(FS, 'doc').and.callFake(
            ((_fs: unknown, ...segments: string[]) => ({
                id: segments[segments.length - 1],
            })) as typeof FS.doc,
        );
        spyOn(FS, 'setDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'updateDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'deleteDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'onSnapshot').and.callFake((( _ref: unknown, next: (s: unknown) => void) => {
            queueMicrotask(() =>
                next({
                    docs: [],
                    empty: true,
                }),
            );
            return () => {};
        }) as typeof FS.onSnapshot);

        TestBed.configureTestingModule({
            providers: [
                CategoryService,
                { provide: Firestore, useValue: {} },
                { provide: AuthService, useValue: { currentUser } },
                { provide: HomeService, useValue: { currentHome } },
            ],
        });
    });

    afterEach(() => {
        resetNgFireModules();
    });

    it('isDefaultCategory is true for built-in ids', () => {
        const svc = TestBed.inject(CategoryService);
        expect(svc.isDefaultCategory('food')).toBeTrue();
        expect(svc.isDefaultCategory('nonexistent_custom')).toBeFalse();
    });

    describe('with Firestore category docs', () => {
        beforeEach(() => {
            TestBed.resetTestingModule();
            (FS.onSnapshot as jasmine.Spy).and.callFake((( _ref: unknown, next: (s: unknown) => void) => {
                queueMicrotask(() =>
                    next({
                        docs: [
                            {
                                id: 'custom_a',
                                data: () => ({
                                    name: 'Custom A',
                                    type: 'expense',
                                    icon: 'x',
                                    color: '#fff',
                                }),
                            },
                        ],
                        empty: false,
                    }),
                );
                return () => {};
            }) as typeof FS.onSnapshot);

            TestBed.configureTestingModule({
                providers: [
                    CategoryService,
                    { provide: Firestore, useValue: {} },
                    { provide: AuthService, useValue: { currentUser: signal({ uid: 'u1' }) } },
                    { provide: HomeService, useValue: { currentHome: signal({ id: 'home1' }) } },
                ],
            });
        });

        it('merges defaults with Firestore categories', async () => {
            const svc = TestBed.inject(CategoryService);
            await new Promise((r) => setTimeout(r, 0));
            const ids = svc.categories().map((c) => c.id);
            expect(ids).toContain('food');
            expect(ids).toContain('custom_a');
        });
    });

    it('addCustomCategory rejects duplicate name case-insensitive', async () => {
        const svc = TestBed.inject(CategoryService);
        await Promise.resolve();
        await expectAsync(svc.addCustomCategory({ name: 'Food', type: 'expense' })).toBeRejectedWithError(
            /already exists/,
        );
    });

    it('addCustomCategory writes setDoc with generated id', async () => {
        spyOn(Date, 'now').and.returnValue(111);
        const svc = TestBed.inject(CategoryService);
        (FS.doc as jasmine.Spy).calls.reset();
        await svc.addCustomCategory({ name: 'Unique Cat', type: 'income' });
        expect(FS.setDoc).toHaveBeenCalled();
        const pathArgs = (FS.doc as jasmine.Spy).calls.all().map((c) => c.args);
        expect(pathArgs.some((a) => a.includes('unique_cat_111'))).toBeTrue();
    });

    it('updateCustomCategory calls updateDoc for custom id', async () => {
        const svc = TestBed.inject(CategoryService);
        await svc.updateCustomCategory('custom_x', {
            name: 'Renamed',
            type: 'expense',
        });
        expect(FS.updateDoc).toHaveBeenCalled();
    });

    it('deleteCustomCategory calls deleteDoc', async () => {
        const svc = TestBed.inject(CategoryService);
        await svc.deleteCustomCategory('custom_x');
        expect(FS.deleteDoc).toHaveBeenCalled();
    });
});
