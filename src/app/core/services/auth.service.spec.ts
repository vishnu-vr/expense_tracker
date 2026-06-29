import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { FA, FS, resetNgFireModules } from '../firebase/ng-fire-mod';
import { AuthService } from './auth.service';
import { PlatformService } from './platform.service';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { firstValueFrom, of } from 'rxjs';
import * as authTypes from '@angular/fire/auth';

describe('AuthService', () => {
    let navigateSpy: jasmine.Spy;

    afterEach(() => {
        resetNgFireModules();
    });

    const mockUser = {
        uid: 'u1',
        email: 'a@b.com',
        displayName: 'Alice',
        photoURL: null as string | null,
    } as authTypes.User;

    beforeEach(() => {
        navigateSpy = jasmine.createSpy('navigate');

        spyOn(FA, 'user').and.returnValue(of(null));
        spyOn(FA, 'signInWithEmailAndPassword').and.returnValue(
            Promise.resolve({ user: mockUser } as authTypes.UserCredential),
        );
        spyOn(FA, 'signInWithPopup').and.returnValue(
            Promise.resolve({ user: mockUser } as authTypes.UserCredential),
        );
        spyOn(FA, 'signOut').and.returnValue(Promise.resolve());
        spyOn(FA, 'signInWithCredential').and.returnValue(
            Promise.resolve({ user: mockUser } as authTypes.UserCredential),
        );

        spyOn(FS, 'doc').and.returnValue({ id: 'u1' } as never);
        spyOn(FS, 'getDoc').and.returnValue(
            Promise.resolve({
                exists: () => false,
                data: () => ({}),
            } as never),
        );
        spyOn(FS, 'setDoc').and.returnValue(Promise.resolve());

        spyOn(FirebaseAuthentication, 'signInWithGoogle').and.returnValue(
            Promise.resolve({
                credential: { idToken: 'token' },
            } as never),
        );
        spyOn(FirebaseAuthentication, 'signOut').and.returnValue(Promise.resolve());

        TestBed.configureTestingModule({
            providers: [
                AuthService,
                { provide: Auth, useValue: {} },
                { provide: Firestore, useValue: {} },
                { provide: Router, useValue: { navigate: navigateSpy } },
                {
                    provide: PlatformService,
                    useValue: {
                        isNative: false,
                        platform: 'web',
                        isAndroid: false,
                        isIos: false,
                        isWeb: true,
                    },
                },
            ],
        });
    });

    it('login signs in, ensures user doc, navigates dashboard', async () => {
        const svc = TestBed.inject(AuthService);
        await firstValueFrom(svc.login('a@b.com', 'pw'));
        await new Promise((r) => setTimeout(r, 0));
        expect(FA.signInWithEmailAndPassword).toHaveBeenCalled();
        expect(FS.setDoc).toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
    });

    it('ensureUserDoc skips setDoc when doc exists', async () => {
        (FS.getDoc as jasmine.Spy).and.returnValue(
            Promise.resolve({
                exists: () => true,
                data: () => ({ id: 'u1' }),
            } as never),
        );
        (FS.setDoc as jasmine.Spy).calls.reset();
        const svc = TestBed.inject(AuthService);
        await svc.ensureUserDoc(mockUser);
        expect(FS.setDoc).not.toHaveBeenCalled();
    });

    it('loginWithGoogle uses popup on web', async () => {
        const svc = TestBed.inject(AuthService);
        await firstValueFrom(svc.loginWithGoogle());
        await new Promise((r) => setTimeout(r, 0));
        expect(FA.signInWithPopup).toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
    });

    it('loginWithGoogle uses native path without web popup when native', async () => {
        TestBed.resetTestingModule();
        resetNgFireModules();

        spyOn(FA, 'user').and.returnValue(of(null));
        spyOn(FA, 'signInWithEmailAndPassword').and.stub();
        spyOn(FA, 'signInWithPopup').and.stub();
        spyOn(FA, 'signOut').and.returnValue(Promise.resolve());
        spyOn(FA, 'signInWithCredential').and.returnValue(
            Promise.resolve({ user: mockUser } as authTypes.UserCredential),
        );
        spyOn(FS, 'doc').and.returnValue({ id: 'u1' } as never);
        spyOn(FS, 'getDoc').and.returnValue(
            Promise.resolve({ exists: () => false, data: () => ({}) } as never),
        );
        spyOn(FS, 'setDoc').and.returnValue(Promise.resolve());

        /** Capacitor plugin proxy cannot be spied; stub the native entrypoint instead. */
        spyOn(AuthService.prototype as unknown as { nativeGoogleSignIn: () => Promise<unknown> }, 'nativeGoogleSignIn').and.returnValue(
            Promise.resolve({ user: mockUser } as authTypes.UserCredential),
        );

        TestBed.configureTestingModule({
            providers: [
                AuthService,
                { provide: Auth, useValue: {} },
                { provide: Firestore, useValue: {} },
                { provide: Router, useValue: { navigate: navigateSpy } },
                {
                    provide: PlatformService,
                    useValue: {
                        isNative: true,
                        platform: 'android',
                        isAndroid: true,
                        isIos: false,
                        isWeb: false,
                    },
                },
            ],
        });

        const svc = TestBed.inject(AuthService);
        await firstValueFrom(svc.loginWithGoogle());
        await new Promise((r) => setTimeout(r, 0));
        expect(FA.signInWithPopup).not.toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith(['/dashboard']);
    });

    it('logout signs out and navigates login', async () => {
        const svc = TestBed.inject(AuthService);
        await firstValueFrom(svc.logout());
        expect(FA.signOut).toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    });
});
