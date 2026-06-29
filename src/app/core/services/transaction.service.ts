import { Injectable, computed, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { FS } from '../firebase/ng-fire-mod';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { HomeService } from './home.service';
import { Transaction } from '../models/models';
import { Observable, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

export type DashboardFilterMode = 'daily' | 'monthly';
export type AnalysisFilterMode = 'monthly' | 'range';

@Injectable({
    providedIn: 'root'
})
export class TransactionService {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);
    private homeService = inject(HomeService); // Inject HomeService
    private notificationService = inject(NotificationService);
    private transactionsCollection = FS.collection(this.firestore, 'transactions');

    transactions = signal<Transaction[]>([]);
    hasLoadedInitialData = signal(false);

    // Dashboard period context
    dashboardFilterState = signal<DashboardFilterMode>('daily');
    dashboardCurrentDate = signal(new Date());

    // Analysis period context
    analysisFilterState = signal<AnalysisFilterMode>('monthly');
    analysisCurrentDate = signal(new Date());
    analysisRangeStart = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    analysisRangeEnd = signal(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));

    dashboardFilteredTransactions = computed(() =>
        this.filterTransactions(this.dashboardFilterState(), this.dashboardCurrentDate())
    );

    analysisFilteredTransactions = computed(() =>
        this.filterTransactions(
            this.analysisFilterState(),
            this.analysisCurrentDate(),
            this.analysisRangeStart(),
            this.analysisRangeEnd()
        )
    );

    totalIncome = computed(() => this.dashboardFilteredTransactions()
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0));

    totalExpense = computed(() => this.dashboardFilteredTransactions()
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0));

    balance = computed(() => this.totalIncome() - this.totalExpense());

    constructor() {
        this.loadTransactions();
    }

    private filterTransactions(
        filter: DashboardFilterMode | AnalysisFilterMode,
        date: Date,
        rangeStart?: Date,
        rangeEnd?: Date
    ): Transaction[] {
        return this.transactions()
            .filter((t) => {
                const tDate = new Date(t.date);
                if (filter === 'daily') {
                    return tDate.toDateString() === date.toDateString();
                }
                if (filter === 'monthly') {
                    return tDate.getMonth() === date.getMonth() && tDate.getFullYear() === date.getFullYear();
                }
                if (!rangeStart || !rangeEnd) {
                    return false;
                }

                const transactionTime = this.startOfDay(tDate).getTime();
                const startTime = this.startOfDay(rangeStart).getTime();
                const endTime = this.endOfDay(rangeEnd).getTime();
                return transactionTime >= startTime && transactionTime <= endTime;
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    private loadTransactions() {
        // Subscribe to currentHome instead of just user
        toObservable(this.homeService.currentHome).pipe(
            switchMap(home => {
                this.hasLoadedInitialData.set(false);
                if (home) {
                    // Fetch transactions for this HOME ordered by date
                    // Requires Index: homeId ASC, date DESC
                    const q = FS.query(
                        this.transactionsCollection,
                        FS.where('homeId', '==', home.id),
                        FS.orderBy('date', 'desc')
                    );

                    return new Observable<Transaction[]>(observer => {
                        const unsubscribe = FS.onSnapshot(q, (snapshot) => {
                            const transactions = snapshot.docs.map(doc => {
                                const data = doc.data();
                                return {
                                    id: doc.id,
                                    ...data,
                                    date: (data['date'] as any).toDate ? (data['date'] as any).toDate() : new Date(data['date'])
                                } as Transaction;
                            });
                            this.hasLoadedInitialData.set(true);
                            observer.next(transactions);
                        }, (error) => {
                            console.error('Error loading transactions:', error);
                            this.hasLoadedInitialData.set(true);
                            observer.error(error);
                        });
                        return () => unsubscribe();
                    }).pipe(
                        catchError(err => {
                            console.error('Error in transaction stream:', err);
                            return of([]);
                        })
                    );
                } else {
                    this.hasLoadedInitialData.set(true);
                    return of([]);
                }
            })
        ).subscribe(transactions => {
            this.transactions.set(transactions);
        });
    }

    async getTransactionById(id: string): Promise<Transaction | null> {
        const existing = this.transactions().find(t => t.id === id);
        if (existing) return existing;

        const snap = await FS.getDoc(FS.doc(this.firestore, 'transactions', id));
        if (!snap.exists()) return null;

        const data = snap.data();
        return {
            id: snap.id,
            ...data,
            date: (data['date'] as any)?.toDate ? (data['date'] as any).toDate() : new Date(data['date'])
        } as Transaction;
    }

    async addTransaction(transaction: Omit<Transaction, 'id'>) {
        const user = this.authService.currentUser();
        const home = this.homeService.currentHome();

        if (!user) throw new Error('User not authenticated');
        if (!home) throw new Error('No home selected');

        const newTransaction = {
            ...transaction,
            userId: user.uid,
            userEmail: user.email || undefined,
            homeId: home.id, // Add homeId
            date: new Date(transaction.date).toISOString()
        };

        // Generate document ID locally so we don't have to wait for the write
        const docRef = FS.doc(this.transactionsCollection);
        const transactionOp = FS.setDoc(docRef, newTransaction);

        // Create notification for other users
        const userName = user.displayName || user.email || 'Someone';
        const typeLabel = transaction.type === 'income' ? 'income' : 'expense';
        const message = `${userName} added a new ${typeLabel} of ₹${transaction.amount.toLocaleString('en-IN')}`;
        const notificationOp = this.notificationService.createNotification(
            'transaction_added',
            message,
            docRef.id,
            home.id
        );

        // If offline, return immediately - Firestore will sync when back online
        if (!navigator.onLine) return;

        // If online, wait for both operations
        await Promise.all([transactionOp, notificationOp]);
    }

    async updateTransaction(transaction: Transaction) {
        const user = this.authService.currentUser();
        const home = this.homeService.currentHome();
        if (!user || !home) return;

        const docRef = FS.doc(this.firestore, 'transactions', transaction.id);
        const { id, ...data } = transaction;

        const updateOp = FS.updateDoc(docRef, {
            ...data,
            date: new Date(data.date).toISOString()
        });

        // Create notification for update
        const userName = user.displayName || user.email || 'Someone';
        const message = `${userName} updated a transaction: ${transaction.note || 'No note'} - ₹${transaction.amount}`;
        const notificationOp = this.notificationService.createNotification(
            'transaction_updated',
            message,
            transaction.id,
            home.id
        );

        if (!navigator.onLine) return;
        await Promise.all([updateOp, notificationOp]);
    }

    async deleteTransaction(id: string) {
        const docRef = FS.doc(this.firestore, 'transactions', id);
        const op = FS.deleteDoc(docRef);
        if (!navigator.onLine) return;
        await op;
    }

    // Dashboard helpers
    dashboardNextPeriod() {
        const date = new Date(this.dashboardCurrentDate());
        if (this.dashboardFilterState() === 'daily') {
            date.setDate(date.getDate() + 1);
        } else {
            date.setMonth(date.getMonth() + 1);
        }
        this.dashboardCurrentDate.set(date);
    }

    dashboardPrevPeriod() {
        const date = new Date(this.dashboardCurrentDate());
        if (this.dashboardFilterState() === 'daily') {
            date.setDate(date.getDate() - 1);
        } else {
            date.setMonth(date.getMonth() - 1);
        }
        this.dashboardCurrentDate.set(date);
    }

    setDashboardFilter(filter: DashboardFilterMode) {
        this.dashboardFilterState.set(filter);
        this.dashboardCurrentDate.set(new Date());
    }

    setDashboardDate(date: Date) {
        this.dashboardCurrentDate.set(date);
    }

    // Analysis helpers
    analysisNextPeriod() {
        if (this.analysisFilterState() === 'range') return;
        const date = new Date(this.analysisCurrentDate());
        date.setMonth(date.getMonth() + 1);
        this.analysisCurrentDate.set(date);
    }

    analysisPrevPeriod() {
        if (this.analysisFilterState() === 'range') return;
        const date = new Date(this.analysisCurrentDate());
        date.setMonth(date.getMonth() - 1);
        this.analysisCurrentDate.set(date);
    }

    setAnalysisFilter(filter: AnalysisFilterMode) {
        this.analysisFilterState.set(filter);
        if (filter === 'monthly') {
            this.analysisCurrentDate.set(new Date());
        }
    }

    setAnalysisDate(date: Date) {
        this.analysisCurrentDate.set(date);
    }

    setAnalysisDateRange(start: Date, end: Date) {
        this.analysisRangeStart.set(this.startOfDay(start));
        this.analysisRangeEnd.set(this.endOfDay(end));
    }

    private startOfDay(date: Date): Date {
        const value = new Date(date);
        value.setHours(0, 0, 0, 0);
        return value;
    }

    private endOfDay(date: Date): Date {
        const value = new Date(date);
        value.setHours(23, 59, 59, 999);
        return value;
    }
}
