import { Injectable, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { FS, FF } from '../firebase/ng-fire-mod';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

export interface Home {
    id: string;
    name: string;
    displayId: string;
    ownerId: string;
    memberIds: string[];
    createdAt: any;
}

@Injectable({
    providedIn: 'root'
})
export class HomeService {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);
    private router = inject(Router);

    currentHome = signal<Home | null>(null);
    homeMembers = signal<any[]>([]); // Store member details
    initialized = signal(false);

    constructor() {
        // Load home when user changes
        this.authService.user$.subscribe(async (user) => {
            console.log('User state changed:', user?.uid);
            if (user) {
                await this.loadUserHome(user.uid);
                // Only mark initialized AFTER home loading completes for a real user.
                // This prevents a race where Firebase Auth emits null first (before
                // resolving the cached session), which would cause the dashboard effect
                // to see initialized=true + currentHome=null and redirect to onboarding.
                this.initialized.set(true);
            } else {
                this.currentHome.set(null);
                this.homeMembers.set([]);
                // Reset initialized on logout so the next login starts clean.
                this.initialized.set(false);
            }
        });
    }

    async loadUserHome(userId: string) {
        // 1. Get User Doc to find homeId
        const userDocRef = FS.doc(this.firestore, 'users', userId);
        const userSnapshot = await FS.getDoc(userDocRef);

        if (userSnapshot.exists()) {
            const userData = userSnapshot.data();
            const homeId = userData['homeId'];

            if (homeId) {
                // 2. Get Home Doc
                const homeDocRef = FS.doc(this.firestore, 'homes', homeId);
                const homeSnapshot = await FS.getDoc(homeDocRef);
                if (homeSnapshot.exists()) {
                    const homeData = { id: homeSnapshot.id, ...homeSnapshot.data() } as Home;
                    this.currentHome.set(homeData);
                    this.loadHomeMembers(homeData.memberIds);
                }
                else {
                    throw new Error('Home not found');
                }
            } else {
                // User has no home -> Needs onboarding
                this.currentHome.set(null);
                this.homeMembers.set([]);
            }
        }
    }

    async loadHomeMembers(memberIds: string[]) {
        if (!memberIds || memberIds.length === 0) {
            this.homeMembers.set([]);
            return;
        }

        try {
            // Firestore 'in' query is limited to 30 items (previously 10). 
            // If we expect more, we need to batch. For now, simple query is fine.
            // Using documentId() to query by doc IDs
            const usersRef = FS.collection(this.firestore, 'users');
            const q = FS.query(usersRef, FS.where('id', 'in', memberIds));
            // Note: 'id' field in user doc must match ID. 
            // Alternatively use documentId() logic: where(documentId(), 'in', memberIds)
            // But we can just use Promise.all(getDoc) for reliable fetching by ID without index issues

            const memberPromises = memberIds.map(uid => FS.getDoc(FS.doc(this.firestore, 'users', uid)));
            const memberSnapshots = await Promise.all(memberPromises);

            const members = memberSnapshots.map(snap => {
                if (snap.exists()) {
                    return snap.data();
                }
                return null;
            }).filter(m => m !== null);

            this.homeMembers.set(members);
        } catch (error) {
            console.error('Error loading home members:', error);
        }
    }

    async createHome(homeName: string) {
        const user = this.authService.currentUser();
        if (!user) throw new Error('User not authenticated');

        const homeId = FS.doc(FS.collection(this.firestore, 'homes')).id;
        const displayId = this.generateDisplayId();

        const newHome: Home = {
            id: homeId,
            name: homeName,
            displayId: displayId,
            ownerId: user.uid,
            memberIds: [user.uid],
            createdAt: new Date()
        };

        // Batch or sequential updates? Sequential is fine for now.
        // 1. Create Home
        const homeRef = FS.doc(this.firestore, 'homes', homeId);
        await FS.setDoc(homeRef, newHome);

        // 2. Update User (use setDoc with merge to ensure doc exists)
        const userRef = FS.doc(this.firestore, 'users', user.uid);
        await FS.setDoc(userRef, { homeId: homeId }, { merge: true });

        this.currentHome.set(newHome);
        return newHome;
    }

    async joinHome(displayId: string) {
        const user = this.authService.currentUser();
        if (!user) throw new Error('User not authenticated');

        const functions = FF.getFunctions();
        const joinHomeFn = FF.httpsCallable(functions, 'joinHome');

        try {
            const result = await joinHomeFn({ displayId });
            const homeData = result.data as Home;
            this.currentHome.set(homeData);
            this.loadHomeMembers(homeData.memberIds);
            return homeData;
        } catch (error) {
            console.error('Error joining home:', error);
            throw error;
        }
    }

    private generateDisplayId(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    async leaveHome() {
        const user = this.authService.currentUser();
        const home = this.currentHome();
        if (!user || !home) throw new Error('No user or home to leave');

        // Atomic batch: remove user from home memberIds + delete homeId from user doc
        const batch = FS.writeBatch(this.firestore);
        batch.update(FS.doc(this.firestore, 'homes', home.id), {
            memberIds: FS.arrayRemove(user.uid)
        });
        batch.update(FS.doc(this.firestore, 'users', user.uid), {
            homeId: FS.deleteField()
        });
        await batch.commit();

        // Reset local state — transactions are scoped by homeId so the user
        // will see nothing until they join/create a new home.
        this.currentHome.set(null);
        this.homeMembers.set([]);
        this.initialized.set(false);
        this.router.navigate(['/onboarding']);
    }
}
