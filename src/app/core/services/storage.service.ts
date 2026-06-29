import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase } from 'idb';
import { IDB } from '../idb/idb-mod';

interface ExpenseDB extends DBSchema {
    transactions: {
        key: string;
        value: {
            id: string;
            amount: number;
            categoryId: string;
            accountId: string;
            date: Date;
            note?: string;
            type: 'income' | 'expense';
        };
        indexes: { 'by-date': Date };
    };
    categories: {
        key: string;
        value: {
            id: string;
            name: string;
            icon: string;
            color: string;
            type: 'income' | 'expense';
        };
    };
    accounts: {
        key: string;
        value: {
            id: string;
            name: string;
            type: string;
            balance: number;
        };
    };
    budgets: {
        key: string;
        value: {
            id: string;
            categoryId: string;
            amount: number;
            period: string; // 'monthly'
        };
    };
}

@Injectable({
    providedIn: 'root'
})
export class StorageService {
    private dbPromise: Promise<IDBPDatabase<ExpenseDB>>;

    constructor() {
        this.dbPromise = IDB.openDB<ExpenseDB>('expense-tracker-db', 1, {
            upgrade(db) {
                const transactionStore = db.createObjectStore('transactions', { keyPath: 'id' });
                transactionStore.createIndex('by-date', 'date');

                db.createObjectStore('categories', { keyPath: 'id' });
                db.createObjectStore('accounts', { keyPath: 'id' });
                db.createObjectStore('budgets', { keyPath: 'id' });
            },
        });
    }

    async addTransaction(transaction: ExpenseDB['transactions']['value']) {
        const db = await this.dbPromise;
        return db.put('transactions', transaction);
    }

    async getAllTransactions() {
        const db = await this.dbPromise;
        return db.getAllFromIndex('transactions', 'by-date');
    }

    async deleteTransaction(id: string) {
        const db = await this.dbPromise;
        return db.delete('transactions', id);
    }

    async addCategory(category: ExpenseDB['categories']['value']) {
        const db = await this.dbPromise;
        return db.put('categories', category);
    }

    async getAllCategories() {
        const db = await this.dbPromise;
        return db.getAll('categories');
    }
}
