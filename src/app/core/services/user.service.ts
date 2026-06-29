import { Injectable, effect, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { FS } from '../firebase/ng-fire-mod';
import { AuthService } from './auth.service';
import { HomeService } from './home.service';

export interface AppUser {
    id: string;       // Firebase Auth UID
    name: string;     // Display name
    docId?: string;   // Firestore document ID
}

@Injectable({
    providedIn: 'root'
})
export class UserService {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);
    private homeService = inject(HomeService);

    users = signal<AppUser[]>([]);
    private userMap = new Map<string, AppUser>();
    private docUnsubs: (() => void)[] = [];

    constructor() {
        effect(() => {
            this.authService.currentUser();
            this.homeService.currentHome();
            this.resyncUserListeners();
        }, { allowSignalWrites: true });
    }

    private clearDocListeners() {
        this.docUnsubs.forEach((unsub) => unsub());
        this.docUnsubs = [];
    }

    private resyncUserListeners() {
        this.clearDocListeners();

        const authUser = this.authService.currentUser();
        if (!authUser) {
            this.users.set([]);
            this.userMap.clear();
            return;
        }

        const home = this.homeService.currentHome();
        const ids = new Set<string>([authUser.uid]);
        if (home?.memberIds?.length) {
            home.memberIds.forEach((id) => ids.add(id));
        }

        const mergedById = new Map<string, AppUser>();

        const publish = () => {
            const list = Array.from(mergedById.values());
            this.users.set(list);
            this.userMap.clear();
            list.forEach((u) => {
                if (u.id) {
                    this.userMap.set(u.id, u);
                }
            });
        };

        ids.forEach((userId) => {
            const userRef = FS.doc(this.firestore, 'users', userId);
            const unsub = FS.onSnapshot(
                userRef,
                (snapshot) => {
                    if (snapshot.exists()) {
                        const data = snapshot.data();
                        mergedById.set(userId, {
                            docId: snapshot.id,
                            id: (data['id'] as string) || userId,
                            name: data['name'] as string
                        });
                    } else {
                        mergedById.delete(userId);
                    }
                    publish();
                },
                (error) => {
                    console.error('Error loading user doc:', userId, error);
                }
            );
            this.docUnsubs.push(unsub);
        });
    }

    getUserById(userId: string): AppUser | undefined {
        return this.userMap.get(userId);
    }

    getUserName(userId: string): string {
        const user = this.userMap.get(userId);
        return user?.name || this.formatUserId(userId);
    }

    private formatUserId(userId: string): string {
        if (userId.length > 12) {
            return userId.substring(0, 6) + '...' + userId.substring(userId.length - 4);
        }
        return userId;
    }
}
