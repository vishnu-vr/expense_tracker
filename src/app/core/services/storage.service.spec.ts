import { TestBed } from '@angular/core/testing';
import { IDB, resetIdbModule } from '../idb/idb-mod';
import { StorageService } from './storage.service';

describe('StorageService', () => {
    let putSpy: jasmine.Spy;
    let getAllFromIndexSpy: jasmine.Spy;
    let getAllSpy: jasmine.Spy;
    let deleteSpy: jasmine.Spy;

    beforeEach(() => {
        putSpy = jasmine.createSpy('put').and.returnValue(Promise.resolve());
        getAllFromIndexSpy = jasmine.createSpy('getAllFromIndex').and.returnValue(Promise.resolve([]));
        getAllSpy = jasmine.createSpy('getAll').and.returnValue(Promise.resolve([]));
        deleteSpy = jasmine.createSpy('delete').and.returnValue(Promise.resolve());

        const fakeDb = {
            put: putSpy,
            getAllFromIndex: getAllFromIndexSpy,
            getAll: getAllSpy,
            delete: deleteSpy,
        };

        spyOn(IDB, 'openDB').and.returnValue(Promise.resolve(fakeDb as never));
        TestBed.configureTestingModule({
            providers: [StorageService],
        });
    });

    afterEach(() => {
        resetIdbModule();
    });

    it('addTransaction puts into transactions store', async () => {
        const svc = TestBed.inject(StorageService);
        const tx = {
            id: 't1',
            amount: 1,
            categoryId: 'c',
            accountId: 'a',
            date: new Date(),
            type: 'expense' as const,
        };
        await svc.addTransaction(tx);
        expect(putSpy).toHaveBeenCalledWith('transactions', tx);
    });

    it('getAllTransactions reads by-date index', async () => {
        const svc = TestBed.inject(StorageService);
        await svc.getAllTransactions();
        expect(getAllFromIndexSpy).toHaveBeenCalledWith('transactions', 'by-date');
    });

    it('deleteTransaction deletes by id', async () => {
        const svc = TestBed.inject(StorageService);
        await svc.deleteTransaction('t1');
        expect(deleteSpy).toHaveBeenCalledWith('transactions', 't1');
    });

    it('addCategory puts categories', async () => {
        const svc = TestBed.inject(StorageService);
        const cat = {
            id: 'c1',
            name: 'Food',
            icon: 'i',
            color: '#fff',
            type: 'expense' as const,
        };
        await svc.addCategory(cat);
        expect(putSpy).toHaveBeenCalledWith('categories', cat);
    });

    it('getAllCategories lists categories store', async () => {
        const svc = TestBed.inject(StorageService);
        await svc.getAllCategories();
        expect(getAllSpy).toHaveBeenCalledWith('categories');
    });
});
