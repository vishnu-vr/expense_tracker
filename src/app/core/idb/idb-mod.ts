/** Mutable `idb` namespace copy so tests can `spyOn(IDB, 'openDB')`. */
import * as idb from 'idb';

export const IDB = { ...idb } as typeof idb;

export function resetIdbModule(): void {
    Object.assign(IDB, idb);
}
