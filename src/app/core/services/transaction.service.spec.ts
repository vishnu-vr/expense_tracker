import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { signal } from '@angular/core';
import { FS, resetNgFireModules } from '../firebase/ng-fire-mod';
import { TransactionService } from './transaction.service';
import { AuthService } from './auth.service';
import { HomeService } from './home.service';
import { NotificationService } from './notification.service';
import { Transaction } from '../models/models';
import { setOnline, restoreNavigatorOnline } from '../../../testing/browser-mocks';

describe('TransactionService', () => {
    let currentUser: ReturnType<typeof signal<{ uid: string; email?: string | null; displayName?: string | null } | null>>;
    let currentHome: ReturnType<typeof signal<{ id: string } | null>>;
    let createNotification: jasmine.Spy;

    const baseTx = (partial: Partial<Transaction>): Transaction =>
        ({
            id: 't1',
            amount: 100,
            categoryId: 'food',
            date: new Date(2026, 4, 10),
            type: 'expense',
            ...partial,
        }) as Transaction;

    beforeEach(() => {
        currentUser = signal({
            uid: 'u1',
            email: 'a@b.com',
            displayName: 'Alice',
        });
        currentHome = signal({ id: 'home1' });
        createNotification = jasmine.createSpy('createNotification').and.returnValue(Promise.resolve());

        spyOn(FS, 'collection').and.returnValue({} as never);
        spyOn(FS, 'doc').and.callFake(((...args: unknown[]) => {
            if (args.length === 1) {
                return { id: 'new-tx-id' };
            }
            const last = args[args.length - 1] as string;
            return { id: last };
        }) as typeof FS.doc);
        spyOn(FS, 'query').and.returnValue({} as never);
        spyOn(FS, 'where').and.returnValue({} as never);
        spyOn(FS, 'orderBy').and.returnValue({} as never);
        spyOn(FS, 'onSnapshot').and.callFake((( _q: unknown, next: (s: unknown) => void) => {
            queueMicrotask(() =>
                next({
                    docs: [],
                    empty: true,
                }),
            );
            return () => {};
        }) as typeof FS.onSnapshot);
        spyOn(FS, 'setDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'updateDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'deleteDoc').and.returnValue(Promise.resolve());
        spyOn(FS, 'getDoc').and.returnValue(
            Promise.resolve({ exists: () => false } as never),
        );

        setOnline(true);

        TestBed.configureTestingModule({
            providers: [
                TransactionService,
                { provide: Firestore, useValue: {} },
                { provide: AuthService, useValue: { currentUser } },
                { provide: HomeService, useValue: { currentHome } },
                { provide: NotificationService, useValue: { createNotification } },
            ],
        });
    });

    afterEach(() => {
        restoreNavigatorOnline();
        resetNgFireModules();
    });

    it('dashboardFilteredTransactions filters daily by calendar day', async () => {
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        const day = new Date(2026, 4, 10);
        svc.transactions.set([
            baseTx({ id: 'a', date: day, amount: 50, type: 'expense' }),
            baseTx({ id: 'b', date: new Date(2026, 4, 11), amount: 10, type: 'expense' }),
        ]);
        svc.dashboardFilterState.set('daily');
        svc.dashboardCurrentDate.set(day);
        expect(svc.dashboardFilteredTransactions().length).toBe(1);
    });

    it('dashboardFilteredTransactions filters monthly', async () => {
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        svc.transactions.set([
            baseTx({ id: 'a', date: new Date(2026, 4, 5), type: 'income', amount: 200 }),
            baseTx({ id: 'b', date: new Date(2026, 3, 5), type: 'expense', amount: 50 }),
        ]);
        svc.dashboardFilterState.set('monthly');
        svc.dashboardCurrentDate.set(new Date(2026, 4, 1));
        const rows = svc.dashboardFilteredTransactions();
        expect(rows.length).toBe(1);
        expect(svc.totalIncome()).toBe(200);
        expect(svc.totalExpense()).toBe(0);
        expect(svc.balance()).toBe(200);
    });

    it('analysis range filter uses inclusive day boundaries', async () => {
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        svc.transactions.set([
            baseTx({ id: 'a', date: new Date(2026, 4, 5, 12, 0, 0), type: 'expense', amount: 10 }),
            baseTx({ id: 'b', date: new Date(2026, 4, 15), type: 'expense', amount: 20 }),
        ]);
        svc.analysisFilterState.set('range');
        svc.setAnalysisDateRange(new Date(2026, 4, 1), new Date(2026, 4, 10));
        const rows = svc.analysisFilteredTransactions();
        expect(rows.length).toBe(1);
        expect(rows[0].id).toBe('a');
    });

    it('addTransaction notifies when online', async () => {
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        setOnline(true);
        await svc.addTransaction({
            amount: 99,
            categoryId: 'food',
            date: new Date(),
            type: 'expense',
        });
        expect(createNotification).toHaveBeenCalledWith(
            'transaction_added',
            jasmine.stringMatching(/Alice/),
            jasmine.any(String),
            'home1',
        );
        expect(FS.setDoc).toHaveBeenCalled();
    });

    it('addTransaction returns without awaiting Firestore when offline', async () => {
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        (FS.setDoc as jasmine.Spy).and.returnValue(new Promise(() => {}));
        createNotification.and.returnValue(Promise.resolve());
        setOnline(false);
        await expectAsync(
            svc.addTransaction({
                amount: 99,
                categoryId: 'food',
                date: new Date(),
                type: 'expense',
            }),
        ).toBeResolved();
        expect(FS.setDoc).toHaveBeenCalled();
    });

    it('dashboardNextPeriod advances day or month', async () => {
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        const d = new Date(2026, 4, 10);
        svc.dashboardCurrentDate.set(d);
        svc.dashboardFilterState.set('daily');
        svc.dashboardNextPeriod();
        expect(svc.dashboardCurrentDate().getDate()).toBe(11);

        svc.dashboardFilterState.set('monthly');
        svc.dashboardCurrentDate.set(new Date(2026, 4, 10));
        svc.dashboardNextPeriod();
        expect(svc.dashboardCurrentDate().getMonth()).toBe(5);
    });

    it('dashboardPrevPeriod rewinds day or month', async () => {
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        svc.dashboardFilterState.set('daily');
        svc.dashboardCurrentDate.set(new Date(2026, 4, 10));
        svc.dashboardPrevPeriod();
        expect(svc.dashboardCurrentDate().getDate()).toBe(9);
    });

    it('getTransactionById maps Firestore Timestamp to Date', async () => {
        (FS.getDoc as jasmine.Spy).and.returnValue(
            Promise.resolve({
                exists: () => true,
                id: 'tid',
                data: () => ({
                    amount: 1,
                    categoryId: 'food',
                    date: { toDate: () => new Date(2026, 1, 1) },
                    type: 'expense',
                    homeId: 'home1',
                }),
            } as never),
        );
        const svc = TestBed.inject(TransactionService);
        await Promise.resolve();
        const t = await svc.getTransactionById('tid');
        expect(t?.date instanceof Date).toBeTrue();
    });
});
