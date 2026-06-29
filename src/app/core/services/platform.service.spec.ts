import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { PlatformService } from './platform.service';

describe('PlatformService', () => {
    it('maps android native platform', () => {
        spyOn(Capacitor, 'getPlatform').and.returnValue('android');
        spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
        const svc = TestBed.runInInjectionContext(() => new PlatformService());
        expect(svc.platform).toBe('android');
        expect(svc.isAndroid).toBeTrue();
        expect(svc.isIos).toBeFalse();
        expect(svc.isWeb).toBeFalse();
        expect(svc.isNative).toBeTrue();
    });

    it('maps ios native platform', () => {
        spyOn(Capacitor, 'getPlatform').and.returnValue('ios');
        spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
        const svc = TestBed.runInInjectionContext(() => new PlatformService());
        expect(svc.platform).toBe('ios');
        expect(svc.isIos).toBeTrue();
        expect(svc.isAndroid).toBeFalse();
        expect(svc.isWeb).toBeFalse();
    });

    it('maps web platform', () => {
        spyOn(Capacitor, 'getPlatform').and.returnValue('web');
        spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
        const svc = TestBed.runInInjectionContext(() => new PlatformService());
        expect(svc.platform).toBe('web');
        expect(svc.isWeb).toBeTrue();
        expect(svc.isNative).toBeFalse();
    });
});
