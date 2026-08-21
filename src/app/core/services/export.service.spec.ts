import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { Directory, Encoding } from '@capacitor/filesystem';
import { FF, resetNgFireModules } from '../firebase/ng-fire-mod';
import { ExportService, nativeCsvDelivery } from './export.service';
import { PlatformService } from './platform.service';

describe('ExportService', () => {
    afterEach(() => {
        resetNgFireModules();
    });

    function setup(isNative: boolean) {
        TestBed.configureTestingModule({
            providers: [
                ExportService,
                { provide: Functions, useValue: {} },
                { provide: PlatformService, useValue: { isNative } },
            ],
        });
        return TestBed.inject(ExportService);
    }

    it('downloads csv in the browser after a successful export', async () => {
        const svc = setup(false);
        spyOn(FF, 'httpsCallable').and.returnValue(() =>
            Promise.resolve({
                data: {
                    csv: 'Date,Type\n2025-11-01,expense\n',
                    filename: 'transactions_2025-11-01_to_2025-11-30.csv',
                    count: 1,
                },
            }),
        );

        const click = jasmine.createSpy('click');
        const link = { href: '', download: '', style: { display: '' }, click } as unknown as HTMLAnchorElement;
        spyOn(document, 'createElement').and.returnValue(link);
        spyOn(document.body, 'appendChild');
        spyOn(document.body, 'removeChild');
        spyOn(URL, 'createObjectURL').and.returnValue('blob:csv');
        spyOn(URL, 'revokeObjectURL');

        const result = await svc.exportTransactions('2025-11-01', '2025-11-30');
        expect(result.count).toBe(1);
        expect(link.download).toBe('transactions_2025-11-01_to_2025-11-30.csv');
        expect(click).toHaveBeenCalled();
        expect(svc.isExporting()).toBeFalse();
        expect(svc.error()).toBeNull();
    });

    it('writes and shares csv on native platforms', async () => {
        const svc = setup(true);
        spyOn(FF, 'httpsCallable').and.returnValue(() =>
            Promise.resolve({
                data: {
                    csv: 'Date,Type\n',
                    filename: 'transactions_2025-11-01_to_2025-11-30.csv',
                    count: 0,
                },
            }),
        );
        spyOn(nativeCsvDelivery, 'writeFile').and.resolveTo({ uri: 'cache://file.csv' } as any);
        spyOn(nativeCsvDelivery, 'getUri').and.resolveTo({ uri: 'file://cache/file.csv' });
        spyOn(nativeCsvDelivery, 'share').and.resolveTo({ activityType: undefined });

        await svc.exportTransactions('2025-11-01', '2025-11-30');

        expect(nativeCsvDelivery.writeFile).toHaveBeenCalledWith(jasmine.objectContaining({
            path: 'transactions_2025-11-01_to_2025-11-30.csv',
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        }));
        expect(nativeCsvDelivery.share).toHaveBeenCalledWith(jasmine.objectContaining({
            url: 'file://cache/file.csv',
        }));
    });

    it('records an error when the callable fails', async () => {
        const svc = setup(false);
        spyOn(FF, 'httpsCallable').and.returnValue(() =>
            Promise.reject({ message: 'boom' }),
        );

        await expectAsync(svc.exportTransactions('2025-11-01', '2025-11-30')).toBeRejected();
        expect(svc.error()).toBe('boom');
        expect(svc.isExporting()).toBeFalse();
    });
});
