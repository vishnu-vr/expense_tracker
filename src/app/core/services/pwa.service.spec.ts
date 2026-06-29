import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { PwaService } from './pwa.service';

describe('PwaService', () => {
    beforeEach(() => {
        spyOn(Capacitor, 'isNativePlatform').and.returnValue(false);
    });

    it('sets showInstallButton when beforeinstallprompt fires', () => {
        const svc = TestBed.runInInjectionContext(() => new PwaService());
        expect(svc.showInstallButton()).toBeFalse();

        const ev = new Event('beforeinstallprompt') as any;
        ev.preventDefault = jasmine.createSpy('preventDefault');
        window.dispatchEvent(ev);

        expect(svc.showInstallButton()).toBeTrue();
    });

    it('does not register install listeners on native platform', () => {
        (Capacitor.isNativePlatform as jasmine.Spy).and.returnValue(true);
        const addSpy = spyOn(window, 'addEventListener').and.callThrough();
        TestBed.runInInjectionContext(() => new PwaService());
        expect(addSpy).not.toHaveBeenCalledWith('beforeinstallprompt', jasmine.any(Function));
    });

    it('installPwa calls prompt and clears deferred prompt', async () => {
        const svc = TestBed.runInInjectionContext(() => new PwaService());
        const deferred = {
            preventDefault: jasmine.createSpy(),
            prompt: jasmine.createSpy('prompt').and.returnValue(Promise.resolve()),
            userChoice: Promise.resolve({ outcome: 'accepted' }),
        };
        window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), deferred));
        expect(svc.showInstallButton()).toBeTrue();

        await svc.installPwa();
        expect(deferred.prompt).toHaveBeenCalled();
        expect(svc.showInstallButton()).toBeFalse();
    });

    it('appinstalled hides install button', () => {
        const svc = TestBed.runInInjectionContext(() => new PwaService());
        const ev = new Event('beforeinstallprompt') as any;
        ev.preventDefault = jasmine.createSpy();
        window.dispatchEvent(ev);
        expect(svc.showInstallButton()).toBeTrue();

        window.dispatchEvent(new Event('appinstalled'));
        expect(svc.showInstallButton()).toBeFalse();
    });
});
