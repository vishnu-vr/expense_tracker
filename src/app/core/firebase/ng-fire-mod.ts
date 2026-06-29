/**
 * Mutable copies of AngularFire modular namespaces for unit tests (Jasmine `spyOn`).
 * ESM exports from `@angular/fire/*` are non-configurable; spreading into a plain object fixes that.
 */
import * as firestore from '@angular/fire/firestore';
import * as auth from '@angular/fire/auth';
import * as functions from '@angular/fire/functions';

export const FS = { ...firestore } as typeof firestore;
export const FA = { ...auth } as typeof auth;
export const FF = { ...functions } as typeof functions;

/** Restore mutable copies so each spec can `spyOn` again (Jasmine cannot re-spy the same property). */
export function resetNgFireModules(): void {
    Object.assign(FS, firestore);
    Object.assign(FA, auth);
    Object.assign(FF, functions);
}
