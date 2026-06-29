import { TestBed } from '@angular/core/testing';
import { SmsIngestService } from './sms-ingest.service';
import { PlatformService } from './platform.service';

describe('SmsIngestService', () => {
    it('initialize does not throw when not Android', async () => {
        TestBed.configureTestingModule({
            providers: [
                SmsIngestService,
                { provide: PlatformService, useValue: { isAndroid: false } },
            ],
        });
        const svc = TestBed.inject(SmsIngestService);
        await expectAsync(svc.initialize()).toBeResolvedTo(undefined);
    });

    it('requestSmsPermission on non-Android sets denied and returns false', async () => {
        TestBed.configureTestingModule({
            providers: [
                SmsIngestService,
                { provide: PlatformService, useValue: { isAndroid: false } },
            ],
        });
        const svc = TestBed.inject(SmsIngestService);
        const ok = await svc.requestSmsPermission();
        expect(ok).toBeFalse();
        expect(svc.permission()).toBe('denied');
    });

    it('setEnabled(false) on non-Android returns false', async () => {
        TestBed.configureTestingModule({
            providers: [
                SmsIngestService,
                { provide: PlatformService, useValue: { isAndroid: false } },
            ],
        });
        const svc = TestBed.inject(SmsIngestService);
        const ok = await svc.setEnabled(false);
        expect(ok).toBeFalse();
    });
});
