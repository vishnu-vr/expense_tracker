import { Injectable, inject, signal, computed, OnDestroy, effect } from '@angular/core';
import { Firestore, QueryDocumentSnapshot } from '@angular/fire/firestore';
import { FS } from '../firebase/ng-fire-mod';
import { AuthService } from './auth.service';
import { Notification } from '../models/models';
import { Subscription, combineLatest } from 'rxjs';
import { HomeService } from './home.service';
import { PlatformService } from './platform.service';
import { PushNotifications } from '@capacitor/push-notifications';
import { Router } from '@angular/router';

@Injectable({
    providedIn: 'root'
})
export class NotificationService implements OnDestroy {
    private firestore = inject(Firestore);
    private authService = inject(AuthService);
    private homeService = inject(HomeService);
    private platformService = inject(PlatformService);
    private router = inject(Router);
    private notificationsCollection = FS.collection(this.firestore, 'notifications');
    private unsubscribe: (() => void) | null = null;
    private seenNotificationIds = new Set<string>();
    private isInitialLoad = true;
    private lastDoc: QueryDocumentSnapshot | null = null;
    private readonly PAGE_SIZE = 10;
    private paginatedNotifications: Notification[] = [];

    // Signals
    notifications = signal<Notification[]>([]);
    showDropdown = signal(false);
    pushPermission = signal<NotificationPermission>('default');
    isLoadingMore = signal(false);
    hasMoreNotifications = signal(true);

    // Computed: unread notifications for current user
    unreadNotifications = computed(() => {
        const user = this.authService.currentUser();
        if (!user) return [];

        return this.notifications().filter(n =>
            !n.readBy.includes(user.uid) && n.createdBy !== user.uid
        );
    });

    unreadCount = computed(() => this.unreadNotifications().length);

    // All notifications visible to current user (not created by them)
    visibleNotifications = computed(() => {
        const user = this.authService.currentUser();
        if (!user) return [];

        return this.notifications().filter(n => n.createdBy !== user.uid);
    });

    constructor() {
        this.initPushNotifications();

        // Use effect to react to User and Home changes
        effect(() => {
            const user = this.authService.currentUser();
            const home = this.homeService.currentHome();

            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = null;
            }

            // Reset state
            this.seenNotificationIds.clear();
            this.isInitialLoad = true;
            this.lastDoc = null;
            this.hasMoreNotifications.set(true);
            this.paginatedNotifications = [];

            if (user && home) {
                // Fetch first page of notifications scoped by HOME
                const q = FS.query(
                    this.notificationsCollection,
                    FS.where('homeId', '==', home.id),
                    FS.orderBy('createdAt', 'desc'),
                    FS.limit(this.PAGE_SIZE)
                );

                this.unsubscribe = FS.onSnapshot(q, (snapshot) => {
                    const notifications = snapshot.docs.map(docSnap => {
                        const data = docSnap.data();
                        return {
                            id: docSnap.id,
                            ...data,
                            createdAt: data['createdAt']?.toDate ? data['createdAt'].toDate() : new Date(data['createdAt']),
                            readBy: data['readBy'] || []
                        } as Notification;
                    });

                    // Update lastDoc for pagination
                    if (snapshot.docs.length > 0) {
                        this.lastDoc = snapshot.docs[snapshot.docs.length - 1];
                    }

                    // Check if there might be more
                    this.hasMoreNotifications.set(snapshot.docs.length === this.PAGE_SIZE);

                    // Detect new notifications (not from current user)
                    if (!this.isInitialLoad) {
                        notifications.forEach(n => {
                            if (!this.seenNotificationIds.has(n.id) && n.createdBy !== user.uid) {
                                // This is a new notification from another user
                                this.showPushNotification(n);
                            }
                        });
                    }

                    // Update seen IDs
                    notifications.forEach(n => this.seenNotificationIds.add(n.id));
                    this.isInitialLoad = false;

                    // Merge first page with paginated notifications, avoiding duplicates
                    const firstPageIds = new Set(notifications.map(n => n.id));
                    const filteredPaginated = this.paginatedNotifications
                        .filter(p => !firstPageIds.has(p.id));

                    this.notifications.set([...notifications, ...filteredPaginated]);
                }, (error) => {
                    console.error('Error loading notifications:', error);
                });
            } else {
                this.notifications.set([]);
            }
        }, { allowSignalWrites: true });
    }

    private async initPushNotifications() {
        if (this.platformService.isNative) {
            await this.initNativePush();
            return;
        }

        if (!('Notification' in window)) {
            console.log('This browser does not support notifications');
            return;
        }

        this.pushPermission.set(Notification.permission);
    }

    private async initNativePush() {
        const permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'granted') {
            this.pushPermission.set('granted');
        }

        await PushNotifications.addListener('registration', async (token) => {
            console.log('FCM token:', token.value);
            await this.storeFcmToken(token.value);
        });

        await PushNotifications.addListener('registrationError', (err) => {
            console.error('Push registration error:', err);
        });

        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('Push received in foreground:', notification);
        });

        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            console.log('Push action performed:', action);
            const data = action.notification?.data || {};
            const transactionId = data['transactionId'];
            const route = data['route'];

            if (typeof route === 'string' && route.length > 0) {
                this.router.navigateByUrl(route);
                return;
            }

            if (typeof transactionId === 'string' && transactionId.length > 0) {
                this.router.navigate(['/edit-transaction', transactionId]);
                return;
            }

            this.router.navigate(['/transactions']);
        });

        if (permStatus.receive === 'granted') {
            await PushNotifications.register();
        }
    }

    private async storeFcmToken(token: string) {
        const user = this.authService.currentUser();
        if (!user) return;
        const tokenDoc = FS.doc(this.firestore, 'users', user.uid, 'fcmTokens', token);
        await FS.setDoc(tokenDoc, {
            token,
            platform: this.platformService.platform,
            createdAt: FS.Timestamp.now(),
            updatedAt: FS.Timestamp.now()
        }, { merge: true });
    }

    async requestPushPermission(): Promise<boolean> {
        if (this.platformService.isNative) {
            const result = await PushNotifications.requestPermissions();
            const granted = result.receive === 'granted';
            this.pushPermission.set(granted ? 'granted' : 'denied');
            if (granted) {
                await PushNotifications.register();
            }
            return granted;
        }

        if (!('Notification' in window)) {
            return false;
        }

        const permission = await Notification.requestPermission();
        this.pushPermission.set(permission);
        return permission === 'granted';
    }

    private showPushNotification(notification: Notification) {
        if (this.pushPermission() !== 'granted') return;

        if (this.platformService.isNative) {
            return;
        }

        if (document.hasFocus()) return;

        const options: NotificationOptions & { vibrate?: number[] } = {
            body: notification.message,
            icon: '/assets/icons/icon-192x192.png',
            badge: '/assets/icons/icon-72x72.png',
            tag: notification.id,
            vibrate: [200, 100, 200],
            data: {
                transactionId: notification.transactionId,
                url: '/transactions'
            }
        };

        const pushNotif = new window.Notification('Expense Tracker', options);

        pushNotif.onclick = () => {
            window.focus();
            pushNotif.close();
        };
    }

    ngOnDestroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }

    async loadMore() {
        const home = this.homeService.currentHome();
        if (!this.lastDoc || this.isLoadingMore() || !this.hasMoreNotifications() || !home) {
            return;
        }

        this.isLoadingMore.set(true);

        try {
            const q = FS.query(
                this.notificationsCollection,
                FS.where('homeId', '==', home.id),
                FS.orderBy('createdAt', 'desc'),
                FS.startAfter(this.lastDoc),
                FS.limit(this.PAGE_SIZE)
            );

            const snapshot = await FS.getDocs(q);

            const newNotifications = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                return {
                    id: docSnap.id,
                    ...data,
                    createdAt: data['createdAt']?.toDate ? data['createdAt'].toDate() : new Date(data['createdAt']),
                    readBy: data['readBy'] || []
                } as Notification;
            });

            if (snapshot.docs.length > 0) {
                this.lastDoc = snapshot.docs[snapshot.docs.length - 1];
            }

            // Check if there are more notifications
            this.hasMoreNotifications.set(snapshot.docs.length === this.PAGE_SIZE);

            // Add new notifications to seen set
            newNotifications.forEach(n => this.seenNotificationIds.add(n.id));

            // Store in paginated array to preserve across snapshot updates
            this.paginatedNotifications = [...this.paginatedNotifications, ...newNotifications];

            // Append new notifications to existing ones
            this.notifications.update(current => [...current, ...newNotifications]);
        } catch (error) {
            console.error('Error loading more notifications:', error);
        } finally {
            this.isLoadingMore.set(false);
        }
    }

    async createNotification(
        type: Notification['type'],
        message: string,
        transactionId?: string,
        homeId?: string
    ) {
        const user = this.authService.currentUser();
        if (!user) throw new Error('User not authenticated');

        const notification = {
            type,
            message,
            transactionId: transactionId || null,
            createdBy: user.uid,
            createdByName: user.displayName || user.email || 'Unknown User',
            createdAt: FS.Timestamp.now(),
            readBy: [],
            homeId: homeId
        };

        await FS.addDoc(this.notificationsCollection, notification);
    }

    async markAsRead(notificationId: string) {
        const user = this.authService.currentUser();
        if (!user) return;

        const docRef = FS.doc(this.firestore, 'notifications', notificationId);
        await FS.updateDoc(docRef, {
            readBy: FS.arrayUnion(user.uid)
        });
    }

    async markAllAsRead() {
        const user = this.authService.currentUser();
        if (!user) return;

        const unread = this.unreadNotifications();
        const promises = unread.map(n => {
            const docRef = FS.doc(this.firestore, 'notifications', n.id);
            return FS.updateDoc(docRef, {
                readBy: FS.arrayUnion(user.uid)
            });
        });

        await Promise.all(promises);
    }

    toggleDropdown() {
        this.showDropdown.update(v => !v);
    }

    closeDropdown() {
        this.showDropdown.set(false);
    }

    // Helper to format time ago
    getTimeAgo(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }
}
