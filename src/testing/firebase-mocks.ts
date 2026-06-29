import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { Provider } from '@angular/core';

export function provideFirestoreMock(): Provider {
    return { provide: Firestore, useValue: {} };
}

export function provideAuthMock(): Provider {
    return { provide: Auth, useValue: {} };
}

export function provideFunctionsMock(): Provider {
    return { provide: Functions, useValue: {} };
}

export interface FakeQuerySnapshot<T = DocumentDataLike> {
    docs: Array<FakeQueryDocSnapshot<T>>;
    empty: boolean;
}

export interface DocumentDataLike {
    [key: string]: unknown;
}

export interface FakeQueryDocSnapshot<T = DocumentDataLike> {
    id: string;
    data: () => T;
}

export function makeDocSnap<T extends DocumentDataLike>(id: string, data: T): FakeQueryDocSnapshot<T> {
    return {
        id,
        data: () => data,
    };
}

export function fakeOnSnapshotFactory() {
    const callbacks: Array<(snap: FakeQuerySnapshot) => void> = [];
    return {
        subscribe(cb: (snap: FakeQuerySnapshot) => void): () => void {
            callbacks.push(cb);
            return () => {
                const i = callbacks.indexOf(cb);
                if (i >= 0) callbacks.splice(i, 1);
            };
        },
        emit(snap: FakeQuerySnapshot): void {
            callbacks.forEach((cb) => cb(snap));
        },
    };
}
