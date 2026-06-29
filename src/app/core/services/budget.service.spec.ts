import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { signal } from '@angular/core';
import { FS, resetNgFireModules } from '../firebase/ng-fire-mod';
import { BudgetService } from './budget.service';
import { HomeService } from './home.service';

describe('BudgetService', () => {
    let currentHome: ReturnType<typeof signal<{ id: string } | null>>;

    beforeEach(() => {
        currentHome = signal({ id: 'home1' });

        spyOn(FS, 'collection').and.returnValue({} as never);
        spyOn(FS, 'doc').and.callFake(
            ((_fs: unknown, ...segments: string[]) => ({
                id: segments[segments.length - 1],
            })) as typeof FS.doc,
        );
        spyOn(FS, 'setDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'deleteDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'onSnapshot').and.callFake((( _ref: unknown, next: (s: unknown) => void) => {
            queueMicrotask(() =>
                next({
                    docs: [
                        {
                            id: 'food',
                            data: () => ({
                                categoryId: 'food',
                                amount: 100,
                            }),
                        },
                        {
                            id: 'legacy',
                            data: () => ({
                                categoryId: 'legacy',
                                amount: 50,
                                year: 2024,
                                month: 1,
                            }),
                        },
                        {
                            id: 'bad',
                            data: () => ({
                                categoryId: 'bad',
                                amount: 0,
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
                BudgetService,
                { provide: Firestore, useValue: {} },
                { provide: HomeService, useValue: { currentHome } },
            ],
        });
    });

    afterEach(() => {
        resetNgFireModules();
    });

    it('maps recurring budgets and skips legacy monthly docs', async () => {
        const svc = TestBed.inject(BudgetService);
        await new Promise((r) => setTimeout(r, 0));
        const rows = svc.categoryBudgets();
        expect(rows.find((r) => r.categoryId === 'food')?.amount).toBe(100);
        expect(rows.some((r) => r.categoryId === 'legacy')).toBeFalse();
        expect(rows.some((r) => r.categoryId === 'bad')).toBeFalse();
    });

    it('amountFor returns matching category amount', async () => {
        const svc = TestBed.inject(BudgetService);
        await new Promise((r) => setTimeout(r, 0));
        expect(svc.amountFor('food')).toBe(100);
        expect(svc.amountFor('missing')).toBe(0);
    });

    it('setCategoryBudget deletes doc when amount invalid', async () => {
        const svc = TestBed.inject(BudgetService);
        await svc.setCategoryBudget('food', 0);
        expect(FS.deleteDoc).toHaveBeenCalled();
    });

    it('setCategoryBudget writes doc for positive amount', async () => {
        const svc = TestBed.inject(BudgetService);
        await svc.setCategoryBudget('food', 250);
        expect(FS.setDoc).toHaveBeenCalled();
    });
});
