/**
 * Test-only browser API helpers for Karma/Jasmine.
 */

export interface MemoryLocalStorage extends Storage {
    _backing: Map<string, string>;
}

export function createMemoryLocalStorage(): MemoryLocalStorage {
    const store = new Map<string, string>();
    return {
        _backing: store,
        get length() {
            return store.size;
        },
        clear(): void {
            store.clear();
        },
        getItem(key: string): string | null {
            return store.has(key) ? store.get(key)! : null;
        },
        key(index: number): string | null {
            return Array.from(store.keys())[index] ?? null;
        },
        removeItem(key: string): void {
            store.delete(key);
        },
        setItem(key: string, value: string): void {
            store.set(key, String(value));
        },
    } as MemoryLocalStorage;
}

let savedLocalStorage: Storage | undefined;

/** Replace window.localStorage with an in-memory implementation for the test. */
export function installMemoryLocalStorage(): MemoryLocalStorage {
    savedLocalStorage = window.localStorage;
    const mem = createMemoryLocalStorage();
    Object.defineProperty(window, 'localStorage', {
        configurable: true,
        writable: true,
        value: mem,
    });
    return mem;
}

export function restoreLocalStorage(): void {
    if (savedLocalStorage !== undefined) {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            writable: true,
            value: savedLocalStorage,
        });
        savedLocalStorage = undefined;
    }
}

let navigatorOnlineDescriptor: PropertyDescriptor | undefined;

export function setOnline(online: boolean): void {
    if (!navigatorOnlineDescriptor) {
        navigatorOnlineDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')!;
    }
    Object.defineProperty(Navigator.prototype, 'onLine', {
        configurable: true,
        get: () => online,
    });
}

export function restoreNavigatorOnline(): void {
    if (navigatorOnlineDescriptor) {
        Object.defineProperty(Navigator.prototype, 'onLine', navigatorOnlineDescriptor);
    }
}

export function installMockNotification(permission: NotificationPermission = 'default'): jasmine.Spy {
    const ctor = jasmine.createSpy('NotificationCtor');
    (ctor as any).permission = permission;
    (ctor as any).requestPermission = jasmine
        .createSpy('requestPermission')
        .and.returnValue(Promise.resolve('granted'));
    (window as any).Notification = ctor;
    return ctor;
}

/** Minimal Worker stub for embedding tests */
export class MockWorker {
    messageListeners: Array<(ev: MessageEvent) => void> = [];
    errorListeners: Array<(ev: Event) => void> = [];

    postMessage = jasmine.createSpy('postMessage');

    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        _options?: boolean | AddEventListenerOptions,
    ): void {
        if (!listener) return;
        const fn =
            typeof listener === 'function'
                ? listener
                : (listener as EventListenerObject).handleEvent?.bind(listener);
        if (!fn) return;
        if (type === 'message') this.messageListeners.push(fn as (ev: MessageEvent) => void);
        if (type === 'error' || type === 'messageerror')
            this.errorListeners.push(fn as (ev: Event) => void);
    }

    dispatchMessage(data: unknown): void {
        const ev = { data } as MessageEvent;
        this.messageListeners.forEach((l) => l(ev));
    }

    dispatchError(ev: Event): void {
        this.errorListeners.forEach((l) => l(ev));
    }

    terminate = jasmine.createSpy('terminate');
}
