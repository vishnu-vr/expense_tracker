import { Injectable, inject, signal } from '@angular/core';
import { Auth, GoogleAuthProvider, User, UserCredential } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { FA, FS } from '../firebase/ng-fire-mod';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, from, of, tap, Observable } from 'rxjs';
import { PlatformService } from './platform.service';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private auth = inject(Auth);
    private firestore = inject(Firestore);
    private router = inject(Router);
    private platformService = inject(PlatformService);

    user$ = FA.user(this.auth);
    currentUser = toSignal(this.user$);

    constructor() { }

    async ensureUserDoc(user: User) {
        const docRef = FS.doc(this.firestore, 'users', user.uid);
        const snapshot = await FS.getDoc(docRef);
        if (!snapshot.exists()) {
            await FS.setDoc(docRef, {
                id: user.uid,
                email: user.email,
                name: user.displayName || 'User',
                photoURL: user.photoURL,
                createdAt: new Date()
            });
        }
    }

    login(email: string, password: string): Observable<UserCredential | null> {
        return from(FA.signInWithEmailAndPassword(this.auth, email, password)).pipe(
            tap(async (cred) => {
                if (cred.user) await this.ensureUserDoc(cred.user);
                this.router.navigate(['/home']);
            }),
            catchError(error => {
                console.error('Login failed', error);
                throw error;
            })
        );
    }

    loginWithGoogle(): Observable<UserCredential | null> {
        if (this.platformService.isNative) {
            return from(this.nativeGoogleSignIn()).pipe(
                tap(async (cred) => {
                    if (cred?.user) await this.ensureUserDoc(cred.user);
                    this.router.navigate(['/home']);
                }),
                catchError(error => {
                    console.error('Native Google login failed', error);
                    return of(null);
                })
            );
        }

        const provider = new GoogleAuthProvider();
        return from(FA.signInWithPopup(this.auth, provider)).pipe(
            tap(async (cred) => {
                if (cred.user) await this.ensureUserDoc(cred.user);
                this.router.navigate(['/home']);
            }),
            catchError(error => {
                console.error('Login failed', error);
                return of(null);
            })
        );
    }

    private async nativeGoogleSignIn(): Promise<UserCredential> {
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) {
            throw new Error('No ID token received from native Google Sign-In');
        }
        const credential = GoogleAuthProvider.credential(idToken);
        return FA.signInWithCredential(this.auth, credential);
    }

    logout() {
        const signOutPromise = this.platformService.isNative
            ? FirebaseAuthentication.signOut().then(() => FA.signOut(this.auth))
            : FA.signOut(this.auth);

        return from(signOutPromise).pipe(
            tap(() => this.router.navigate(['/login']))
        );
    }
}
