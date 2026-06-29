export type TransactionType = 'income' | 'expense';

export interface Transaction {
    id: string;
    amount: number;
    categoryId: string;
    accountId?: string; // Optional for now
    date: Date;
    note?: string;
    type: TransactionType;
    userId?: string; // Added for Firestore ownership
    userEmail?: string; // User's email for display
}

export interface Category {
    id: string;
    name: string;
    icon: string;
    color: string;
    type: TransactionType;
}

export interface Account {
    id: string;
    name: string;
    type: string;
    balance: number;
}

export interface Budget {
    id: string;
    categoryId: string;
    amount: number;
    period: 'monthly';
}

/**
 * Recurring monthly budget for one expense category (home-scoped).
 * The same cap applies every calendar month; spending is compared per month in the UI.
 */
export interface CategoryRecurringBudget {
    id: string;
    categoryId: string;
    amount: number;
}

export interface Notification {
    id: string;
    type: 'transaction_added' | 'transaction_updated' | 'transaction_deleted';
    message: string;
    transactionId?: string;
    homeId?: string;
    createdBy: string;
    createdByName: string;
    createdAt: Date;
    readBy: string[]; // Array of user IDs who have read this notification
}